import { getForecastEvaluation } from '../core/forecast_evaluation.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDB, initDB, closeDB } from '../core/db.mjs';

/**
 * Compatibilité CLI : évalue uniquement les prédictions capturées avant course.
 * Aucune prédiction historique n'est recalculée avec le modèle courant.
 */
export async function runBacktest(startDate, endDate) {
    let ownsDatabase = false;
    try { getDB(); } catch { await initDB(); ownsDatabase = true; }
    try {
        const evaluation = await getForecastEvaluation({ startDate, endDate });
        const ia = evaluation.comparison.find(row => row.label.startsWith('IA (meilleur score'));
        return {
            summary: {
                total: ia?.settled || 0,
                wins: ia?.wins || 0,
                winRate: ia?.winRate,
                roi: ia?.roi,
                roiStatus: ia?.roiStatus
            },
            evaluation
        };
    } finally {
        if (ownsDatabase) await closeDB();
    }
}

export async function compareKellyStrategies() {
    throw new Error('Comparaison Kelly désactivée : elle utilisait des pronostics et cotes historiques recalculés. Utilisez getForecastEvaluation pour les résultats prospectifs observés.');
}

export async function runMonteCarloSimulation() {
    throw new Error('Monte Carlo désactivé : aucune simulation fiable ne peut être dérivée des anciennes données recalculées.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const start = process.argv[2];
    const end = process.argv[3];
    runBacktest(start, end)
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {
            console.error(`Erreur évaluation : ${error.message}`);
            process.exitCode = 1;
        });
}
