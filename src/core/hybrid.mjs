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

/**
 * Extraction des features pour le ML (identique à dataset.mjs)
 */
function extractMLFeatures(participant) {
    const musique = participant.musique || '';
    const perfs = musique.match(/([0-9DA]|Dist)[a-zA-Z]/g) || [];
    let scoreForme = 0;
    if (perfs.length > 0) {
        const recent = perfs.slice(0, 3);
        const wins = recent.filter(p => p.startsWith('1')).length;
        const places = recent.filter(p => ['2', '3'].some(n => p.startsWith(n))).length;
        scoreForme = (wins * 100 + places * 50) / recent.length;
    }

    const age = parseInt(participant.age) || 5;
    const gains = parseFloat(participant.gains) || 0;
    const scoreClasse = Math.min((gains / (age * 12000)) * 100, 100);

    const nbCourses = participant.nb_courses || 1;
    const scoreReg = ((participant.nb_victoires + participant.nb_places) / nbCourses) * 100;

    const topDrivers = ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'BARZALONA', 'SOUMILLON', 'GUYON'];
    const driver = (participant.driver || '').toUpperCase();
    const scoreEntourage = topDrivers.some(d => driver.includes(d)) ? 100 : 30;

    const cote = parseFloat(participant.cote_ref) || 10;
    const scoreConfiance = cote < 3 ? 100 : (cote < 6 ? 80 : (cote < 12 ? 50 : 20));

    return [
        scoreForme / 100,
        scoreClasse / 100,
        scoreReg / 100,
        scoreEntourage / 100,
        scoreConfiance / 100
    ];
}

/**
 * Prédiction ML pure
 */
async function predictML(participant) {
    if (!model) return null;

    try {
        const features = extractMLFeatures(participant);
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
export async function calculerPredictionHybride(participant, contexteCourse) {
    const scoreV14 = calculerPredictionV14(participant, contexteCourse);

    // Si modèle ML non disponible, fallback sur v14
    if (!model) {
        return scoreV14;
    }

    const scoreML = await predictML(participant);

    if (scoreML === null) {
        return scoreV14;
    }

    // Hybride : 70% ML + 30% v14
    const scoreHybride = (scoreML * 0.7) + (scoreV14 * 0.3);

    return Math.round(scoreHybride);
}

/**
 * Obtenir les métadonnées du modèle
 */
export function getMLMetadata() {
    return metadata;
}
