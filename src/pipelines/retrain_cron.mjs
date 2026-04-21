import { trainModel } from '../ml/train.mjs';
import logger from '../utils/logger.mjs';

/**
 * AUTOMATED RETRAIN PIPELINE (V42)
 * Se recharge sur le dataset avec ses nouvelles features continues
 * Recommandé le Dimanche soir à 23h30
 */
async function autoRetrain() {
    logger.header('PIPELINE: APPRENTISSAGE MACHINE CONTINU (CRON)');
    logger.info('Démarrage du Deep Learning pour actualiser le modèle...');
    
    try {
        const metadata = await trainModel();
        logger.success('Apprentissage continu complété !');
        logger.info(`Nouvelle Accuracy: ${(metadata.testAccuracy * 100).toFixed(2)}%`);
        logger.info(`Perte Finale: ${metadata.testLoss.toFixed(4)}`);
    } catch (err) {
        logger.error(`Erreur fatale de réentrainement ML: ${err.message}`);
        process.exit(1);
    }
}

// Exécution cron stand-alone
if (import.meta.url === `file://${process.argv[1]}`) {
    autoRetrain().then(() => process.exit(0));
}
