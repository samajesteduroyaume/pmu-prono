import { initDB, getAllCourses, getCourseParticipants } from '../core/db.mjs';
import { calculerPredictionHybride, loadMLModel } from '../core/hybrid.mjs';
import logger from '../utils/logger.mjs';

/**
 * MOTEUR DE BACKTESTING ELITE v1.0
 */
export async function runBacktest(startDate, endDate) {
    logger.header(`LANCEMENT BACKTEST : ${startDate} au ${endDate}`);

    await initDB();
    await loadMLModel();

    const courses = await getAllCourses();
    const filtered = courses.filter(c => {
        const d = c.date;
        return d >= startDate && d <= endDate && c.ordre_arrivee;
    });

    logger.info(`${filtered.length} courses trouvées avec résultats.`);

    let stats = {
        total: 0,
        wins: 0,
        investment: 0,
        returns: 0,
        history: []
    };

    for (const course of filtered) {
        const participants = await getCourseParticipants(course.id);
        if (participants.length === 0) continue;

        // Calculer les prédictions hybrides pour tous les participants
        const predictions = await Promise.all(participants.map(async p => {
            const res = await calculerPredictionHybride(p, course);
            return { ...p, score: res.score };
        }));

        // Trier par score IA
        predictions.sort((a, b) => b.score - a.score);

        const top1 = predictions[0];
        const arrivee = course.ordre_arrivee.split('-').map(n => parseInt(n));
        const winnerNum = arrivee[0];

        const isWin = top1.numero === winnerNum;

        stats.total++;
        stats.investment += 1; // Mise de 1€ par course

        if (isWin) {
            stats.wins++;
            // Note: Pour le backtest précis, on devrait utiliser le rapport Simple Gagnant réel
            // Mais si on ne l'a pas, on peut estimer avec la cote_ref (ou mieux, chercher dans rapports)
            let rapport = parseFloat(top1.cote_ref) || 2.0;

            // Si on a les rapports réels dans la BDD, on les utilise
            if (course.rapports) {
                try {
                    const raps = JSON.parse(course.rapports);
                    const list = raps.paysParieur?.[0]?.rapports || [];
                    const simpleGagnant = list.find(r => r.libellePari === 'E_SIMPLE_GAGNANT' && r.combinaison === top1.numero.toString());
                    if (simpleGagnant) {
                        rapport = simpleGagnant.dividende / 100;
                    }
                } catch (e) { }
            }

            stats.returns += rapport;
        }

        stats.history.push({
            date: course.date,
            course: `${course.reunionNum}C${course.courseNum}`,
            selection: top1.nom,
            score: top1.score,
            resultat: isWin ? 'WIN' : 'LOSS',
            net: isWin ? (stats.returns - stats.investment) : (stats.returns - stats.investment)
        });
    }

    const roi = ((stats.returns - stats.investment) / stats.investment) * 100;

    logger.success(`BACKTEST TERMINÉ`);
    logger.info(`Total Courses : ${stats.total}`);
    logger.info(`Taux de réussite : ${((stats.wins / stats.total) * 100).toFixed(2)}%`);
    logger.info(`ROI : ${roi.toFixed(2)}%`);
    logger.info(`Profit Net : ${(stats.returns - stats.investment).toFixed(2)} €`);

    return {
        summary: {
            total: stats.total,
            wins: stats.wins,
            winRate: ((stats.wins / stats.total) * 100).toFixed(2),
            investment: stats.investment,
            returns: stats.returns,
            profit: (stats.returns - stats.investment).toFixed(2),
            roi: roi.toFixed(2)
        },
        history: stats.history
    };
}

// Auto-run if executed directly
if (process.argv[1].includes('backtest.mjs')) {
    const start = process.argv[2] || '2026-01-01';
    const end = process.argv[3] || '2026-12-31';
    runBacktest(start, end).then(() => process.exit(0));
}
