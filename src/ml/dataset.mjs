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

function extractFeatures(participant, course) {
    // Feature 1 : Score Forme (musique)
    const musique = participant.musique || '';
    const perfs = musique.match(/([0-9DA]|Dist)[a-zA-Z]/g) || [];
    let scoreForme = 0;
    if (perfs.length > 0) {
        const recent = perfs.slice(0, 3);
        const wins = recent.filter(p => p.startsWith('1')).length;
        const places = recent.filter(p => ['2', '3'].some(n => p.startsWith(n))).length;
        scoreForme = (wins * 100 + places * 50) / recent.length;
    }

    // Feature 2 : Classe (gains/âge)
    const age = parseInt(participant.age) || 5;
    const gains = parseFloat(participant.gains) || 0;
    const scoreClasse = Math.min((gains / (age * 12000)) * 100, 100);

    // Feature 3 : Régularité
    const nbCourses = participant.nb_courses || 1;
    const scoreReg = ((participant.nb_victoires + participant.nb_places) / nbCourses) * 100;

    // Feature 4 : Entourage (Driver/Jockey)
    const topDrivers = ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'BARZALONA', 'SOUMILLON', 'GUYON'];
    const driver = (participant.driver || '').toUpperCase();
    const scoreEntourage = topDrivers.some(d => driver.includes(d)) ? 100 : 30;

    // Feature 5 : Cote (confiance marché)
    const cote = parseFloat(participant.cote_ref) || 10;
    const scoreConfiance = cote < 3 ? 100 : (cote < 6 ? 80 : (cote < 12 ? 50 : 20));

    return {
        forme: scoreForme / 100,
        classe: scoreClasse / 100,
        regularite: scoreReg / 100,
        entourage: scoreEntourage / 100,
        confiance: scoreConfiance / 100
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
                const features = extractFeatures(row, { discipline: row.discipline, prix: row.prix });

                // Label : 1 si gagnant (1er), 0 sinon
                const arrivee = row.ordre_arrivee || '';
                const positions = arrivee.split('-').map(n => parseInt(n));
                const isWinner = positions[0] === row.numero ? 1 : 0;

                return {
                    features: [
                        features.forme,
                        features.classe,
                        features.regularite,
                        features.entourage,
                        features.confiance
                    ],
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
