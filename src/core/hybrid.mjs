import util from 'util';
if (!util.isNullOrUndefined) {
    util.isNullOrUndefined = (arg) => arg === null || arg === undefined;
}

import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { calculerPrediction as calculerPredictionV14 } from './intelligence.mjs';
import { CONFIG } from '../config/settings.mjs';
import { extractBaseFeatures } from './features.mjs';
import { MIN_PROMOTION_TEST_COURSES } from '../ml/promotion_gate.mjs';
import { MODEL_PATH } from '../ml/model_paths.mjs';
import { MIN_CAPTURED_COURSES, MIN_CAPTURE_DATES } from '../ml/course_split.mjs';
import { loadTensorFlowBackend } from '../ml/tensorflow_runtime.mjs';
import { mlProbabilityToPoints, combineHybridScores } from '../ml/scoring.mjs';
import { getModelCompatibilityReason } from '../ml/model_compatibility.mjs';
let model = null;
let metadata = null;
let tfModule = null;
let modelStatus = {
    active: false,
    reason: 'not-checked',
    checkedAt: null
};

function updateModelStatus(reason, active = Boolean(model), details = {}) {
    modelStatus = {
        active,
        reason,
        checkedAt: new Date().toISOString(),
        version: active ? metadata?.version || null : null,
        trainedAt: active ? metadata?.trainedAt || null : null,
        // Keep the legacy key explicitly tied to the ML-only metric; expose
        // the deployed hybrid metric separately to prevent mislabeling it.
        testTop1HitRate: active ? metadata?.testMlTop1HitRate ?? metadata?.testTop1HitRate ?? null : null,
        testMlOnlyTop1HitRate: active ? metadata?.testMlTop1HitRate ?? metadata?.testTop1HitRate ?? null : null,
        testDeployedHybridTop1HitRate: active ? metadata?.testMatchedCandidateTop1HitRate ?? null : null,
        testComparableCourseCount: active ? metadata?.testMatchedCourseCount ?? null : null,
        testCourseCount: active ? metadata?.testCourseCount ?? null : null,
        ...details
    };
}

async function getTF() {
    if (tfModule) return tfModule;
    try {
        const runtime = await loadTensorFlowBackend();
        tfModule = runtime.tf;
        if (runtime.backend === 'javascript') console.warn('[ML] Backend TensorFlow natif indisponible, moteur JavaScript utilisé.');
        return tfModule;
    } catch (error) {
        console.warn('[ML] TensorFlow non disponible, mode v14 actif:', error.message);
        return null;
    }
}

/**
 * Chargement du modèle ML au démarrage (Compatibilité universelle ARM64 / Freebox Ultra / Pure JS)
 */
export async function loadMLModel() {
    try {
        const tf = await getTF();
        if (!tf) {
            updateModelStatus('tensorflow-unavailable');
            return false;
        }

        const modelPath = path.resolve(MODEL_PATH);
        const jsonPath = path.join(modelPath, 'model.json');
        const binPath = path.join(modelPath, 'weights.bin');
        const metaPath = path.join(modelPath, 'metadata.json');

        if (!fs.existsSync(jsonPath)) {
            console.warn('[ML] Modèle non trouvé, utilisation de v14 uniquement');
            updateModelStatus('model-not-found');
            return false;
        }

        let nextMetadata = null;
        if (fs.existsSync(metaPath)) {
            nextMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        }
        const compatibilityReason = getModelCompatibilityReason(nextMetadata);
        if (compatibilityReason) {
            const provenanceMismatch = compatibilityReason === 'unverified-training-provenance';
            console.warn(provenanceMismatch
                ? '[ML] Modèle historique ignoré : il n’a pas été entraîné sur des snapshots pré-course immuables. Utilisation de v14.'
                : '[ML] Modèle ignoré : son schéma de caractéristiques ne correspond pas à celui du code courant. Utilisation de v14.');
            updateModelStatus(compatibilityReason, Boolean(model), {
                candidateVersion: nextMetadata?.version || null,
                candidateFeatureSchemaVersion: nextMetadata?.featureSchemaVersion ?? null
            });
            return false;
        }

        let nextModel;
        try {
            nextModel = await tf.loadLayersModel(pathToFileURL(jsonPath).href);
        } catch (e1) {
            // Fallback IOHandler pour moteurs pure JS sans C++ native (ex: ARM64 Freebox Ultra, Alpine Docker, Raspberry Pi)
            const ioHandler = {
                load: async () => {
                    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    const binBuffer = fs.readFileSync(binPath);
                    const weightsManifest = jsonContent.weightsManifest;
                    return {
                        modelTopology: jsonContent.modelTopology,
                        weightSpecs: weightsManifest[0].weights,
                        weightData: binBuffer.buffer.slice(binBuffer.byteOffset, binBuffer.byteOffset + binBuffer.byteLength)
                    };
                }
            };
            nextModel = await tf.loadLayersModel(ioHandler);
        }

        const previousModel = model;
        model = nextModel;
        metadata = nextMetadata;
        updateModelStatus('active', true);
        const hybridHitRate = metadata.testMatchedCandidateTop1HitRate;
        const top1 = Number.isFinite(hybridHitRate)
            ? `Top 1 hybride déployé (test prospectif commun): ${(hybridHitRate * 100).toFixed(2)}% sur ${metadata.testMatchedCourseCount} courses`
            : 'métrique Top 1 hybride absente';
        console.log(`[ML] Modèle chargé (${top1})`);
        if (previousModel && previousModel !== nextModel) {
            const cleanup = setTimeout(() => previousModel.dispose(), 60_000);
            cleanup.unref?.();
        }

        return true;
    } catch (error) {
        console.error('[ML] Erreur chargement modèle:', error.message);
        updateModelStatus('model-load-error', Boolean(model), { error: error.message });
        return false;
    }
}

export function getMLStatus() {
    return {
        ...modelStatus,
        mode: model ? 'ml-hybrid' : 'heuristic-fallback',
        trainingRequirements: {
            minimumSettledCourses: MIN_CAPTURED_COURSES,
            minimumDistinctDates: MIN_CAPTURE_DATES,
            minimumMatchedTestCoursesForPromotion: MIN_PROMOTION_TEST_COURSES
        }
    };
}

let isWatcherActive = false;
let reloadDebounceTimeout = null;
let modelWatchers = [];

function watchModelFiles() {
    for (const watcher of modelWatchers) watcher.close();
    modelWatchers = [];
    const modelDirPath = path.resolve(MODEL_PATH);
    const parentDirPath = path.dirname(modelDirPath);
    const modelDirName = path.basename(modelDirPath);

    const scheduleReload = reason => {
        if (reloadDebounceTimeout) clearTimeout(reloadDebounceTimeout);
        reloadDebounceTimeout = setTimeout(async () => {
            reloadDebounceTimeout = null;
            if (!isWatcherActive) return;
            console.log(`[ML Hot-Reload] Modification détectée (${reason}). Rechargement à chaud...`);
            const success = await loadMLModel();
            if (success) {
                console.log('[ML Hot-Reload] Nouvelle génération chargée avec succès.');
                // L'arrêt peut avoir eu lieu pendant le chargement asynchrone.
                // Ne pas recréer les watchers après leur fermeture.
                if (isWatcherActive) watchModelFiles();
            }
        }, 500);
    };

    try {
        modelWatchers.push(fs.watch(parentDirPath, (eventType, filename) => {
            if (String(filename || '') === modelDirName) scheduleReload('répertoire modèle remplacé');
        }));
    } catch (error) {
        console.error('[ML Hot-Reload] Surveillance du répertoire parent impossible:', error.message);
    }

    if (fs.existsSync(modelDirPath)) {
        try {
            modelWatchers.push(fs.watch(modelDirPath, (eventType, filename) => {
                const name = String(filename || '');
                if (name.endsWith('.json') || name.endsWith('.bin')) scheduleReload(name);
            }));
        } catch (error) {
            console.error('[ML Hot-Reload] Surveillance du modèle impossible:', error.message);
        }
    }
}

/**
 * Active la surveillance automatique du dossier modèle sur disque (Hot-Reloading à chaud)
 */
export function enableModelHotReload() {
    if (isWatcherActive) return;

    try {
        watchModelFiles();
        isWatcherActive = true;
        console.log('[ML Hot-Reload] Surveillance automatique des mises à jour du modèle activée.');
    } catch (err) {
        console.error('[ML Hot-Reload] Erreur lors de l\'activation de la surveillance:', err.message);
    }
}

export function disableModelHotReload() {
    if (reloadDebounceTimeout) {
        clearTimeout(reloadDebounceTimeout);
        reloadDebounceTimeout = null;
    }
    for (const watcher of modelWatchers) watcher.close();
    modelWatchers = [];
    isWatcherActive = false;
}

export async function extractMLFeatures(participant, course, allParticipants = [], preCalculatedBase = null) {
    const f = preCalculatedBase || await extractBaseFeatures(participant, course);

    // v43: Rang de la côte parmi les partants (0=favori, 1=outsider)
    let rangCoteNorm = 0.5;
    if (allParticipants.length > 1) {
        const sorted = [...allParticipants]
            .filter(p => p.cote_ref && parseFloat(p.cote_ref) > 0)
            .sort((a, b) => parseFloat(a.cote_ref) - parseFloat(b.cote_ref));
        const idx = sorted.findIndex(p => p.id === participant.id || p.nom === participant.nom);
        if (idx !== -1) rangCoteNorm = idx / Math.max(1, sorted.length - 1);
    }

    // v43.1: Aptitude terrain (0.5=neutre/inconnu, 1=préféré).
    // Two missing values are not evidence that the horse prefers this ground.
    const terrainPrefere = String(participant.terrain_prefere || '').trim().toUpperCase();
    const terrainCourse = String(course.terrain || '').trim().toUpperCase();
    const terrainsConnus = value => value && !['?', 'INCONNU', 'UNKNOWN', 'NON_RENSEIGNE', 'N/A'].includes(value);
    const aptitudeTerrain = terrainsConnus(terrainPrefere) && terrainsConnus(terrainCourse)
        && terrainPrefere === terrainCourse ? 1.0 : 0.5;

    return [
        f.forme,
        f.classe,
        f.config,
        f.entourage,
        f.regularite,
        f.confiance,
        f.isTrot,
        f.isShielded,
        f.sentiment,
        f.distanceNorm,
        aptitudeTerrain,
        rangCoteNorm,
        f.cordeNorm,
        f.poidsNorm,
        f.reculNorm
    ];
}

/**
 * Prédiction ML pure (15 caractéristiques figées à la capture pré-course)
 */
async function predictML(participant, contexteCourse, allParticipants = [], preCalculatedFeatures = null) {
    if (!model) return null;

    try {
        const features = preCalculatedFeatures || await extractMLFeatures(participant, contexteCourse, allParticipants);
        if (!Array.isArray(features) || features.length !== 15 || !features.every(Number.isFinite)) return null;
        const tf = await getTF();
        if (!tf) return null;
        let tensor;
        let prediction;
        let probability;
        try {
            tensor = tf.tensor2d([features]);
            prediction = model.predict(tensor);
            probability = await prediction.data();
        } finally {
            tensor?.dispose();
            prediction?.dispose();
        }

        // Recalibrer la sortie du classifieur entraîné sur un jeu équilibré,
        // puis la convertir vers la même échelle de points que l'heuristique.
        const savedPrior = Number(metadata?.rawTrainWinnerRate);
        const populationPrior = Number.isFinite(savedPrior) && savedPrior > 0 && savedPrior < 1
            ? savedPrior
            : 0.075;
        const modelOutput = Number(probability?.[0]);
        if (!Number.isFinite(modelOutput)) return null;
        return mlProbabilityToPoints(modelOutput, populationPrior);
    } catch (error) {
        console.error('[ML] Erreur prédiction:', error.message);
        return null;
    }
}

/**
 * Prédiction hybride : pondération ML/heuristique configurable
 */
export async function calculerPredictionHybride(participant, contexteCourse, activePatterns = [], tousParticipants = [], preCalculatedBaseScores = null) {
    const { preparerBaseScores } = await import('./intelligence.mjs');

    // Utiliser les scores pré-calculés si disponibles (Elite v43.3)
    const baseScores = preCalculatedBaseScores || await preparerBaseScores(participant, contexteCourse);

    const f = await extractBaseFeatures(participant, contexteCourse, baseScores);
    const mlFeatures = await extractMLFeatures(participant, contexteCourse, tousParticipants, f);
    const scoreV14 = await calculerPredictionV14(participant, contexteCourse, activePatterns, baseScores);
    const numericScoreV14 = Number(scoreV14);
    if (!Number.isFinite(numericScoreV14)) throw new Error('Le moteur heuristique n’a pas produit de score valide.');
    const heuristicScore = Math.max(0, Math.min(100, numericScoreV14));

    // Si modèle ML non disponible, fallback sur v14
    if (!model) {
        return { score: heuristicScore, heuristicScore, mlScore: null, xai: f.xai, features: mlFeatures };
    }

    const scoreML = await predictML(participant, contexteCourse, tousParticipants, mlFeatures);

    if (scoreML === null) {
        return { score: heuristicScore, heuristicScore, mlScore: null, xai: f.xai, features: mlFeatures };
    }

    // Le mélange utilise la même pondération que l'évaluation des candidats.
    const { mlWeight, heuristicWeight } = CONFIG.architect.hybride;
    const scoreHybride = combineHybridScores(scoreML, heuristicScore, { mlWeight, heuristicWeight });
    if (scoreHybride === null) return { score: heuristicScore, heuristicScore, mlScore: null, xai: f.xai, features: mlFeatures };

    return {
        score: scoreHybride,
        heuristicScore,
        mlScore: scoreML,
        xai: f.xai,
        features: mlFeatures
    };
}

/**
 * Obtenir les métadonnées du modèle
 */
export function getMLMetadata() {
    return metadata;
}
