import { runBacktest } from './src/ml/backtest.mjs';
import { initDB, closeDB, getDB } from './src/db/db.mjs';
import logger from './src/utils/logger.mjs';

async function analyzeDisciplines() {
    await initDB();
    const db = getDB();

    const disciplines = ['ATTELE', 'MONTE', 'PLAT', 'HAIE', 'STEEPLECHASE', 'CROSS'];
    const results = [];

    logger.header('ANALYSE PAR DISCIPLINE (v43.1)');

    for (const disc of disciplines) {
        logger.info(`Analyse : ${disc}...`);
        
        // On récupère les courses de cette discipline
        const courses = await new Promise((resolve) => {
            db.all("SELECT id FROM courses WHERE discipline = ? AND ordre_arrivee IS NOT NULL", [disc], (err, rows) => resolve(rows || []));
        });

        if (courses.length < 50) {
            logger.warn(`Pas assez de données pour ${disc} (${courses.length} courses)`);
            continue;
        }

        // Pour l'analyse, on va modifier temporairement le filtrage dans runBacktest ou utiliser un wrapper
        // Ici, on va faire un backtest global et filtrer les résultats manuellement pour plus de simplicité
        const backtestResult = await runBacktest('2026-01-01', '2026-12-31');
        
        // On filtre l'historique par discipline (il faut que l'historique contienne la discipline)
        // Note: backtest.mjs ne renvoie pas la discipline dans l'historique par défaut.
        // Je vais devoir ajuster backtest.mjs pour inclure la discipline dans l'historique.
    }

    await closeDB();
}

// On va plutôt modifier backtest.mjs pour qu'il calcule lui-même ces stats.
