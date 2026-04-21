import * as tf from '@tensorflow/tfjs-node';
import path from 'path';
import fs from 'fs';
import { calculerPrediction as calculerPredictionV14 } from './intelligence.mjs';
import { CONFIG } from '../config/settings.mjs';

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

import { extractBaseFeatures } from './features.mjs';

function extractMLFeatures(participant, course, allParticipants = []) {
    const f = extractBaseFeatures(participant, course);

    // v43: Rang de la côte parmi les partants (0=favori, 1=outsider)
    // Signal non-circulaire qui remplace l'expertScore neutralisé à 0.5
    let rangCoteNorm = 0.5;
    if (allParticipants.length > 1) {
        const sorted = [...allParticipants]
            .filter(p => p.cote_ref && parseFloat(p.cote_ref) > 0)
            .sort((a, b) => parseFloat(a.cote_ref) - parseFloat(b.cote_ref));
        const idx = sorted.findIndex(p => p.id === participant.id || p.nom === participant.nom);
        if (idx !== -1) rangCoteNorm = idx / Math.max(1, sorted.length - 1);
    }

    // v43: Nombre de partants normalisé (plus de partants = épreuve plus dure)
    const nbrePartantsNorm = Math.min(1, (allParticipants.length || 10) / 20);

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
        rangCoteNorm  // v43: Remplace 0.5 statique (feature circulaire)
    ];
}

/**
 * Prédiction ML pure (V40+ avec 10 features)
 */
async function predictML(participant, contexteCourse, allParticipants = []) {
    if (!model) return null;

    try {
        const features = extractMLFeatures(participant, contexteCourse, allParticipants);
        const tensor = tf.tensor2d([features]);
        const prediction = model.predict(tensor);
        const probability = await prediction.data();

        tensor.dispose();
        prediction.dispose();

        // Convertir probabilité (0-1) en score (0-100)
        return probability[0] * 100;
    } catch (error) {
        console.error('[ML] Erreur prédiction:', error.message);
        return null;
    }
}

/**
 * Prédiction Hybride : 70% ML + 30% Heuristiques v14
 */
export async function calculerPredictionHybride(participant, contexteCourse, activePatterns = []) {
    const f = extractBaseFeatures(participant, contexteCourse);
    const scoreV14 = await calculerPredictionV14(participant, contexteCourse, activePatterns);

    // Si modèle ML non disponible, fallback sur v14
    if (!model) {
        return { score: scoreV14, xai: f.xai };
    }

    const scoreML = await predictML(participant, contexteCourse);

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
