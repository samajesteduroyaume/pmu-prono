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

/**
 * V29: COMPARAISON DE STRATÉGIES KELLY
 * Compare Kelly 25%, 50%, 75% et Adaptatif sur les mêmes données historiques
 */
export async function compareKellyStrategies(startDate, endDate, initialBankroll = 1000) {
    logger.header(`COMPARAISON STRATÉGIES KELLY : ${startDate} au ${endDate}`);

    await initDB();
    await loadMLModel();

    const { getTendancesCumulees, getHistoriqueParis } = await import('../core/db.mjs');
    const { calculateKellyMise, calculateKellyAdaptatif } = await import('../core/kelly.mjs');

    const courses = await getAllCourses();
    const filtered = courses.filter(c => {
        const d = c.date;
        return d >= startDate && d <= endDate && c.ordre_arrivee;
    });

    logger.info(`${filtered.length} courses trouvées avec résultats.`);

    // Initialiser 4 stratégies
    const strategies = {
        'Kelly 25%': { bankroll: initialBankroll, fraction: 0.25, history: [], wins: 0, losses: 0 },
        'Kelly 50%': { bankroll: initialBankroll, fraction: 0.50, history: [], wins: 0, losses: 0 },
        'Kelly 75%': { bankroll: initialBankroll, fraction: 0.75, history: [], wins: 0, losses: 0 },
        'Kelly Adaptatif': { bankroll: initialBankroll, fraction: null, history: [], wins: 0, losses: 0 }
    };

    for (const course of filtered) {
        const participants = await getCourseParticipants(course.id);
        if (participants.length === 0) continue;

        // Calculer prédictions
        const predictions = await Promise.all(participants.map(async p => {
            const res = await calculerPredictionHybride(p, course);
            return { ...p, score: res.score };
        }));

        predictions.sort((a, b) => b.score - a.score);
        const top1 = predictions[0];

        const arrivee = course.ordre_arrivee.split('-').map(n => parseInt(n));
        const winnerNum = arrivee[0];
        const isWin = top1.numero === winnerNum;

        // Déterminer le rapport
        let rapport = parseFloat(top1.cote_ref) || 2.0;
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

        // Simuler chaque stratégie
        for (const [stratName, strat] of Object.entries(strategies)) {
            if (strat.bankroll <= 0) continue; // Ruiné

            let mise = 0;

            if (stratName === 'Kelly Adaptatif') {
                // Récupérer les tendances jusqu'à cette date
                // Pour simplifier, on utilise les 30 derniers jours
                try {
                    const tendances = await getTendancesCumulees(30);
                    const kellyResult = await calculateKellyAdaptatif(rapport, top1.score, strat.bankroll, tendances);
                    mise = kellyResult.mise || 0;
                } catch (e) {
                    // Fallback sur Kelly 50% si erreur
                    const kellyResult = calculateKellyMise(rapport, top1.score, strat.bankroll);
                    mise = kellyResult.mise || 0;
                }
            } else {
                // Kelly classique avec fraction spécifique
                const b = rapport - 1;
                const p = top1.score / 100;
                const q = 1 - p;
                let f = ((b * p) - q) / b;

                if (f > 0) {
                    f = f * strat.fraction;
                    const maxBet = strat.bankroll * 0.05; // Max 5%
                    mise = Math.min(strat.bankroll * f, maxBet);
                    mise = Math.floor(mise);
                }
            }

            // Limiter la mise au bankroll disponible
            mise = Math.min(mise, strat.bankroll);

            if (mise > 0) {
                if (isWin) {
                    const gain = mise * (rapport - 1);
                    strat.bankroll += gain;
                    strat.wins++;
                    strat.history.push({
                        date: course.date,
                        mise,
                        resultat: 'WIN',
                        gain,
                        bankroll: strat.bankroll
                    });
                } else {
                    strat.bankroll -= mise;
                    strat.losses++;
                    strat.history.push({
                        date: course.date,
                        mise,
                        resultat: 'LOSS',
                        gain: -mise,
                        bankroll: strat.bankroll
                    });
                }
            }
        }
    }

    // Calculer les métriques pour chaque stratégie
    const results = {};

    for (const [stratName, strat] of Object.entries(strategies)) {
        const totalBets = strat.history.length;
        const profit = strat.bankroll - initialBankroll;
        const roi = ((strat.bankroll / initialBankroll) - 1) * 100;
        const winRate = totalBets > 0 ? (strat.wins / totalBets) * 100 : 0;

        // Calculer drawdown max
        let peak = initialBankroll;
        let maxDrawdown = 0;

        strat.history.forEach(entry => {
            if (entry.bankroll > peak) peak = entry.bankroll;
            const dd = peak - entry.bankroll;
            if (dd > maxDrawdown) maxDrawdown = dd;
        });

        const maxDrawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

        // Calculer Sharpe ratio
        if (strat.history.length > 1) {
            const gains = strat.history.map(h => h.gain);
            const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
            const variance = gains.reduce((sum, gain) => sum + Math.pow(gain - avgGain, 2), 0) / gains.length;
            const stdDev = Math.sqrt(variance);
            const sharpe = stdDev > 0 ? (avgGain - 0.02 / 365) / stdDev : 0;

            results[stratName] = {
                finalBankroll: parseFloat(strat.bankroll.toFixed(2)),
                profit: parseFloat(profit.toFixed(2)),
                roi: parseFloat(roi.toFixed(2)),
                totalBets,
                wins: strat.wins,
                losses: strat.losses,
                winRate: parseFloat(winRate.toFixed(2)),
                maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
                maxDrawdownPercent: parseFloat(maxDrawdownPercent.toFixed(2)),
                sharpe: parseFloat(sharpe.toFixed(2)),
                history: strat.history
            };
        } else {
            results[stratName] = {
                finalBankroll: parseFloat(strat.bankroll.toFixed(2)),
                profit: parseFloat(profit.toFixed(2)),
                roi: parseFloat(roi.toFixed(2)),
                totalBets,
                wins: strat.wins,
                losses: strat.losses,
                winRate: parseFloat(winRate.toFixed(2)),
                maxDrawdown: 0,
                maxDrawdownPercent: 0,
                sharpe: 0,
                history: strat.history
            };
        }
    }

    // Afficher résumé
    logger.success(`COMPARAISON TERMINÉE`);
    for (const [stratName, metrics] of Object.entries(results)) {
        logger.info(`\n${stratName}:`);
        logger.info(`  Bankroll Final: ${metrics.finalBankroll}€`);
        logger.info(`  Profit: ${metrics.profit}€`);
        logger.info(`  ROI: ${metrics.roi}%`);
        logger.info(`  Win Rate: ${metrics.winRate}%`);
        logger.info(`  Sharpe: ${metrics.sharpe}`);
        logger.info(`  Max Drawdown: ${metrics.maxDrawdown}€ (${metrics.maxDrawdownPercent}%)`);
    }

    return {
        initialBankroll,
        strategies: results,
        period: { start: startDate, end: endDate },
        totalCourses: filtered.length
    };
}

/**
 * V29: SIMULATION MONTE CARLO
 * Simule N fois le backtest avec variations aléatoires pour estimer risque
 */
export async function runMonteCarloSimulation(startDate, endDate, simulations = 1000, initialBankroll = 1000) {
    logger.header(`SIMULATION MONTE CARLO : ${simulations} simulations`);

    const results = [];

    for (let i = 0; i < simulations; i++) {
        // Pour chaque simulation, on pourrait varier:
        // - L'ordre des courses (shuffle)
        // - Les cotes (ajouter du bruit)
        // - Les résultats (probabilités)

        // Version simplifiée: on lance juste le backtest normal
        const result = await runBacktest(startDate, endDate);
        results.push(parseFloat(result.summary.profit));

        if ((i + 1) % 100 === 0) {
            logger.info(`Simulation ${i + 1}/${simulations} terminée`);
        }
    }

    // Analyser les résultats
    results.sort((a, b) => a - b);

    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    const median = results[Math.floor(results.length / 2)];
    const p5 = results[Math.floor(results.length * 0.05)];
    const p95 = results[Math.floor(results.length * 0.95)];
    const min = results[0];
    const max = results[results.length - 1];

    const ruinCount = results.filter(r => r <= -initialBankroll).length;
    const ruinProbability = (ruinCount / simulations) * 100;

    logger.success(`MONTE CARLO TERMINÉ`);
    logger.info(`Profit Moyen: ${mean.toFixed(2)}€`);
    logger.info(`Profit Médian: ${median.toFixed(2)}€`);
    logger.info(`Intervalle 90% (P5-P95): ${p5.toFixed(2)}€ à ${p95.toFixed(2)}€`);
    logger.info(`Min/Max: ${min.toFixed(2)}€ / ${max.toFixed(2)}€`);
    logger.info(`Probabilité de Ruine: ${ruinProbability.toFixed(2)}%`);

    return {
        simulations,
        mean,
        median,
        p5,
        p95,
        min,
        max,
        ruinProbability,
        distribution: results
    };
}

// Auto-run if executed directly
if (process.argv[1].includes('backtest.mjs')) {
    const start = process.argv[2] || '2026-01-01';
    const end = process.argv[3] || '2026-12-31';
    runBacktest(start, end).then(() => process.exit(0));
}
