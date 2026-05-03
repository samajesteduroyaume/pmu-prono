import { initDB, getAllCoursesWithResults, getCourseParticipants } from '../core/db.mjs';
import { calculerPredictionHybride, loadMLModel } from '../core/hybrid.mjs';
import CONFIG from '../config/settings.mjs';
import logger from '../utils/logger.mjs';
import path from 'path';

const FINANCE = CONFIG.engine_settings.finance;

/**
 * MOTEUR DE BACKTESTING - ARCHITECT v27.1
 */
export async function runBacktest(startDate, endDate, options = {}) {
    logger.header(`LANCEMENT DU BACKTEST v27.1 : ${startDate} au ${endDate}`);
    const { useValueHunter = false, minEdge = 0.05 } = options;

    await initDB();
    await loadMLModel();

    const { calibrateProbability } = await import('../core/kelly.mjs');

    const courses = await getAllCoursesWithResults();
    const filtered = courses.filter(c => {
        const d = c.date;
        return d >= startDate && d <= endDate && c.ordre_arrivee;
    });

    logger.info(`${filtered.length} courses trouvées avec résultats.`);
    if (useValueHunter) logger.info(`Mode VALUE HUNTER activé (Edge min: ${minEdge})`);

    let stats = {
        total: 0,
        wins: 0,
        investment: 0,
        returns: 0,
        skipped: 0,
        history: []
    };

    for (const course of filtered) {
        const participants = await getCourseParticipants(course.id);
        if (participants.length === 0) continue;

        // Calculer les prédictions hybrides pour tous les participants (v43.3 Elite)
        const { getHorseHistory } = await import('../core/db.mjs');
        const predictions = await Promise.all(participants.map(async p => {
            // Reconstitution de l'historique au moment de la course (pour la classe)
            const history = await getHorseHistory(p.nom, 5); // Note: Idéalement filtré par date < course.date
            const avgHistoryPrix = history.length > 0 ? history.reduce((sum, h) => sum + (h.prix || 0), 0) / history.length : 0;
            
            const { preparerBaseScores } = await import('../core/intelligence.mjs');
            const baseScores = await preparerBaseScores(p, course, avgHistoryPrix);
            const res = await calculerPredictionHybride(p, course, [], participants, baseScores);
            return { ...p, score: res.score };
        }));

        // Trier par score IA
        predictions.sort((a, b) => b.score - a.score);

        const top1 = predictions[0];
        const cote = parseFloat(top1.cote_ref) || 0;
        
        // v43.1: Filtre Value Hunter
        if (useValueHunter && cote > 1) {
            const probIA = calibrateProbability(top1.score);
            const probMarket = 1 / cote;
            const edge = probIA - probMarket;
            
            if (edge < minEdge) {
                stats.skipped++;
                continue;
            }
        }

        const arrivee = course.ordre_arrivee.split('-').map(n => parseInt(n));
        const winnerNum = arrivee[0];
        const isWin = top1.numero === winnerNum;

        stats.total++;
        stats.investment += 1;

        let rapport = 0;
        if (isWin) {
            stats.wins++;
            const realRapport = extractWinnerRapport(course, top1.numero);
            rapport = realRapport || (parseFloat(top1.cote_ref) * 0.9) || 2.0;
        }
        stats.returns += rapport;

        // Calcul de la tendance de catégorie (v43.3)
        const cat_trend = avgHistoryPrix > 0 ? (course.prix < avgHistoryPrix * 0.9 ? 'DOWN' : (course.prix > avgHistoryPrix * 1.1 ? 'UP' : 'STABLE')) : 'STABLE';

        stats.history.push({
            date: course.date,
            course: `${course.reunionNum}C${course.courseNum}`,
            selection: top1.nom,
            score: top1.score,
            cote: top1.cote_ref,
            discipline: course.discipline,
            cat_trend,
            avg_prix: avgHistoryPrix,
            resultat: isWin ? 'WIN' : 'LOSS',
            rapport: rapport,
            net: stats.returns - stats.investment
        });
    }

    const roi = stats.investment > 0 ? ((stats.returns - stats.investment) / stats.investment) * 100 : 0;

    // v43.1: Calcul du résumé par discipline
    const discStats = {};
    stats.history.forEach(h => {
        if (!discStats[h.discipline]) discStats[h.discipline] = { total: 0, wins: 0, investment: 0, returns: 0 };
        discStats[h.discipline].total++;
        discStats[h.discipline].investment += 1;
        discStats[h.discipline].returns += h.rapport;
        if (h.resultat === 'WIN') {
            discStats[h.discipline].wins++;
        }
    });

    for (const d in discStats) {
        discStats[d].roi = ((discStats[d].returns - discStats[d].investment) / discStats[d].investment * 100).toFixed(2);
    }
    
    logger.success(`BACKTEST TERMINÉ`);
    logger.info(`Total Courses : ${stats.total}`);
    if (useValueHunter) logger.info(`Courses ignorées (No Value) : ${stats.skipped}`);
    logger.info(`Taux de réussite : ${stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(2) : 0}%`);
    logger.info(`ROI : ${roi.toFixed(2)}%`);
    logger.info(`Profit Net : ${(stats.returns - stats.investment).toFixed(2)} €`);

    console.table(Object.keys(discStats).map(d => ({
        Discipline: d,
        Total: discStats[d].total,
        Wins: discStats[d].wins,
        WinRate: ((discStats[d].wins / discStats[d].total) * 100).toFixed(1) + '%',
        ROI: discStats[d].roi + '%'
    })));

    return {
        summary: {
            total: stats.total,
            wins: stats.wins,
            winRate: stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(2) : 0,
            investment: stats.investment,
            returns: stats.returns,
            profit: (stats.returns - stats.investment).toFixed(2),
            roi: roi.toFixed(2),
            skipped: stats.skipped,
            disciplines: discStats
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
    const { calculateKellyMise, calculateKellyAdaptatif, calibrateProbability } = await import('../core/kelly.mjs');

    const courses = await getAllCoursesWithResults();
    const filtered = courses.filter(c => {
        const d = c.date;
        return d >= startDate && d <= endDate && c.ordre_arrivee;
    });

    logger.info(`${filtered.length} courses trouvées avec résultats.`);

    // Initialiser 4 stratégies
    const strategies = {
        [`Kelly ${FINANCE.kelly_fraction * 100}%`]: { bankroll: initialBankroll, fraction: FINANCE.kelly_fraction, history: [], wins: 0, losses: 0 },
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
                    logger.warn(`[Backtest] Kelly Adaptatif erreur: ${e.message} - Fallback sur Kelly Classique`);
                    // Fallback sur Kelly 50% si erreur
                    const kellyResult = calculateKellyMise(rapport, top1.score, strat.bankroll);
                    mise = kellyResult.mise || 0;
                }
            } else {
                // Kelly classique avec fraction spécifique (V40 Calibré)
                const b = rapport - 1;
                const p = calibrateProbability(top1.score);
                const q = 1 - p;
                let f = ((b * p) - q) / b;

                if (f > 0) {
                    f = f * strat.fraction;
                    const maxBet = strat.bankroll * FINANCE.max_bet_percent;
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

import { Worker } from 'worker_threads';
import os from 'os';

/**
 * V30: SIMULATION MONTE CARLO PARALLÉLISÉE
 * Utilise des Worker Threads pour diviser la charge de calcul
 */
export async function runMonteCarloSimulation(startDate, endDate, simulations = 100, initialBankroll = 1000) {
    logger.header(`SIMULATION MONTE CARLO PARALLÉLISÉE : ${simulations} simulations`);
    
    const results = [];
    const maxWorkers = Math.max(1, os.cpus().length - 1); // Laisser un cœur libre
    logger.info(`Utilisation de ${maxWorkers} Workers maximum`);

    let activeWorkers = 0;
    let completedSims = 0;
    
    return new Promise((resolve) => {
        const runNext = () => {
            if (completedSims >= simulations) {
                if (activeWorkers === 0) finalize();
                return;
            }

            while (activeWorkers < maxWorkers && (completedSims + activeWorkers) < simulations) {
                const simIndex = completedSims + activeWorkers;
                const worker = new Worker(path.join(path.dirname(fileURLToPath(import.meta.url)), 'monte_carlo_worker.mjs'), {
                    workerData: { startDate, endDate, simulationIndex: simIndex }
                });

                activeWorkers++;

                worker.on('message', (msg) => {
                    if (msg.success) {
                        results.push(msg.profit);
                    }
                    if ((results.length) % 10 === 0) {
                        logger.info(`Progrès : ${results.length}/${simulations} simulations terminées`);
                    }
                });

                worker.on('error', (err) => {
                    logger.error(`Worker error: ${err.message}`);
                });

                worker.on('exit', () => {
                    activeWorkers--;
                    completedSims++;
                    runNext();
                });
            }
        };

        const finalize = () => {
            results.sort((a, b) => a - b);

            const mean = results.reduce((a, b) => a + b, 0) / results.length;
            const median = results[Math.floor(results.length / 2)];
            const p5 = results[Math.floor(results.length * 0.05)] || results[0];
            const p95 = results[Math.floor(results.length * 0.95)] || results[results.length - 1];
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

            resolve({
                simulations,
                mean,
                median,
                p5,
                p95,
                min,
                max,
                ruinProbability,
                distribution: results
            });
        };

        runNext();
    });
}

function extractWinnerRapport(course, horseNum) {
    let fallbackRapport = 2.0;
    
    // Si on a le numéro du cheval dans les participants de la course, on prend sa cote
    try {
        const participants = JSON.parse(course.participants_json || '[]'); // Note: Il faudra s'assurer que c'est accessible
        // Mais en fait on a déjà top1.cote_ref dans runBacktest.
    } catch(e) {}

    if (course.rapports && course.rapports !== 'null' && course.rapports !== '') {
        try {
            const raps = JSON.parse(course.rapports);
            const list = raps.paysParieur?.[0]?.rapports || [];
            const sg = list.find(r => r.libellePari === 'E_SIMPLE_GAGNANT' && r.combinaison === horseNum.toString());
            if (sg) return sg.dividende / 100;
        } catch (e) { }
    }
    
    return null; // On va laisser runBacktest gérer le fallback avec la cote
}

// Auto-run if executed directly
import { fileURLToPath } from 'url';
const isDirectRun = process.argv[1] && (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

if (isDirectRun) {
    const start = process.argv[2] || '2026-01-01';
    const end = process.argv[3] || '2026-12-31';
    const useValue = process.argv.includes('--value');
    
    runBacktest(start, end, { useValueHunter: useValue }).then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
