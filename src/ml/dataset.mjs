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

import { extractMLFeatures } from '../core/hybrid.mjs';

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
        `, async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            try {
                const dataset = [];
                const coursesMap = new Map();
                for (const row of rows) {
                    if (!coursesMap.has(row.course_id)) coursesMap.set(row.course_id, []);
                    coursesMap.get(row.course_id).push(row);
                }

                let processed = 0;
                for (const [course_id, participants] of coursesMap.entries()) {
                    for (const row of participants) {
                        processed++;
                        if (processed % 100 === 0) logger.info(`Traitement participant ${processed}/${rows.length}...`);
                        
                        const contexts = { discipline: row.discipline, prixCourse: row.prix };
                        
                        // Use exact same features as inference
                        const featureVector = await extractMLFeatures(row, contexts, participants);

                        const arrivee = row.ordre_arrivee || '';
                        const positions = arrivee.split('-').map(n => parseInt(n));
                        
                        const isWinner = positions[0] === row.numero ? 1 : 0;

                        // Ensure there are no undefined values in the vector
                        const safeVector = featureVector.map(v => v === undefined || isNaN(v) ? 0.5 : v);

                        dataset.push({
                            features: safeVector,
                            label: isWinner
                        });
                    }
                }

                // v43.1: Gestion de l'imbalance (Undersampling des perdants)
                const winners = dataset.filter(d => d.label === 1);
                const losers = dataset.filter(d => d.label === 0);
                
                logger.info(`Données brutes : ${winners.length} gagnants, ${losers.length} perdants`);

                // On prend autant de perdants que de gagnants (Ratio 1:1) pour équilibrer l'apprentissage
                const balancedLosers = losers.sort(() => Math.random() - 0.5).slice(0, winners.length);
                const balancedDataset = [...winners, ...balancedLosers];

                // Split train/test (80/20) sur le dataset équilibré
                const shuffled = balancedDataset.sort(() => Math.random() - 0.5);
                const splitIndex = Math.floor(shuffled.length * 0.8);

                const trainData = shuffled.slice(0, splitIndex);
                const testData = shuffled.slice(splitIndex);

                logger.success(`Dataset équilibré préparé : ${trainData.length} train, ${testData.length} test`);
                logger.info(`Ratio final : 1 gagnant pour 1 perdant`);

                db.close();
                resolve({ trainData, testData });
            } catch (error) {
                db.close();
                reject(error);
            }
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
