import { initDB, closeDB } from '../db/db.mjs';
import { settleShadowBets } from '../db/repositories/pariRepo.mjs';
import logger from '../utils/logger.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';

async function resolveBets() {
    await initDB();
    logger.header('RÉSOLUTION DES SHADOW BETS');
    try {
        const updated = await settleShadowBets();
        logger.info(`${updated} paris simulés réglés ou actualisés depuis les rapports officiels.`);
    } finally {
        await closeDB();
    }
    logger.info('Résolution terminée.');
}

if (isMainModule(import.meta.url)) {
    resolveBets().catch(err => {
        console.error('Fatal Error:', err);
        process.exitCode = 1;
    });
}

export { resolveBets };
