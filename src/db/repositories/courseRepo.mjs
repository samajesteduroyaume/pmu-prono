import { getDB } from '../db.mjs';
import { settleShadowBets } from './pariRepo.mjs';
import logger from '../../utils/logger.mjs';
import { formatDate, formatHeure } from '../../utils/dateUtils.mjs';
import { NON_RUNNER_STATUS_SQL, isNonRunnerStatus } from '../../core/runner_status.mjs';
import { ML_FEATURE_SCHEMA_VERSION } from '../../ml/model_compatibility.mjs';

const COURSE_LIST_SELECT = `
    c.*,
    (SELECT count(*) FROM participants WHERE course_id = c.id) as nb_participants_stockes,
    (SELECT '#' || numero || ' ' || nom FROM participants WHERE course_id = c.id AND cote_ref > 0 ORDER BY cote_ref ASC LIMIT 1) as fav_nom,
    (SELECT cote_ref FROM participants WHERE course_id = c.id AND cote_ref > 0 ORDER BY cote_ref ASC LIMIT 1) as fav_cote,
    (SELECT '#' || numero || ' ' || nom FROM participants WHERE course_id = c.id AND prediction_score > 0 ORDER BY prediction_score DESC LIMIT 1) as ia_nom,
    (SELECT nom FROM participants WHERE course_id = c.id AND prediction_score > 0 ORDER BY prediction_score DESC LIMIT 1) as ia_nom_brut,
    (SELECT musique FROM participants WHERE course_id = c.id AND prediction_score > 0 ORDER BY prediction_score DESC LIMIT 1) as ia_musique,
    (SELECT prediction_score FROM participants WHERE course_id = c.id AND prediction_score > 0 ORDER BY prediction_score DESC LIMIT 1) as ia_score
`;

// V30: Verrouillage Mutex pour éviter les transactions concurrentes
let isInserting = false;
const syncQueue = [];

function findSimpleWinPayout(reports, horseNumber) {
    const pools = Array.isArray(reports?.paysParieur) ? reports.paysParieur : [];
    for (const pool of pools) {
        const entries = Array.isArray(pool?.rapports) ? pool.rapports : [];
        const result = entries.find(item =>
            ['E_SIMPLE_GAGNANT', 'SIMPLE_GAGNANT'].includes(String(item.libellePari || '').toUpperCase())
            && String(item.combinaison).trim() === String(horseNumber)
        );
        const dividend = Number(result?.dividende);
        if (Number.isFinite(dividend) && dividend > 0) return dividend / 100;
    }
    return null;
}

async function acquireLock() {
    if (!isInserting) {
        isInserting = true;
        return;
    }
    return new Promise(resolve => syncQueue.push(resolve));
}

function releaseLock() {
    if (syncQueue.length > 0) {
        const next = syncQueue.shift();
        next();
    } else {
        isInserting = false;
    }
}

export async function insertCourses(courses) {
    const db = getDB();
    if (!courses || courses.length === 0) return 0;

    await acquireLock();
    let transactionStarted = false;

    try {
        const run = (sql, params) => new Promise((res, rej) => {
            db.run(sql, params, function (err) {
                if (err) rej(err);
                else res(this);
            });
        });

        const get = (sql, params) => new Promise((res, rej) => {
            db.get(sql, params, (err, row) => {
                if (err) rej(err);
                else res(row);
            });
        });

        const capturePredictionSnapshot = async (courseId, modelVersion) => {
            const today = formatDate(new Date());
            const nowTime = formatHeure(new Date());
            const capturedAt = new Date().toISOString();
            // Garder le dernier état connu avant le départ (cotes, partants,
            // scores et variables), sans toucher aux prédictions déjà réglées.
            await run(`
                DELETE FROM prediction_snapshots
                WHERE course_id = ? AND settled_at IS NULL
                  AND EXISTS (
                      SELECT 1 FROM courses c
                      WHERE c.id = prediction_snapshots.course_id
                        AND (c.date > ? OR (c.date = ? AND time(c.heure) > time(?)))
                        AND COALESCE(c.ordre_arrivee, '') = ''
                        AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%ARRIV%'
                        AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%TERMINE%'
                        AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%FIN_COURSE%'
                        AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%EN_COURS%'
                        AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%DEPART%'
                        AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%ANNULE%'
                        AND EXISTS (
                            SELECT 1 FROM participants p
                            WHERE p.course_id = c.id
                              AND COALESCE(UPPER(p.statut), 'PARTANT') NOT IN (${NON_RUNNER_STATUS_SQL})
                        )
                        AND NOT EXISTS (
                            SELECT 1 FROM participants p
                            WHERE p.course_id = c.id
                              AND COALESCE(UPPER(p.statut), 'PARTANT') NOT IN (${NON_RUNNER_STATUS_SQL})
                              AND (p.prediction_features IS NULL OR p.prediction_score IS NULL)
                        )
                  )
            `, [courseId, today, today, nowTime]);
            await run(`
                WITH field AS (
                    SELECT p.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY p.course_id ORDER BY p.prediction_score DESC, p.numero ASC
                           ) AS prediction_rank,
                           ROW_NUMBER() OVER (
                               PARTITION BY p.course_id
                               ORDER BY CASE WHEN p.cote_ref > 1 THEN p.cote_ref ELSE 1e9 END, p.numero ASC
                           ) AS market_rank,
                           SUM(CASE WHEN p.cote_ref > 1 THEN 1.0 / p.cote_ref ELSE 0 END)
                               OVER (PARTITION BY p.course_id) AS market_total
                    FROM participants p
                    WHERE COALESCE(UPPER(p.statut), 'PARTANT') NOT IN (${NON_RUNNER_STATUS_SQL})
                )
                INSERT OR IGNORE INTO prediction_snapshots (
                    course_id, participant_id, horse_number, horse_name, course_date,
                    scheduled_time, discipline, hippodrome, distance, captured_at,
                    source, model_version, prediction_score, prediction_rank, heuristic_score,
                    odds_at_prediction, market_probability, market_rank, has_form, has_driver,
                    feature_vector_json, feature_schema_version
                )
                SELECT c.id, field.id, field.numero, field.nom, c.date,
                       c.heure, c.discipline, c.hippodrome, c.distance, ?,
                       'pmu-api', ?, field.prediction_score, field.prediction_rank, field.prediction_heuristic_score,
                       field.cote_ref,
                       CASE WHEN field.cote_ref > 1 AND field.market_total > 0
                           THEN (1.0 / field.cote_ref) / field.market_total ELSE NULL END,
                       CASE WHEN field.cote_ref > 1 THEN field.market_rank ELSE NULL END,
                       CASE WHEN COALESCE(field.musique, '') NOT IN ('', '?') THEN 1 ELSE 0 END,
                       CASE WHEN COALESCE(field.driver, '') NOT IN ('', '?') THEN 1 ELSE 0 END,
                       field.prediction_features, ?
                FROM courses c
                JOIN field ON field.course_id = c.id
                WHERE c.id = ?
                  AND (c.date > ? OR (c.date = ? AND time(c.heure) > time(?)))
                  AND COALESCE(c.ordre_arrivee, '') = ''
                  AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%ARRIV%'
                  AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%TERMINE%'
                  AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%FIN_COURSE%'
                  AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%EN_COURS%'
                  AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%DEPART%'
                  AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%ANNULE%'
                  AND NOT EXISTS (
                      SELECT 1 FROM participants p
                      WHERE p.course_id = c.id
                        AND COALESCE(UPPER(p.statut), 'PARTANT') NOT IN (${NON_RUNNER_STATUS_SQL})
                        AND (p.prediction_features IS NULL OR p.prediction_score IS NULL)
                  )
            `, [capturedAt, modelVersion || 'hybrid-unknown', ML_FEATURE_SCHEMA_VERSION, courseId, today, today, nowTime]);
        };

        const settlePredictionSnapshots = async course => {
            if (!course.ordre_arrivee || !['ARRIVEE_DEFINITIVE_COMPLETE', 'ARRIVE_DEFINITIVE'].includes(String(course.statut).toUpperCase())) return;
            const arrival = String(course.ordre_arrivee).split(/[-,]/).map(value => Number.parseInt(value.trim(), 10)).filter(Number.isInteger);
            if (!arrival.length) return;
            let reports = course.rapports;
            if (typeof reports === 'string') {
                try { reports = JSON.parse(reports); } catch { reports = null; }
            }
            const rows = await new Promise((resolve, reject) => db.all(`
                SELECT ps.id, ps.horse_number, p.classement, p.statut, ps.outcome_rank,
                       ps.official_payout, ps.settled_at
                FROM prediction_snapshots ps
                JOIN participants p ON p.id = ps.participant_id
                WHERE ps.course_id = ?
            `, [course.id], (err, result) => err ? reject(err) : resolve(result || [])));
            for (const snapshot of rows) {
                const reportsJson = JSON.stringify(reports ?? null);
                const runnerStatus = String(snapshot.statut || '').toUpperCase().trim();
                const isNonRunner = isNonRunnerStatus(runnerStatus);
                if (snapshot.settled_at) {
                    const reportedPayout = findSimpleWinPayout(reports, snapshot.horse_number);
                    const confirmedWinner = Number.isFinite(reportedPayout) && reportedPayout > 0;
                    if (confirmedWinner || reports || snapshot.outcome_rank === null || snapshot.outcome_rank === undefined) {
                        await run(`
                            UPDATE prediction_snapshots
                            SET outcome_rank = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(outcome_rank, 0) END,
                                is_non_runner = CASE WHEN ? = 1 THEN 1 ELSE is_non_runner END,
                                official_payout = COALESCE(?, official_payout),
                                reports_json = COALESCE(?, reports_json)
                            WHERE id = ?
                        `, [confirmedWinner ? 1 : 0, isNonRunner ? 1 : 0, reportedPayout || null, reports ? reportsJson : null, snapshot.id]);
                    }
                    if (isNonRunner) await run('UPDATE prediction_snapshots SET is_non_runner = 1 WHERE id = ?', [snapshot.id]);
                    continue;
                }
                const classifiedRank = Number.parseInt(snapshot.classement, 10);
                const arrivalIndex = arrival.indexOf(Number(snapshot.horse_number));
                const payout = findSimpleWinPayout(reports, snapshot.horse_number);
                // Participant classement carries the official individual rank (including dead heats).
                // If that rank is absent, an official Simple gagnant dividend can still
                // confirm a dead-heat winner before consulting the flattened arrival string.
                const outcomeRank = Number.isInteger(classifiedRank) && classifiedRank > 0
                    ? classifiedRank
                    : (payout ? 1 : (arrivalIndex >= 0 ? arrivalIndex + 1 : 0));
                const officialPayout = outcomeRank === 1 ? payout : null;
                await run(`
                    UPDATE prediction_snapshots
                    SET outcome_rank = ?, is_non_runner = ?, official_arrival = ?, official_payout = ?,
                        reports_json = ?, settled_at = ?
                    WHERE id = ? AND settled_at IS NULL
                `, [outcomeRank, isNonRunner ? 1 : 0, course.ordre_arrivee, officialPayout, reportsJson, new Date().toISOString(), snapshot.id]);
            }
        };

        await run('BEGIN TRANSACTION');
        transactionStarted = true;

        const sqlCourse = `
            INSERT INTO courses (
                date, heure, hippodrome, discipline, distance, statut, partants, prix, 
                reunionNum, courseNum, corde, categorie, conditions, meteo, type_pari, ordre_arrivee, rapports, terrain
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, reunionNum, courseNum) DO UPDATE SET
                heure = excluded.heure,
                hippodrome = excluded.hippodrome,
                discipline = excluded.discipline,
                distance = excluded.distance,
                statut = excluded.statut,
                partants = excluded.partants,
                prix = excluded.prix,
                corde = excluded.corde,
                categorie = excluded.categorie,
                conditions = excluded.conditions,
                meteo = excluded.meteo,
                type_pari = excluded.type_pari,
                ordre_arrivee = COALESCE(NULLIF(excluded.ordre_arrivee, ''), courses.ordre_arrivee),
                rapports = COALESCE(NULLIF(excluded.rapports, 'null'), courses.rapports),
                terrain = excluded.terrain
        `;

        const sqlParticipant = `
            INSERT INTO participants (
                course_id, nom, numero, sexe, age, musique, gains, 
                driver, entraineur, proprietaire, ferrage, oeilleres, nb_courses, nb_victoires, nb_places, 
                cat_statut, cote_ref, statut, prediction_score, prediction_heuristic_score, classement, avis,
                distance_course, distances_history, terrain_prefere, corde, poids, recul, prediction_features
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(course_id, numero) DO UPDATE SET
                cote_ref = excluded.cote_ref,
                statut = excluded.statut,
                classement = COALESCE(NULLIF(excluded.classement, ''), participants.classement),
                musique = excluded.musique,
                gains = excluded.gains,
                cat_statut = excluded.cat_statut,
                avis = excluded.avis,
                distance_course = excluded.distance_course,
                distances_history = COALESCE(excluded.distances_history, distances_history),
                terrain_prefere = COALESCE(excluded.terrain_prefere, terrain_prefere),
                corde = excluded.corde,
                poids = excluded.poids,
                recul = excluded.recul,
                prediction_score = excluded.prediction_score,
                prediction_heuristic_score = excluded.prediction_heuristic_score,
                prediction_features = excluded.prediction_features
        `;

        for (const c of courses) {
            await run(sqlCourse, [
                c.date, c.heure, c.hippodrome, c.discipline, c.distance, c.statut, c.partants, c.prix,
                c.reunionNum, c.courseNum, c.corde, c.categorie, c.conditions, JSON.stringify(c.meteo), c.type_pari,
                c.ordre_arrivee, JSON.stringify(c.rapports), c.terrain || null
            ]);

            const row = await get("SELECT id, ordre_arrivee, rapports, statut FROM courses WHERE date = ? AND reunionNum = ? AND courseNum = ?",
                [c.date, c.reunionNum, c.courseNum]);

            if (row && c.participants) {
                for (const p of c.participants) {
                    await run(sqlParticipant, [
                        row.id, p.nom, p.numero, p.sexe, p.age, p.musique, p.gains,
                        p.driver, p.entraineur, p.proprietaire, p.ferrage, p.oeilleres, p.nb_courses, p.nb_victoires, p.nb_places,
                        p.cat_statut || 'STABLE', p.cote_ref, p.statut, p.prediction_score || 0,
                        Number.isFinite(p.prediction_heuristic_score) ? p.prediction_heuristic_score : null,
                        p.classement || null, p.avis || null,
                        p.distance_course || null, p.distances_history || null, p.terrain_prefere || null, p.corde || 0, p.poids || 0, p.recul || 0,
                        Array.isArray(p.prediction_features) ? JSON.stringify(p.prediction_features) : null
                    ]);
                }
                await capturePredictionSnapshot(row.id, c.prediction_model_version);
            }
            if (row) {
                await settlePredictionSnapshots({
                    ...c,
                    id: row.id,
                    ordre_arrivee: c.ordre_arrivee || row.ordre_arrivee,
                    rapports: c.rapports || row.rapports,
                    statut: c.statut || row.statut
                });
                await settleShadowBets(row.id);
            }
        }

        await run('COMMIT');
        transactionStarted = false;
        logger.success(`${courses.length} courses synchronisées (v23 Stable)`);
        return courses.length;

    } catch (err) {
        logger.error(`Erreur SQL Sync: ${err.message}`);
        if (transactionStarted) {
            try {
                await new Promise(r => db.run('ROLLBACK', () => r()));
            } catch (retryErr) {
                logger.error(`Erreur Rollback: ${retryErr.message}`);
            }
        }
        throw err;
    } finally {
        releaseLock();
    }
}

export async function getAllCourses(limit = 300) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const query = `SELECT ${COURSE_LIST_SELECT}
            FROM courses c
            ORDER BY c.date DESC, c.heure ASC, c.id ASC`;
        const hasLimit = Number.isInteger(limit) && limit > 0;
        db.all(query + (hasLimit ? ' LIMIT ?' : ''), hasLimit ? [limit] : [], (err, rows) => {
            if (err) {
                logger.error(`Erreur récupération courses: ${err.message}`);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

/** Filter cheaply, paginate matching course IDs, then enrich only the visible page. */
export async function getCoursesPage({ date = null, discipline = null, hippodrome = null, page = 1, limit = 50 } = {}) {
    const db = getDB();
    const conditions = [];
    const params = [];
    if (date) {
        conditions.push('date = ?');
        params.push(date);
    }
    if (discipline) {
        conditions.push('discipline = ?');
        params.push(discipline);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    let ids;
    let total;
    if (hippodrome) {
        // Keep JavaScript's Unicode-aware substring matching for hippodrome names.
        const candidates = await new Promise((resolve, reject) => db.all(
            `SELECT id, hippodrome FROM courses ${where} ORDER BY date DESC, heure ASC, id ASC`,
            params,
            (error, rows) => error ? reject(error) : resolve(rows || [])
        ));
        const matchingIds = candidates
            .filter(course => String(course.hippodrome || '').toLowerCase().includes(hippodrome.toLowerCase()))
            .map(course => course.id);
        total = matchingIds.length;
        ids = matchingIds.slice(offset, offset + limit);
    } else {
        const count = await new Promise((resolve, reject) => db.get(
            `SELECT COUNT(*) AS total FROM courses ${where}`,
            params,
            (error, row) => error ? reject(error) : resolve(row?.total || 0)
        ));
        total = count;
        ids = await new Promise((resolve, reject) => db.all(
            `SELECT id FROM courses ${where} ORDER BY date DESC, heure ASC, id ASC LIMIT ? OFFSET ?`,
            [...params, limit, offset],
            (error, rows) => error ? reject(error) : resolve((rows || []).map(row => row.id))
        ));
    }
    if (!ids.length) return { courses: [], total };

    const placeholders = ids.map(() => '?').join(', ');
    const courses = await new Promise((resolve, reject) => db.all(
        `SELECT ${COURSE_LIST_SELECT} FROM courses c WHERE c.id IN (${placeholders}) ORDER BY c.date DESC, c.heure ASC, c.id ASC`,
        ids,
        (error, rows) => error ? reject(error) : resolve(rows || [])
    ));
    return { courses, total };
}

export async function getCourseById(id) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const query = `
            SELECT c.*, 
                   (SELECT count(*) FROM participants WHERE course_id = c.id) as nb_participants_stockes,
                   (SELECT '#' || numero || ' ' || nom FROM participants WHERE course_id = c.id AND cote_ref > 0 ORDER BY cote_ref ASC LIMIT 1) as fav_nom,
                   (SELECT cote_ref FROM participants WHERE course_id = c.id AND cote_ref > 0 ORDER BY cote_ref ASC LIMIT 1) as fav_cote,
                   (SELECT '#' || numero || ' ' || nom FROM participants WHERE course_id = c.id AND prediction_score > 0 ORDER BY prediction_score DESC LIMIT 1) as ia_nom,
                   (SELECT musique FROM participants WHERE course_id = c.id AND prediction_score > 0 ORDER BY prediction_score DESC LIMIT 1) as ia_musique,
                   (SELECT prediction_score FROM participants WHERE course_id = c.id AND prediction_score > 0 ORDER BY prediction_score DESC LIMIT 1) as ia_score
            FROM courses c
            WHERE c.id = ?
        `;
        db.get(query, [id], (err, row) => {
            if (err) {
                logger.error(`Erreur getCourseById ${id}: ${err.message}`);
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

export async function getAllCoursesWithResults() {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const query = `
            SELECT * FROM courses 
            WHERE ordre_arrivee IS NOT NULL 
              AND ordre_arrivee != ''
            ORDER BY date DESC
        `;
        db.all(query, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

export async function getCourseParticipants(courseId) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const query = `
            SELECT p.*,
                   c.prix as prix_course,
                   c.terrain as terrain_course,
                   c.distance as distance_course_raw,
                   c.discipline as discipline_course,
                   c.hippodrome as hippodrome_course
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE p.course_id = ? 
            ORDER BY p.prediction_score DESC
        `;
        db.all(query, [courseId], (err, rows) => {
            if (err) {
                logger.error(`Erreur récupération participants: ${err.message}`);
                reject(err);
            } else {
                // Normaliser : exposer terrain_course et distance pour les moteurs
                const enriched = rows.map(row => ({
                    ...row,
                    _terrain_course: row.terrain_course || null,
                    _distance_course: row.distance_course_raw ?? row.distance_course ?? 0
                }));
                resolve(enriched);
            }
        });
    });
}


export async function getCourseQuinte(targetDate = null) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const requestedDate = targetDate || formatDate(new Date());
        const queryExact = `
            SELECT c.*, COUNT(p.id) as nb_partants
            FROM courses c
            JOIN participants p ON c.id = p.course_id
            WHERE c.date = ? 
            GROUP BY c.id
            ORDER BY 
                (CASE WHEN c.type_pari LIKE '%QUINTE%' THEN 1 ELSE 0 END) DESC,
                c.prix DESC, 
                nb_partants DESC
            LIMIT 1
        `;
        db.get(queryExact, [requestedDate], (err, row) => {
            if (err) return reject(err);
            resolve(row && (row.type_pari?.includes('QUINTE') || row.nb_partants >= 12) ? row : null);
        });
    });
}

export async function getParticipantId(date, reunionNum, courseNum, horseNum) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const query = `
            SELECT p.id 
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE c.date = ? 
              AND c.reunionNum = ? 
              AND c.courseNum = ? 
              AND p.numero = ?
            LIMIT 1
        `;
        db.get(query, [date, reunionNum.toString(), courseNum.toString(), parseInt(horseNum)], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.id : null);
        });
    });
}

/**
 * Récupère l'historique des performances d'un cheval depuis la base de données locale.
 */
export async function getHorseHistory(horseName, limit = 15, before = null) {
    let db;
    try {
        db = getDB();
    } catch (e) {
        return [];
    }
    if (!db || !horseName) return [];

    return new Promise((resolve) => {
        const normalizedCourseTime = `CASE WHEN instr(c.heure, ':') > 0
            THEN printf('%02d:%02d',
                CAST(substr(c.heure, 1, instr(c.heure, ':') - 1) AS INTEGER),
                CAST(substr(c.heure, instr(c.heure, ':') + 1, 2) AS INTEGER))
            ELSE NULL END`;
        const dateCutoff = before?.date
            ? (before.time
                ? `AND (c.date < ? OR (c.date = ? AND ${normalizedCourseTime} < time(?)))`
                : 'AND c.date < ?')
            : '';
        const params = before?.date
            ? (before.time ? [horseName, before.date, before.date, before.time, limit] : [horseName, before.date, limit])
            : [horseName, limit];
        const query = `
            SELECT 
                p.classement, 
                c.date, 
                c.distance, 
                c.terrain, 
                c.discipline,
                c.prix,
                p.cote_ref
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE p.nom = ? 
              AND c.ordre_arrivee IS NOT NULL
              AND c.ordre_arrivee != ''
              AND CAST(p.classement AS INTEGER) > 0
              ${dateCutoff}
            ORDER BY c.date DESC, ${normalizedCourseTime} DESC, c.id DESC
            LIMIT ?
        `;
        db.all(query, params, (err, rows) => {
            if (err) {
                logger.error(`Erreur getHorseHistory pour ${horseName}: ${err.message}`);
                resolve([]);
            } else {
                resolve(rows || []);
            }
        });
    });
}

export async function getChevauxEnRetardDeGain(days = 2) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const dayCount = Number.isFinite(Number(days)) ? Math.max(0, Math.min(3650, Math.trunc(Number(days)))) : 2;
        const today = formatDate(new Date());
        const lastDay = new Date(`${today}T12:00:00.000Z`);
        lastDay.setUTCDate(lastDay.getUTCDate() + dayCount);
        const endDate = lastDay.toISOString().slice(0, 10);
        const nowTime = formatHeure(new Date());

        db.all(`
            SELECT id, date, reunionNum, courseNum, hippodrome, discipline, prix
            FROM courses c
            WHERE c.date >= ? AND c.date <= ?
              AND (c.date > ? OR (c.date = ? AND time(c.heure) > time(?)))
              AND COALESCE(c.ordre_arrivee, '') = ''
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%ARRIV%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%TERMINE%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%FIN_COURSE%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%EN_COURS%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%DEPART%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%PARTI%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%ANNULE%'
            ORDER BY c.date, time(c.heure), c.id
        `, [today, endDate, today, today, nowTime], (err, courses) => {
            if (err) return reject(err);

            (async () => {
                const opportunities = [];

                for (const course of courses) {
                    const participants = await getCourseParticipants(course.id);
                    if (!participants) continue;

                    let totalRatio = 0;
                    let totalCourses = 0;
                    let count = 0;

                    const validParticipants = participants.filter(p =>
                        !isNonRunnerStatus(p.statut)
                        && Number.isFinite(Number(p.nb_courses)) && Number(p.nb_courses) > 0
                        && Number.isFinite(Number(p.gains)) && Number(p.gains) > 0
                    );
                    if (validParticipants.length < 5) continue;

                    for (const p of validParticipants) {
                        const ratio = p.gains / p.nb_courses;
                        totalRatio += ratio;
                        totalCourses += p.nb_courses;
                        count++;
                    }

                    const avgRatio = totalRatio / count;
                    const avgCourses = totalCourses / count;

                    for (const p of validParticipants) {
                        const pRatio = p.gains / p.nb_courses;
                        const isQuality = pRatio > (avgRatio * 1.3);
                        const isPreserved = p.nb_courses < avgCourses;

                        if (isQuality && isPreserved) {
                            opportunities.push({
                                date: course.date,
                                reunion: course.reunionNum,
                                course: course.courseNum,
                                hippodrome: course.hippodrome,
                                cheval: p.nom,
                                driver: p.driver,
                                entraineur: p.entraineur,
                                ratio_cheval: Math.round(pRatio),
                                ratio_moyen_course: Math.round(avgRatio),
                                diff_percent: Math.round(((pRatio / avgRatio) - 1) * 100),
                                nb_courses: p.nb_courses,
                                avg_courses_course: Math.round(avgCourses)
                            });
                        }
                    }
                }

                opportunities.sort((a, b) => b.diff_percent - a.diff_percent);
                resolve(opportunities);
            })().catch(reject);
        });
    });
}
