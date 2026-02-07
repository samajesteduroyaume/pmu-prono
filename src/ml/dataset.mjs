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

function extractFeatures(participant, course) {
    const f = extractBaseFeatures(participant, course);
    return {
        features: [
            f.forme,
            f.classe,
            f.config,
            f.entourage,
            f.regularite,
            f.confiance,
            f.isTrot
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

            logger.info(`Analyse de ${rows.length} participants avec résultats...`);

            const dataset = rows.map(row => {
                const f = extractBaseFeatures(row, { discipline: row.discipline, prix: row.prix });

                // Features vector [7]
                const featureVector = [
                    f.forme,
                    f.classe,
                    f.config,
                    f.entourage,
                    f.regularite,
                    f.confiance,
                    f.isTrot
                ];

                // Label : 1 si gagnant (1er), 0 sinon
                const arrivee = row.ordre_arrivee || '';
                const positions = arrivee.split('-').map(n => parseInt(n));
                const isWinner = positions[0] === row.numero ? 1 : 0;

                return {
                    features: featureVector,
                    label: isWinner
                };
            });

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
