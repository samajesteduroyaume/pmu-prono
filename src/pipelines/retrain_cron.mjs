import { trainModel } from '../ml/train.mjs';
import logger from '../utils/logger.mjs';
import { loadMLModel } from '../core/hybrid.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';

/**
 * AUTOMATED RETRAIN PIPELINE (V42)
 * Se recharge sur le dataset avec ses nouvelles features continues
 * Recommandé le Dimanche soir à 23h30
 */
export async function autoRetrain(options = {}) {
    const { isStandalone = false } = options;
    logger.header('PIPELINE: APPRENTISSAGE MACHINE CONTINU (CRON)');
    logger.info('Démarrage du Deep Learning pour actualiser le modèle...');
    
    try {
        const metadata = await trainModel({ closeDbAtEnd: isStandalone });
        logger.success('Apprentissage continu complété !');
        const mlHitRate = metadata.testMlTop1HitRate ?? metadata.testTop1HitRate;
        logger.info(`Top 1 ML seul sur ${metadata.testCourseCount} courses temporelles de test : ${(mlHitRate * 100).toFixed(2)}%`);
        if (Number.isFinite(metadata.testForecastTop1HitRate)) {
            logger.info(`Top 1 du pronostic hybride archivé : ${(metadata.testForecastTop1HitRate * 100).toFixed(2)}% (${metadata.testForecastCourseCount} courses)`);
        }
        if (Number.isFinite(metadata.testMarketTop1HitRate)) {
            logger.info(`Favori marché archivé : ${(metadata.testMarketTop1HitRate * 100).toFixed(2)}% (${metadata.testMarketCourseCount} courses)`);
        }
        if (Number.isFinite(metadata.testMatchedMlTop1HitRate)
            && Number.isFinite(metadata.testMatchedForecastTop1HitRate)
            && Number.isFinite(metadata.testMatchedMarketTop1HitRate)) {
            logger.info(`Comparaison Top 1 sur les mêmes ${metadata.testMatchedCourseCount} courses : ML ${(metadata.testMatchedMlTop1HitRate * 100).toFixed(2)}%, heuristique ${(metadata.testMatchedForecastTop1HitRate * 100).toFixed(2)}%, marché ${(metadata.testMatchedMarketTop1HitRate * 100).toFixed(2)}%`);
        }

        // Rechargement immédiat du modèle en mémoire dans le serveur actif
        const reloaded = await loadMLModel();
        if (reloaded) {
            logger.success('[CRON] Nouveau modèle IA rechargé en mémoire avec succès !');
        }

        // Notification HTTP fallback
        try {
            const port = process.env.PORT || 3000;
            const res = await fetch(`http://localhost:${port}/api/ml/reload`, { method: 'POST' });
            if (res.ok) {
                logger.success('[CRON] Signal de Hot-Reload envoyé au serveur web actif.');
            }
        } catch (e) {
            // Le serveur n'est pas sur ce port ou est déjà rechargé en mémoire
        }

        return metadata;
    } catch (err) {
        logger.error(`Erreur fatale de réentrainement ML: ${err.message}`);
        if (isStandalone) {
            process.exit(1);
        } else {
            throw err;
        }
    }
}

// Exécution cron stand-alone
if (isMainModule(import.meta.url)) {
    autoRetrain({ isStandalone: true }).then(() => process.exit(0));
}
