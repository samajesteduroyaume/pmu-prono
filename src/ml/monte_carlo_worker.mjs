import { parentPort, workerData } from 'worker_threads';
import { runBacktest } from './backtest.mjs';
import logger from '../utils/logger.mjs';

/**
 * Worker pour simulation Monte Carlo
 */
async function runSimulation() {
    const { startDate, endDate, simulationIndex } = workerData;
    
    try {
        // Désactiver certains logs pour ne pas polluer la console principale
        // On pourrait passer un flag au logger
        
        const result = await runBacktest(startDate, endDate);
        
        // Envoyer le résultat au thread principal
        parentPort.postMessage({
            index: simulationIndex,
            profit: parseFloat(result.summary.profit),
            success: true
        });
    } catch (error) {
        parentPort.postMessage({
            index: simulationIndex,
            error: error.message,
            success: false
        });
    }
}

runSimulation();
