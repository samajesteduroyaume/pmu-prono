import * as tf from '@tensorflow/tfjs-node';
import path from 'path';
import fs from 'fs';
import { calculerPrediction as calculerPredictionV14 } from './intelligence.mjs';
import { CONFIG } from '../config/settings.mjs';
import { extractBaseFeatures } from './features.mjs';

const MODEL_PATH = './src/ml/model';
let model = null;
let metadata = null;

/**
 * Chargement du modèle ML au démarrage
 */
export async function loadMLModel() {
    try {
        const modelPath = path.resolve(MODEL_PATH);
        if (!fs.existsSync(modelPath)) {
            console.warn('[ML] Modèle non trouvé, utilisation de v14 uniquement');
            return false;
        }

        model = await tf.loadLayersModel(`file://${modelPath}/model.json`);

        const metaPath = path.join(modelPath, 'metadata.json');
        if (fs.existsSync(metaPath)) {
            metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            console.log(`[ML] Modèle v15 chargé (Accuracy: ${(metadata.testAccuracy * 100).toFixed(2)}%)`);
        }

        return true;
    } catch (error) {
        console.error('[ML] Erreur chargement modèle:', error.message);
        return false;
    }
}

export async function extractMLFeatures(participant, course, allParticipants = []) {
    const f = await extractBaseFeatures(participant, course);

    // v43: Rang de la côte parmi les partants (0=favori, 1=outsider)
    let rangCoteNorm = 0.5;
    if (allParticipants.length > 1) {
        const sorted = [...allParticipants]
            .filter(p => p.cote_ref && parseFloat(p.cote_ref) > 0)
            .sort((a, b) => parseFloat(a.cote_ref) - parseFloat(b.cote_ref));
        const idx = sorted.findIndex(p => p.id === participant.id || p.nom === participant.nom);
        if (idx !== -1) rangCoteNorm = idx / Math.max(1, sorted.length - 1);
    }

    // v43.1: Normalisation de la distance (Base 2000m)
    const distanceNorm = Math.min(1.5, (participant.distance_course || 2000) / 2000);
    
    // v43.1: Aptitude terrain (0=Inconnu/Douteux, 1=Préféré)
    const aptitudeTerrain = (participant.terrain_prefere === course.terrain) ? 1.0 : 0.5;

    // v43.2: Normalisation des nouvelles caractéristiques
    const cordeNorm = (participant.corde || 0) / 20; // Corde 1-20
    const poidsNorm = ((participant.poids || 60) - 50) / 20; // Poids 50-70kg
    const reculNorm = ((participant.recul || 0)) / 100; // Recul (25m = 0.25)

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
        distanceNorm,
        aptitudeTerrain,
        rangCoteNorm,
        cordeNorm,
        poidsNorm,
        reculNorm
    ];
}

/**
 * Prédiction ML pure (V40+ avec 10 features)
 */
async function predictML(participant, contexteCourse, allParticipants = []) {
    if (!model) return null;

    try {
        const features = await extractMLFeatures(participant, contexteCourse, allParticipants);
        const tensor = tf.tensor2d([features]);
        const prediction = model.predict(tensor);
        const probability = await prediction.data();

        tensor.dispose();
        prediction.dispose();

        // Convertir probabilité (0-1) en score (0-100)
        let prob = probability[0];
        
        // v43.3: Platt Scaling pour corriger le biais d'undersampling (ratio 1:1 vs réalité ~1:13)
        // Ratio d'undersampling = 1 gagnant / 13 perdants approx = 0.075
        const undersampling_ratio = 0.075;
        prob = prob / (prob + (1 - prob) / undersampling_ratio);
        
        let scoreML = 0;
        
        // v43.1: Courbe de calibration lissée pour éviter les effets de seuil
        if (prob >= 0.45) {
            scoreML = 90 + ((prob - 0.45) / 0.55) * 10;
        } else if (prob >= 0.35) {
            scoreML = 80 + ((prob - 0.35) / 0.10) * 10;
        } else if (prob >= 0.25) {
            scoreML = 70 + ((prob - 0.25) / 0.10) * 10;
        } else if (prob >= 0.15) {
            scoreML = 55 + ((prob - 0.15) / 0.10) * 15;
        } else if (prob >= 0.08) {
            scoreML = 35 + ((prob - 0.08) / 0.07) * 20;
        } else {
            scoreML = (prob / 0.08) * 35;
        }
        
        return Math.min(100, Math.max(0, Math.round(scoreML)));
    } catch (error) {
        console.error('[ML] Erreur prédiction:', error.message);
        return null;
    }
}

/**
 * Prédiction Hybride : 70% ML + 30% Heuristiques v14
 */
export async function calculerPredictionHybride(participant, contexteCourse, activePatterns = [], tousParticipants = [], preCalculatedBaseScores = null) {
    const { preparerBaseScores } = await import('./intelligence.mjs');
    
    // Utiliser les scores pré-calculés si disponibles (Elite v43.3)
    const baseScores = preCalculatedBaseScores || await preparerBaseScores(participant, contexteCourse, activePatterns);
    
    const f = extractBaseFeatures(participant, contexteCourse);
    const scoreV14 = await calculerPredictionV14(participant, contexteCourse, activePatterns);

    // Si modèle ML non disponible, fallback sur v14
    if (!model) {
        return { score: scoreV14, xai: f.xai };
    }

    const scoreML = await predictML(participant, contexteCourse, tousParticipants);

    if (scoreML === null) {
        return { score: scoreV14, xai: f.xai };
    }

    // Hybride v27.1 : Poids paramétrables (70% ML + 30% Heuristiques par défaut)
    const { mlWeight, heuristicWeight } = CONFIG.architect.hybride;
    const scoreHybride = Math.round((scoreML * mlWeight) + (scoreV14 * heuristicWeight));

    return {
        score: scoreHybride,
        xai: f.xai
    };
}

/**
 * Obtenir les métadonnées du modèle
 */
export function getMLMetadata() {
    return metadata;
}
