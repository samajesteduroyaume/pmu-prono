import { initDB, getDB, closeDB } from '../db/db.mjs';
import logger from '../utils/logger.mjs';

async function resolveBets() {
    await initDB();
    const db = getDB();

    logger.header('RÉSOLUTION DES SHADOW BETS');

    const pendingBets = await new Promise((resolve) => {
        db.all(`
            SELECT b.*, p.classement 
            FROM shadow_bets b
            JOIN participants p ON b.participant_id = p.id
            WHERE b.resultat = 'PENDING' AND p.classement IS NOT NULL
        `, (err, rows) => resolve(rows || []));
    });

    logger.info(`${pendingBets.length} paris en attente de résolution avec résultats disponibles.`);

    for (const bet of pendingBets) {
        const isWin = parseInt(bet.classement) === 1;
        const result = isWin ? 'WIN' : 'LOSE';
        const gain = isWin ? (bet.mise * bet.cote - bet.mise) : -bet.mise;

        await new Promise((resolve) => {
            db.run(`
                UPDATE shadow_bets 
                SET resultat = ?, gain = ? 
                WHERE id = ?
            `, [result, gain, bet.id], resolve);
        });

        logger.success(`Bet #${bet.id} resolved: ${bet.nom} -> ${result} (Gain: ${gain.toFixed(2)}€)`);
    }

    await closeDB();
    logger.info('Résolution terminée.');
}

resolveBets().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
