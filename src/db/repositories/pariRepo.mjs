import { getDB } from '../db.mjs';
import logger from '../../utils/logger.mjs';

export async function getHistoriqueParis(days = null) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        let dateFilter = '';
        if (days) {
            if (days === 365) {
                dateFilter = `AND c.date >= date('now', '-1 year')`;
            } else {
                dateFilter = `AND c.date >= date('now', '-${days} days')`;
            }
        }

        db.all(`
            WITH TopProne AS (
                SELECT 
                    p.course_id,
                    p.nom,
                    p.numero,
                    p.cote_ref,
                    p.classement,
                    c.date,
                    c.discipline,
                    c.hippodrome,
                    c.heure,
                    c.reunionNum,
                    c.courseNum,
                    ROW_NUMBER() OVER(PARTITION BY p.course_id ORDER BY p.prediction_score DESC) as rank_ia
                FROM participants p
                JOIN courses c ON p.course_id = c.id
                WHERE p.prediction_score >= 80 AND c.ordre_arrivee IS NOT NULL ${dateFilter}
            )
            SELECT * FROM TopProne WHERE rank_ia = 1
            ORDER BY date ASC
        `, (err, rows) => {
            if (err) {
                logger.error(`Erreur historique paris: ${err.message}`);
                reject(err);
                return;
            }

            let cumulativeProfit = 0;
            const historique = rows.map(r => {
                const isWin = parseInt(r.classement) === 1;
                const gain = isWin ? (parseFloat(r.cote_ref) - 1) : -1;
                cumulativeProfit += gain;

                return {
                    date: r.date,
                    course_id: r.course_id,
                    reunion: r.reunionNum,
                    course: r.courseNum,
                    cheval: r.nom,
                    numero: r.numero,
                    cote: parseFloat(r.cote_ref),
                    classement: parseInt(r.classement),
                    resultat: isWin ? 'WIN' : 'LOSE',
                    gain: parseFloat(gain.toFixed(2)),
                    cumulative: parseFloat(cumulativeProfit.toFixed(2)),
                    discipline: r.discipline,
                    hippodrome: r.hippodrome,
                    heure: r.heure
                };
            });

            resolve(historique);
        });
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
        db.run(`
            INSERT INTO shadow_bets (participant_id, date, reunion, course, nom, mise, cote, proba, edge, resultat, gain)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            'PENDING',
            0
        ], function (err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
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
