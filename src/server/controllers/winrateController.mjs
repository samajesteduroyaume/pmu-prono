import { getDB } from '../../db/db.mjs';
import logger from '../../utils/logger.mjs';
import { formatDate } from '../../utils/dateUtils.mjs';
import { parseDays } from '../../utils/requestParams.mjs';

function shiftCalendarDate(dateString, offsetDays) {
    const date = new Date(`${dateString}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
}

/** Win-rate reporting based only on immutable pre-race prediction snapshots. */
export async function getWinRateStats(req, res) {
    try {
        const days = parseDays(req.query.days, 30);
        if (days === undefined) return res.status(400).json({ error: 'Le paramètre days doit être un entier entre 1 et 3650.' });
        const endDate = formatDate(new Date());
        const startDate = shiftCalendarDate(endDate, -(days - 1));
        const db = getDB();
        const rows = await new Promise((resolve, reject) => db.all(`
            SELECT * FROM prediction_snapshots
            WHERE course_date <= ?
            ORDER BY course_date
        `, [endDate], (error, result) => error ? reject(error) : resolve(result || [])));
        const summarize = picks => {
            const settled = picks.filter(row => row.outcome_rank !== null && row.outcome_rank !== undefined);
            const wins = settled.filter(row => Number(row.outcome_rank) === 1);
            const payoutComplete = wins.every(row => Number(row.official_payout) > 0);
            const returns = payoutComplete ? wins.reduce((sum, row) => sum + Number(row.official_payout), 0) : null;
            return {
                total: settled.length,
                wins: wins.length,
                win_pct: settled.length ? Number((wins.length * 100 / settled.length).toFixed(2)) : null,
                avg_cote: picks.some(row => Number(row.odds_at_prediction) > 0)
                    ? Number((picks.reduce((sum, row) => sum + (Number(row.odds_at_prediction) > 0 ? Number(row.odds_at_prediction) : 0), 0) / picks.filter(row => Number(row.odds_at_prediction) > 0).length).toFixed(2))
                    : null,
                roi_pct: settled.length && payoutComplete ? Number(((returns - settled.length) * 100 / settled.length).toFixed(2)) : null,
                payout_coverage_pct: wins.length ? Number((wins.filter(row => Number(row.official_payout) > 0).length * 100 / wins.length).toFixed(1)) : null,
                roi_status: !settled.length ? 'aucun résultat réglé' : !wins.length ? 'aucun gagnant' : payoutComplete ? 'rapports officiels complets' : 'rapports officiels incomplets'
            };
        };
        const tops = rows.filter(row => row.prediction_rank === 1 && Number(row.prediction_score) >= 80);
        const sincePicks = tops.filter(row => row.course_date >= startDate);
        const byDiscipline = [...new Set(sincePicks.map(row => row.discipline || 'Inconnue'))].map(discipline => {
            const stat = summarize(sincePicks.filter(row => (row.discipline || 'Inconnue') === discipline));
            return { discipline, total: stat.total, wins: stat.wins, win_pct: stat.win_pct, roi_pct: stat.roi_pct, avg_cote: stat.avg_cote };
        }).sort((a, b) => (b.win_pct || 0) - (a.win_pct || 0));
        const dailyTrend = [...new Set(sincePicks.map(row => row.course_date))].sort().map(date => {
            const stat = summarize(sincePicks.filter(row => row.course_date === date));
            return { date, courses: stat.total, wins: stat.wins, win_pct: stat.win_pct, roi_pct: stat.roi_pct };
        });
        const movingAvg = dailyTrend.map(day => {
            const cutoffDate = shiftCalendarDate(day.date, -6);
            const windowPicks = sincePicks.filter(row => row.course_date >= cutoffDate && row.course_date <= day.date);
            const stat = summarize(windowPicks);
            return { date: day.date, win_pct_7j: stat.win_pct, courses: stat.total };
        });
        const bands = ['80-89', '90-100'].map(label => {
            const picks = sincePicks.filter(row => label === '80-89' ? Number(row.prediction_score) < 90 : Number(row.prediction_score) >= 90);
            return { tranche: `Score ${label} pts`, ...summarize(picks) };
        }).filter(item => item.total >= 10).sort((a, b) => (b.win_pct || 0) - (a.win_pct || 0)).slice(0, 5);
        const marketByCourse = new Map();
        for (const row of rows) {
            if (Number(row.market_rank) === 1) marketByCourse.set(row.course_id, row);
        }
        const settledIA = sincePicks.filter(row => row.outcome_rank !== null && row.outcome_rank !== undefined);
        const comparable = settledIA.map(row => ({ ia: row, market: marketByCourse.get(row.course_id) })).filter(pair => pair.market?.outcome_rank !== null && pair.market?.outcome_rank !== undefined);
        const iaWins = comparable.filter(pair => Number(pair.ia.outcome_rank) === 1).length;
        const marketWins = comparable.filter(pair => Number(pair.market.outcome_rank) === 1).length;
        res.json({
            generated_at: new Date().toISOString(),
            period_days: days,
            period_since: startDate,
            methodology: 'Pronostics immuables capturés avant le départ. Les résultats doivent être réglés officiellement.',
            global: summarize(tops),
            period: summarize(sincePicks),
            windows: Object.fromEntries([7, 30, 90].map(windowDays => {
                const cutoffDate = shiftCalendarDate(endDate, -(windowDays - 1));
                return [`${windowDays}j`, summarize(tops.filter(row => row.course_date >= cutoffDate))];
            })),
            by_discipline: byDiscipline,
            daily_trend: dailyTrend,
            moving_avg_7j: movingAvg,
            best_segments: bands,
            vs_market: {
                total: comparable.length,
                ia_wins: iaWins,
                mkt_wins: marketWins,
                ia_win_pct: comparable.length ? Number((iaWins * 100 / comparable.length).toFixed(2)) : null,
                mkt_win_pct: comparable.length ? Number((marketWins * 100 / comparable.length).toFixed(2)) : null,
                delta_pts: comparable.length ? Number(((iaWins - marketWins) * 100 / comparable.length).toFixed(2)) : null
            }
        });
    } catch (error) {
        logger.error(`[WINRATE] Erreur: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}
