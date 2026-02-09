
import { initDB, closeDB, getChevauxEnRetardDeGain } from '../src/core/db.mjs';
import logger from '../src/utils/logger.mjs';

async function main() {
    try {
        await initDB();
        console.log("🔍 Recherche des chevaux en 'Retard de Gain' (Qualité Intrisèque > Moyenne Course)...");

        const targets = await getChevauxEnRetardDeGain(3); // Prochains 3 jours

        if (targets.length === 0) {
            console.log("Aucun cheval détecté pour le moment.");
        } else {
            console.log(`\n✅ ${targets.length} opportunités détectées :\n`);
            console.table(targets.map(t => ({
                Date: t.date,
                R_C: `R${t.reunion} C${t.course}`,
                Cheval: t.cheval,
                'Gain/Course': t.ratio_cheval,
                'Moyenne Course': t.ratio_moyen_course,
                'Diff %': `+${t.diff_percent}%`
            })));
        }

        await closeDB();
    } catch (e) {
        logger.error(e);
    }
}

main();
