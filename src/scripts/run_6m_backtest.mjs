import { runBacktest, compareKellyStrategies } from '../ml/backtest.mjs';
import { format, subMonths } from 'date-fns';
import logger from '../utils/logger.mjs';
import fs from 'fs';

async function main() {
    const today = new Date();
    const startDate = format(subMonths(today, 6), 'yyyy-MM-dd');
    const endDate = format(today, 'yyyy-MM-dd');

    logger.header(`--- LANCEMENT VALIDATION ROI V40+ (6 MOIS) ---`);
    logger.info(`Période : ${startDate} au ${endDate}`);

    try {
        // 1. Backtest Standard (Mise Fixe 1€)
        const standardResult = await runBacktest(startDate, endDate);
        
        // 2. Comparaison Stratégies Kelly
        const kellyResult = await compareKellyStrategies(startDate, endDate, 1000);

        // 3. Synthèse Finale
        const finalReport = {
            generatedAt: new Date().toISOString(),
            period: { start: startDate, end: endDate },
            standard: standardResult.summary,
            kelly: kellyResult.strategies
        };

        const reportPath = './data/backtest_report_6m.json';
        fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2));
        
        logger.header(`--- BACKTEST RÉUSSI ---`);
        logger.success(`Rapport généré : ${reportPath}`);
        
        // Affichage rapide du gagnant
        const bestStrat = Object.entries(kellyResult.strategies)
            .sort((a, b) => b[1].roi - a[1].roi)[0];
        
        logger.info(`\nMeilleure stratégie identifiée : ${bestStrat[0]}`);
        logger.success(`ROI Final : ${bestStrat[1].roi}%`);
        logger.info(`Profit Net : ${bestStrat[1].profit}€`);
        
    } catch (error) {
        logger.error(`Erreur Backtest : ${error.message}`);
        console.error(error);
    }
}

main().catch(console.error);
