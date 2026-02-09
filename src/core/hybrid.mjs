import * as tf from '@tensorflow/tfjs-node';
import path from 'path';
import fs from 'fs';
import { calculerPrediction as calculerPredictionV14 } from './intelligence.mjs';

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

function extractMLFeatures(participant, course) {
    const f = extractBaseFeatures(participant, course);
    return [
        f.forme,
        f.classe,
        f.config,
        f.entourage,
        f.regularite,
        f.confiance,
        f.isTrot,
        f.isShielded
    ];
}

/**
 * Prédiction ML pure
 */
async function predictML(participant, contexteCourse) {
    if (!model) return null;

    try {
        const features = extractMLFeatures(participant, contexteCourse);
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

    // Hybride : 70% ML + 30% v14
    const scoreHybride = Math.round((scoreML * 0.7) + (scoreV14 * 0.3));

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
