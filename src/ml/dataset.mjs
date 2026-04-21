import { initDB, closeDB } from '../core/db.mjs';
import sqlite3 from 'sqlite3';
import { CONFIG } from '../config/settings.mjs';
import logger from '../utils/logger.mjs';

/**
 * Extraction et normalisation des features pour le ML
 */

function normalizeValue(value, min, max) {
    if (max === min) return 0.5;
    return (value - min) / (max - min);
}

import { extractBaseFeatures } from '../core/features.mjs';
import { calculerPrediction } from '../core/intelligence.mjs';

async function extractFeatures(participant, course) {
    const expertScore = await calculerPrediction(participant, course);
    const f = extractBaseFeatures(participant, course, expertScore);
    return {
        features: [
            f.forme,
            f.classe,
            f.config,
            f.entourage,
            f.regularite,
            f.confiance,
            f.isTrot,
            f.isShielded,
            f.sentiment,
            f.expertScore
        ]
    };
}

export async function prepareDataset() {
    logger.header('PRÉPARATION DATASET ML');
    await initDB();

    const db = new sqlite3.Database(CONFIG.database.path);

    return new Promise((resolve, reject) => {
        db.all(`
            SELECT p.*, c.discipline, c.prix, c.ordre_arrivee
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
        `, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            const dataset = [];
            
            async function processRows() {
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    if (i % 100 === 0) logger.info(`Traitement participant ${i}/${rows.length}...`);
                    
                    const contexts = { discipline: row.discipline, prixCourse: row.prix };
                    const expertScore = await calculerPrediction(row, contexts);
                    const f = extractBaseFeatures(row, contexts, expertScore);

                    const featureVector = [
                        f.forme, f.classe, f.config, f.entourage, f.regularite, 
                        f.confiance, f.isTrot, f.isShielded, f.sentiment, f.expertScore
                    ];

                    const arrivee = row.ordre_arrivee || '';
                    const positions = arrivee.split('-').map(n => parseInt(n));
                    const isWinner = positions[0] === row.numero ? 1 : 0;

                    dataset.push({
                        features: featureVector,
                        label: isWinner
                    });
                }
            }

            processRows().then(() => {

            // Split train/test (80/20)
            const shuffled = dataset.sort(() => Math.random() - 0.5);
            const splitIndex = Math.floor(shuffled.length * 0.8);

            const trainData = shuffled.slice(0, splitIndex);
            const testData = shuffled.slice(splitIndex);

                logger.success(`Dataset préparé : ${trainData.length} train, ${testData.length} test`);

                db.close();
                resolve({ trainData, testData });
            });
        });
    });
}

// Test si exécuté directement
if (import.meta.url === `file://${process.argv[1]}`) {
    prepareDataset().then(async (data) => {
        console.log('Sample train:', data.trainData.slice(0, 3));
        console.log('Sample test:', data.testData.slice(0, 3));
        await closeDB();
        process.exit(0);
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
