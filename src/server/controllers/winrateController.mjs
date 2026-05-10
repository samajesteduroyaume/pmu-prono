import { getDB } from '../../db/db.mjs';
import logger from '../../utils/logger.mjs';

/**
 * ARCHITECT v44.0 — WIN RATE REPORTING ENGINE
 * Calcule les statistiques de performance glissantes de l'IA
 * sur les courses avec résultats officiels d'arrivée.
 */

/**
 * Calcule le numéro du cheval en 1ère position depuis la chaîne ordre_arrivee
 */
function extractWinner(ordreArrivee) {
    if (!ordreArrivee) return null;
    const first = ordreArrivee.split('-')[0].trim();
    const num = parseInt(first);
    return isNaN(num) ? null : num;
}

/**
 * GET /api/performance/winrate
 * Retourne les statistiques de win rate IA glissantes :
 * - Global (tous temps)
 * - Par fenêtre (7j, 30j, 90j)
 * - Par discipline
 * - Évolution journalière (N derniers jours)
 * - Meilleur et pire segment
 */
export async function getWinRateStats(req, res) {
    try {
        const db = getDB();
        const days = parseInt(req.query.days) || 30;
        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString().split('T')[0];

        // Promisify SQLite calls
        const all = (sql, params = []) => new Promise((resolve, reject) =>
            db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
        );

        // ── 1. STATISTIQUES GLOBALES (tous temps) ──────────────────────────
        const [globalRow] = await all(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) as wins,
                ROUND(100.0 * SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) / COUNT(*), 2) as win_pct,
                ROUND(AVG(p.cote_ref), 2) as avg_cote,
                ROUND((SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN p.cote_ref ELSE 0 END) - COUNT(*)) / COUNT(*) * 100, 2) as roi_pct
            FROM courses c
            JOIN participants p ON p.course_id = c.id
            WHERE c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
            AND p.prediction_score >= 80 AND p.cote_ref > 0 AND p.cote_ref < 100
            AND c.statut IN ('FIN_COURSE', 'ARRIVEE_DEFINITIVE_COMPLETE', 'ARRIVEE_PROVISOIRE_NON_VALIDEE')
            AND p.prediction_score = (SELECT MAX(p2.prediction_score) FROM participants p2 WHERE p2.course_id = c.id)
        `);

        // ── 2. STATISTIQUES PAR FENÊTRE TEMPORELLE ─────────────────────────
        const windows = [7, 30, 90];
        const windowStats = {};
        for (const w of windows) {
            const d = new Date();
            d.setDate(d.getDate() - w);
            const dStr = d.toISOString().split('T')[0];
            const [row] = await all(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) as wins,
                    ROUND(100.0 * SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) / MAX(1, COUNT(*)), 2) as win_pct,
                    ROUND((SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN p.cote_ref ELSE 0 END) - COUNT(*)) / MAX(1,COUNT(*)) * 100, 2) as roi_pct
                FROM courses c
                JOIN participants p ON p.course_id = c.id
                WHERE c.date >= ? AND c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
                AND p.prediction_score >= 80 AND p.cote_ref > 0 AND p.cote_ref < 100
                AND c.statut IN ('FIN_COURSE', 'ARRIVEE_DEFINITIVE_COMPLETE', 'ARRIVEE_PROVISOIRE_NON_VALIDEE')
                AND p.prediction_score = (SELECT MAX(p2.prediction_score) FROM participants p2 WHERE p2.course_id = c.id)
            `, [dStr]);
            windowStats[`${w}j`] = row;
        }

        // ── 3. PAR DISCIPLINE ──────────────────────────────────────────────
        const byDiscipline = await all(`
            SELECT 
                c.discipline,
                COUNT(*) as total,
                SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) as wins,
                ROUND(100.0 * SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) / MAX(1,COUNT(*)), 2) as win_pct,
                ROUND((SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN p.cote_ref ELSE 0 END) - COUNT(*)) / MAX(1,COUNT(*)) * 100, 2) as roi_pct,
                ROUND(AVG(p.cote_ref), 2) as avg_cote
            FROM courses c
            JOIN participants p ON p.course_id = c.id
            WHERE c.date >= ?
            AND c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
            AND p.prediction_score >= 80 AND p.cote_ref > 0 AND p.cote_ref < 100
            AND c.statut IN ('FIN_COURSE', 'ARRIVEE_DEFINITIVE_COMPLETE', 'ARRIVEE_PROVISOIRE_NON_VALIDEE')
            AND p.prediction_score = (SELECT MAX(p2.prediction_score) FROM participants p2 WHERE p2.course_id = c.id)
            GROUP BY c.discipline
            ORDER BY win_pct DESC
        `, [sinceStr]);

        // ── 4. ÉVOLUTION JOURNALIÈRE (N derniers jours) ────────────────────
        const dailyTrend = await all(`
            SELECT 
                c.date,
                COUNT(*) as courses,
                SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) as wins,
                ROUND(100.0 * SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) / MAX(1,COUNT(*)), 2) as win_pct,
                ROUND((SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN p.cote_ref ELSE 0 END) - COUNT(*)) / MAX(1,COUNT(*)) * 100, 2) as roi_pct
            FROM courses c
            JOIN participants p ON p.course_id = c.id
            WHERE c.date >= ?
            AND c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
            AND p.prediction_score >= 80 AND p.cote_ref > 0 AND p.cote_ref < 100
            AND c.statut IN ('FIN_COURSE', 'ARRIVEE_DEFINITIVE_COMPLETE', 'ARRIVEE_PROVISOIRE_NON_VALIDEE')
            AND p.prediction_score = (SELECT MAX(p2.prediction_score) FROM participants p2 WHERE p2.course_id = c.id)
            GROUP BY c.date
            ORDER BY c.date ASC
        `, [sinceStr]);

        // ── 5. WIN RATE GLISSANT 7J (moving average sur la tendance) ───────
        const movingAvg = [];
        const window7 = 7;
        for (let i = 0; i < dailyTrend.length; i++) {
            const slice = dailyTrend.slice(Math.max(0, i - window7 + 1), i + 1);
            const totalWins = slice.reduce((s, d) => s + d.wins, 0);
            const totalCourses = slice.reduce((s, d) => s + d.courses, 0);
            movingAvg.push({
                date: dailyTrend[i].date,
                win_pct_7j: totalCourses > 0 ? parseFloat((totalWins / totalCourses * 100).toFixed(2)) : 0
            });
        }

        // ── 6. MEILLEUR SEGMENT (Score + discipline) ──────────────────────
        const bestSegments = await all(`
            SELECT 
                c.discipline,
                CASE 
                    WHEN p.prediction_score >= 80 THEN 'Score≥80%'
                    WHEN p.prediction_score >= 70 THEN 'Score 70-79%'
                    WHEN p.prediction_score >= 60 THEN 'Score 60-69%'
                    ELSE 'Score<60%'
                END as tranche,
                COUNT(*) as total,
                SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) as wins,
                ROUND(100.0 * SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) / MAX(1,COUNT(*)), 2) as win_pct,
                ROUND((SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN p.cote_ref ELSE 0 END) - COUNT(*)) / MAX(1,COUNT(*)) * 100, 2) as roi_pct
            FROM courses c
            JOIN participants p ON p.course_id = c.id
            WHERE c.date >= ?
            AND c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
            AND p.prediction_score >= 80 AND p.cote_ref > 0 AND p.cote_ref < 100
            AND c.statut IN ('FIN_COURSE', 'ARRIVEE_DEFINITIVE_COMPLETE', 'ARRIVEE_PROVISOIRE_NON_VALIDEE')
            AND p.prediction_score = (SELECT MAX(p2.prediction_score) FROM participants p2 WHERE p2.course_id = c.id)
            GROUP BY c.discipline, tranche
            HAVING total >= 10
            ORDER BY win_pct DESC
            LIMIT 5
        `, [sinceStr]);

        // ── 7. COMPARAISON IA vs MARCHÉ sur la période ─────────────────────
        const [vsMarket] = await all(`
            SELECT 
                SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = p.numero THEN 1 ELSE 0 END) as ia_wins,
                SUM(CASE WHEN CAST(TRIM(SUBSTR(c.ordre_arrivee, 1, INSTR(c.ordre_arrivee||'-', '-')-1)) AS INTEGER) = mkt.numero THEN 1 ELSE 0 END) as mkt_wins,
                COUNT(*) as total
            FROM courses c
            JOIN participants p ON p.course_id = c.id
            JOIN (
                SELECT course_id, numero, MIN(cote_ref) as min_cote
                FROM participants WHERE cote_ref > 0 GROUP BY course_id
            ) mkt ON mkt.course_id = c.id
            WHERE c.date >= ?
            AND c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
            AND p.prediction_score >= 80 AND p.cote_ref > 0 AND p.cote_ref < 100
            AND c.statut IN ('FIN_COURSE', 'ARRIVEE_DEFINITIVE_COMPLETE', 'ARRIVEE_PROVISOIRE_NON_VALIDEE')
            AND p.prediction_score = (SELECT MAX(p2.prediction_score) FROM participants p2 WHERE p2.course_id = c.id)
        `, [sinceStr]);

        const iaWinPct = vsMarket?.total > 0 ? parseFloat((vsMarket.ia_wins / vsMarket.total * 100).toFixed(2)) : 0;
        const mktWinPct = vsMarket?.total > 0 ? parseFloat((vsMarket.mkt_wins / vsMarket.total * 100).toFixed(2)) : 0;

        res.json({
            generated_at: new Date().toISOString(),
            period_days: days,
            period_since: sinceStr,
            global: globalRow,
            windows: windowStats,
            by_discipline: byDiscipline,
            daily_trend: dailyTrend,
            moving_avg_7j: movingAvg,
            best_segments: bestSegments,
            vs_market: {
                total: vsMarket?.total || 0,
                ia_wins: vsMarket?.ia_wins || 0,
                mkt_wins: vsMarket?.mkt_wins || 0,
                ia_win_pct: iaWinPct,
                mkt_win_pct: mktWinPct,
                delta_pts: parseFloat((iaWinPct - mktWinPct).toFixed(2))
            }
        });

    } catch (error) {
        logger.error(`[WINRATE] Erreur: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}
