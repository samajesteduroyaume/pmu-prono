import { getDB } from '../db.mjs';
import logger from '../../utils/logger.mjs';
import { formatDate } from '../../utils/dateUtils.mjs';

function dateDaysAgo(days) {
    const today = formatDate(new Date());
    const date = new Date(`${today}T12:00:00.000Z`);
    const parsedDays = Number(days);
    const dayCount = Number.isFinite(parsedDays) ? Math.max(1, Math.min(3650, Math.trunc(parsedDays))) : 1;
    const offset = dayCount - 1;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
}

export async function getHistoriqueParis(days = null) {
    const db = getDB();
    const params = [];
    let dateFilter = '';
    if (days) {
        dateFilter = 'AND course_date >= ?';
        params.push(dateDaysAgo(days));
    }
    const rows = await new Promise((resolve, reject) => db.all(`
        SELECT * FROM prediction_snapshots
        WHERE prediction_rank = 1 AND prediction_score >= 80
          AND outcome_rank IS NOT NULL ${dateFilter}
        ORDER BY course_date, COALESCE(scheduled_time, '')
    `, params, (error, result) => error ? reject(error) : resolve(result || [])));
    let cumulative = 0;
    let cumulativeComplete = true;
    return rows.map(row => {
        const isWin = Number(row.outcome_rank) === 1;
        const hasPayout = Number(row.official_payout) > 0;
        const gain = isWin ? (hasPayout ? Number(row.official_payout) - 1 : null) : -1;
        if (gain === null) cumulativeComplete = false;
        else if (cumulativeComplete) cumulative += gain;
        return {
            date: row.course_date,
            course_id: row.course_id,
            cheval: row.horse_name,
            numero: row.horse_number,
            cote: row.odds_at_prediction == null ? null : Number(row.odds_at_prediction),
            classement: isWin ? 1 : (Number(row.outcome_rank) || null),
            resultat: isWin ? 'WIN' : 'LOSE',
            gain: gain === null ? null : Number(gain.toFixed(2)),
            cumulative: cumulativeComplete ? Number(cumulative.toFixed(2)) : null,
            mise: 1,
            payout_available: !isWin || hasPayout,
            discipline: row.discipline,
            hippodrome: row.hippodrome,
            heure: row.scheduled_time,
            heure_depart: row.scheduled_time
        };
    });
}

export async function getSequenceActuelle() {
    try {
        const { detecterSequences } = await import('../../core/tendances.mjs');
        const historique = await getHistoriqueParis(30);

        if (!historique || historique.length === 0) {
            return { type: 'NEUTRE', count: 0, depuis: null };
        }

        return detecterSequences(historique);

    } catch (error) {
        logger.error(`Erreur séquence actuelle: ${error.message}`);
        return { type: 'NEUTRE', count: 0, depuis: null };
    }
}

export async function recordShadowBet(bet) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        // Lecture et insertion dans une seule instruction pour empêcher deux
        // synchronisations concurrentes d'enregistrer le même pari.
        db.run(`
            INSERT INTO shadow_bets (participant_id, date, reunion, course, nom, mise, cote, proba, edge, resultat, gain)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0
            WHERE NOT EXISTS (
                SELECT 1 FROM shadow_bets
                WHERE (participant_id = ? AND date = ?)
                   OR (date = ? AND reunion = ? AND course = ? AND nom = ?)
            )
        `, [
            bet.participant_id,
            bet.date,
            bet.reunion,
            bet.course,
            bet.nom,
            bet.mise,
            bet.cote,
            bet.proba,
            bet.edge,
            bet.participant_id,
            bet.date,
            bet.date,
            bet.reunion,
            bet.course,
            bet.nom
        ], function (err) {
            if (err) return reject(err);
            if (this.changes > 0) return resolve(this.lastID);

            db.get(
                `SELECT id FROM shadow_bets WHERE (participant_id = ? AND date = ?) OR (date = ? AND reunion = ? AND course = ? AND nom = ?) LIMIT 1`,
                [bet.participant_id, bet.date, bet.date, bet.reunion, bet.course, bet.nom],
                (lookupError, existing) => {
                    if (lookupError) reject(lookupError);
                    else resolve(existing?.id ?? null);
                }
            );
        });
    });
}

/** Règle les paris simulés uniquement depuis un snapshot officiellement réglé. */
export async function settleShadowBets(courseId = null) {
    const db = getDB();
    const courseFilter = courseId == null ? '' : 'AND ps.course_id = ?';
    const params = courseId == null ? [] : [courseId];
    const update = (sql, values) => new Promise((resolve, reject) => {
        db.run(sql, values, function (error) {
            if (error) reject(error);
            else resolve(this.changes || 0);
        });
    });

    const settled = await update(`
        UPDATE shadow_bets AS b
        SET resultat = CASE WHEN (
                SELECT ps.outcome_rank
                FROM participants p
                JOIN prediction_snapshots ps ON ps.participant_id = p.id AND ps.course_id = p.course_id
                WHERE p.id = b.participant_id AND ps.settled_at IS NOT NULL
                ${courseFilter}
                LIMIT 1
            ) = 1 THEN 'WIN' ELSE 'LOSE' END,
            gain = CASE WHEN (
                SELECT ps.outcome_rank
                FROM participants p
                JOIN prediction_snapshots ps ON ps.participant_id = p.id AND ps.course_id = p.course_id
                WHERE p.id = b.participant_id AND ps.settled_at IS NOT NULL
                ${courseFilter}
                LIMIT 1
            ) = 1 THEN b.mise * ((
                SELECT ps.official_payout
                FROM participants p
                JOIN prediction_snapshots ps ON ps.participant_id = p.id AND ps.course_id = p.course_id
                WHERE p.id = b.participant_id AND ps.settled_at IS NOT NULL
                ${courseFilter}
                LIMIT 1
            ) - 1) ELSE -b.mise END
        WHERE EXISTS (
            SELECT 1
            FROM participants p
            JOIN prediction_snapshots ps ON ps.participant_id = p.id AND ps.course_id = p.course_id
            WHERE p.id = b.participant_id AND ps.settled_at IS NOT NULL
              AND ps.outcome_rank IS NOT NULL
              AND (ps.outcome_rank <> 1 OR ps.official_payout > 0)
              ${courseFilter}
        )
    `, [...params, ...params, ...params, ...params]);

    const pendingWithoutPayout = await update(`
        UPDATE shadow_bets AS b
        SET resultat = 'PENDING', gain = 0
        WHERE EXISTS (
            SELECT 1
            FROM participants p
            JOIN prediction_snapshots ps ON ps.participant_id = p.id AND ps.course_id = p.course_id
            WHERE p.id = b.participant_id AND ps.settled_at IS NOT NULL
              AND ps.outcome_rank = 1 AND COALESCE(ps.official_payout, 0) <= 0
              ${courseFilter}
        )
    `, params);

    return settled + pendingWithoutPayout;
}

export async function getShadowPerformance() {
    const db = getDB();
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN resultat = 'WIN' THEN 1 ELSE 0 END) as wins,
                SUM(mise) as total_mises,
                SUM(gain) as total_gains,
                (SUM(gain) / SUM(mise) * 100) as roi
            FROM shadow_bets
            WHERE resultat != 'PENDING'
        `, (err, rows) => {
            if (err) reject(err);
            else resolve(rows[0]);
        });
    });
}

export async function recordCoteHistorique(participantId, cote) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO cotes_historique (participant_id, cote) VALUES (?, ?)', [participantId, cote], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

export async function getCotesHistorique(participantId) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM cotes_historique WHERE participant_id = ? ORDER BY timestamp ASC', [participantId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}
