import { getDB } from '../db.mjs';
import { getHistoriqueParis } from './pariRepo.mjs';
import { analyserTendancesCompletes, detecterSequences } from '../../core/tendances.mjs';
import logger from '../../utils/logger.mjs';
import { formatDate } from '../../utils/dateUtils.mjs';

function dateDaysAgo(days) {
    const today = formatDate(new Date());
    const date = new Date(`${today}T12:00:00.000Z`);
    const dayCount = Number.isFinite(Number(days)) ? Math.max(1, Math.trunc(Number(days))) : 1;
    const offset = dayCount - 1;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
}

export async function getTendancesCumulees(days = null) {
    try {
        const historique = await getHistoriqueParis(days);
        if (!historique || historique.length === 0) {
            return {
                methodology: 'Aucun historique de snapshots réglé.',
                performanceMetricsAvailable: false,
                tendance: { tendance: 'INDISPONIBLE', pente: null },
                momentum: null,
                drawdown: { current: null, max: null, currentPercent: null, maxPercent: null },
                variance: { variance: null, ecartType: null },
                sharpe: null,
                sequence: { type: 'NEUTRE', count: 0, depuis: null },
                patterns: { meilleureDiscipline: null, hippodromesPerformants: [] },
                timestamp: new Date().toISOString()
            };
        }

        if (historique.some(row => row.gain === null || row.cumulative === null)) {
            return {
                methodology: 'Les rapports officiels sont incomplets; les métriques financières ne sont pas estimées.',
                performanceMetricsAvailable: false,
                tendance: { tendance: 'INDISPONIBLE', pente: null },
                momentum: null,
                drawdown: { current: null, max: null, currentPercent: null, maxPercent: null },
                variance: { variance: null, ecartType: null },
                sharpe: null,
                sequence: detecterSequences(historique),
                patterns: { meilleureDiscipline: null, hippodromesPerformants: [] },
                timestamp: new Date().toISOString()
            };
        }

        // On passe aussi l'historique comme base pour les patterns si on n'a pas les cours détaillés
        return analyserTendancesCompletes(historique, historique);
    } catch (error) {
        logger.error(`Erreur getTendancesCumulees: ${error.message}`);
        throw error;
    }
}

export async function getIAPerformanceStats(days = null) {
    const db = getDB();
    const rows = await new Promise((resolve, reject) => db.all(`
        SELECT * FROM prediction_snapshots
        WHERE prediction_rank = 1 AND prediction_score >= 80
          AND outcome_rank IS NOT NULL
          ${days ? 'AND course_date >= ?' : ''}
        ORDER BY course_date, COALESCE(scheduled_time, '')
    `, days ? [dateDaysAgo(Math.max(1, Number(days)))] : [], (error, result) => error ? reject(error) : resolve(result || [])));
    const byDate = new Map();
    rows.forEach(row => {
        if (!byDate.has(row.course_date)) byDate.set(row.course_date, []);
        byDate.get(row.course_date).push(row);
    });
    let cumulativeProfit = 0;
    let totalReturns = 0;
    let payoutsComplete = true;
    const history = [...byDate.entries()].map(([date, picks]) => {
        const wins = picks.filter(row => Number(row.outcome_rank) === 1);
        const covered = wins.every(row => Number(row.official_payout) > 0);
        if (!covered) payoutsComplete = false;
        const returns = covered ? wins.reduce((sum, row) => sum + Number(row.official_payout), 0) : null;
        const profit = returns === null ? null : returns - picks.length;
        if (profit !== null) cumulativeProfit += profit;
        if (returns !== null) totalReturns += returns;
        return {
            date,
            profit: profit === null ? null : Number(profit.toFixed(2)),
            cumulative: payoutsComplete ? Number(cumulativeProfit.toFixed(2)) : null,
            winRate: Number((wins.length * 100 / picks.length).toFixed(1)),
            gain: profit === null ? null : Number(profit.toFixed(2)),
            resultat: wins.length ? 'WIN' : 'LOSE',
            discipline: picks[0]?.discipline || null,
            hippodrome: picks[0]?.hippodrome || null,
            heure: picks[0]?.scheduled_time || null
        };
    });
    const totalCourses = rows.length;
    const totalWins = rows.filter(row => Number(row.outcome_rank) === 1).length;
    // Quand aucun choix ne gagne, le ROI est connu (-100 %) sans rapport de paiement.
    const hasOfficialReturns = totalCourses > 0 && payoutsComplete;
    return {
        methodology: 'Snapshots de pronostics capturés avant le départ; résultats réglés officiellement.',
        global: {
            total_courses: totalCourses,
            wins: totalWins,
            win_rate: totalCourses ? Number((totalWins * 100 / totalCourses).toFixed(1)) : 0,
            roi: hasOfficialReturns ? Number(((totalReturns / totalCourses - 1) * 100).toFixed(1)) : null,
            roi_type: hasOfficialReturns ? 'official_payout_flat_bet' : 'unavailable_without_official_payouts',
            total_profit: hasOfficialReturns ? Number((totalReturns - totalCourses).toFixed(2)) : null
        },
        history
    };
}

export async function getAdvancedStats() {
    const db = getDB();
    const rows = await new Promise((resolve, reject) => db.all(`
        SELECT * FROM prediction_snapshots
        WHERE prediction_rank = 1 AND outcome_rank IS NOT NULL
    `, (error, result) => error ? reject(error) : resolve(result || [])));
    const top3 = rows.filter(row => Number(row.outcome_rank) > 0 && Number(row.outcome_rank) <= 3).length;
    const by_discipline = {};
    for (const discipline of [...new Set(rows.map(row => row.discipline || 'Inconnue'))]) {
        const group = rows.filter(row => (row.discipline || 'Inconnue') === discipline);
        const wins = group.filter(row => Number(row.outcome_rank) === 1).length;
        by_discipline[discipline] = {
            total: group.length,
            wins,
            win_rate: group.length ? (wins * 100 / group.length).toFixed(1) : '0.0'
        };
    }
    return {
        methodology: 'Snapshots de pronostics capturés avant le départ; résultats réglés officiellement.',
        top3_rate: rows.length ? Number((top3 * 100 / rows.length).toFixed(1)) : 0,
        by_discipline,
        avg_confidence: null,
        avg_prediction_score: rows.length ? Number((rows.reduce((sum, row) => sum + Number(row.prediction_score || 0), 0) / rows.length).toFixed(1)) : null,
        best_rapport: null,
        insights: { best_hippodrome: null, best_driver: null }
    };
}

export async function getPalmaresStats() {
    const db = getDB();
    const getRanking = (column, limit = 50) => {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT
                    ${column} as name,
                    COUNT(*) as courses,
                    SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as victoires,
                    SUM(CASE WHEN CAST(classement AS INTEGER) BETWEEN 1 AND 3 THEN 1 ELSE 0 END) as places
                FROM participants p
                JOIN courses c ON p.course_id = c.id
                WHERE ${column} IS NOT NULL AND ${column} != ''
                  AND c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
                  AND p.classement IS NOT NULL
                  AND CAST(p.classement AS INTEGER) > 0
                GROUP BY ${column}
                HAVING courses >= 5
                ORDER BY victoires DESC, places DESC, courses DESC
                LIMIT ?
            `;
            db.all(query, [limit], (err, rows) => {
                if (err) reject(err);
                else {
                    const enriched = rows.map((r, index) => ({
                        rang: index + 1,
                        ...r,
                        reussite_gagne: ((r.victoires / r.courses) * 100).toFixed(1),
                        reussite_place: ((r.places / r.courses) * 100).toFixed(1)
                    }));
                    resolve(enriched);
                }
            });
        });
    };

    try {
        const [jockeys, chevaux, entraineurs, proprietaires] = await Promise.all([
            getRanking('driver'),
            getRanking('nom'),
            getRanking('entraineur'),
            getRanking('proprietaire')
        ]);

        return {
            jockeys,
            chevaux,
            entraineurs,
            proprietaires
        };
    } catch (error) {
        logger.error(`Erreur Palmarès: ${error.message}`);
        throw error;
    }
}

export async function getPerformanceParDiscipline(days = null) {
    const db = getDB();
    const params = [];
    let dateFilter = '';
    if (days) {
        dateFilter = 'AND course_date >= ?';
        params.push(dateDaysAgo(Math.max(1, Number(days))));
    }
    const rows = await new Promise((resolve, reject) => db.all(`
        SELECT * FROM prediction_snapshots
        WHERE prediction_rank = 1 AND prediction_score >= 80
          AND outcome_rank IS NOT NULL ${dateFilter}
    `, params, (error, result) => error ? reject(error) : resolve(result || [])));
    const stats = {};
    for (const discipline of [...new Set(rows.map(row => row.discipline || 'Inconnue'))]) {
        const group = rows.filter(row => (row.discipline || 'Inconnue') === discipline);
        const wins = group.filter(row => Number(row.outcome_rank) === 1);
        const payoutsComplete = wins.every(row => Number(row.official_payout) > 0);
        const returns = payoutsComplete ? wins.reduce((sum, row) => sum + Number(row.official_payout), 0) : null;
        stats[discipline] = {
            total_courses: group.length,
            wins: wins.length,
            win_rate: Number((wins.length * 100 / group.length).toFixed(1)),
            roi: returns !== null ? Number(((returns / group.length - 1) * 100).toFixed(1)) : null,
            profit: returns !== null ? Number((returns - group.length).toFixed(2)) : null,
            payout_coverage: wins.length ? Number((wins.filter(row => Number(row.official_payout) > 0).length * 100 / wins.length).toFixed(1)) : null
        };
    }
    return stats;
}

export async function getSynergyScore(driverName, trainerName) {
    const db = getDB();
    if (!driverName || !trainerName) return 50;

    return new Promise((resolve) => {
        const query = `
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN CAST(p.classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN CAST(classement AS INTEGER) BETWEEN 1 AND 3 THEN 1 ELSE 0 END) as places
            FROM participants p
            JOIN courses c ON c.id = p.course_id
            WHERE UPPER(TRIM(COALESCE(p.driver, ''))) = UPPER(TRIM(?))
              AND UPPER(TRIM(COALESCE(p.entraineur, ''))) = UPPER(TRIM(?))
            AND CAST(p.classement AS INTEGER) > 0
            AND COALESCE(c.ordre_arrivee, '') <> ''
        `;
        db.get(query, [driverName, trainerName], (err, row) => {
            if (err) {
                logger.error(`Erreur calcul synergie ${driverName}/${trainerName}: ${err.message}`);
                resolve(50);
            } else if (!row || row.total < 3) {
                resolve(50);
            } else {
                const winRate = (row.wins / row.total) * 100;
                const placeRate = (row.places / row.total) * 100;

                let score = 50;
                if (winRate > 25) score = 90;
                else if (winRate > 15) score = 80;
                else if (placeRate > 40) score = 70;
                else if (winRate < 5 && row.total > 10) score = 30;

                resolve(score);
            }
        });
    });
}

export async function getEcuriesForm(days = 90) {
    const db = getDB();
    const params = [];
    const dateFilter = days ? 'AND c.date >= ?' : '';
    if (days) params.push(dateDaysAgo(Math.max(1, Number(days))));
    return new Promise((resolve, reject) => {
        const query = `
            SELECT
                p.entraineur as nom_ecurie,
                COUNT(*) as total_engagements,
                SUM(CASE WHEN CAST(p.classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as victoires,
                SUM(CASE WHEN CAST(p.classement AS INTEGER) <= 3 AND CAST(p.classement AS INTEGER) >= 1 THEN 1 ELSE 0 END) as podiums,
                ROUND((CAST(SUM(CASE WHEN CAST(p.classement AS INTEGER) = 1 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)) * 100, 1) as win_pct,
                ROUND((CAST(SUM(CASE WHEN CAST(p.classement AS INTEGER) <= 3 AND CAST(p.classement AS INTEGER) >= 1 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)) * 100, 1) as podium_pct
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE p.entraineur IS NOT NULL AND p.entraineur != '' AND p.entraineur != 'INCONNU'
              AND CAST(p.classement AS INTEGER) > 0
              AND COALESCE(c.ordre_arrivee, '') <> ''
              ${dateFilter}
            GROUP BY p.entraineur
            HAVING total_engagements >= 3
            ORDER BY victoires DESC, podiums DESC, total_engagements DESC
            LIMIT 50
        `;
        db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}
