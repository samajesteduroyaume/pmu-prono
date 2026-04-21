import { getDB } from '../db.mjs';
import logger from '../../utils/logger.mjs';

// V30: Verrouillage Mutex pour éviter les transactions concurrentes
let isInserting = false;
const syncQueue = [];

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

        await run('BEGIN TRANSACTION');
        transactionStarted = true;

        const sqlCourse = `
            INSERT INTO courses (
                date, heure, hippodrome, discipline, distance, statut, partants, prix, 
                reunionNum, courseNum, corde, categorie, conditions, meteo, type_pari, ordre_arrivee, rapports
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, reunionNum, courseNum) DO UPDATE SET
                statut = excluded.statut,
                ordre_arrivee = excluded.ordre_arrivee,
                rapports = excluded.rapports,
                meteo = excluded.meteo,
                type_pari = excluded.type_pari,
                partants = excluded.partants
        `;

        const sqlParticipant = `
            INSERT INTO participants (
                course_id, nom, numero, sexe, age, musique, gains, 
                driver, entraineur, proprietaire, ferrage, oeilleres, nb_courses, nb_victoires, nb_places, 
                cat_statut, cote_ref, statut, prediction_score, classement, avis
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(course_id, numero) DO UPDATE SET
                cote_ref = excluded.cote_ref,
                statut = excluded.statut,
                classement = excluded.classement,
                musique = excluded.musique,
                gains = excluded.gains,
                cat_statut = excluded.cat_statut,
                avis = excluded.avis
        `;

        for (const c of courses) {
            await run(sqlCourse, [
                c.date, c.heure, c.hippodrome, c.discipline, c.distance, c.statut, c.partants, c.prix,
                c.reunionNum, c.courseNum, c.corde, c.categorie, c.conditions, JSON.stringify(c.meteo), c.type_pari,
                c.ordre_arrivee, JSON.stringify(c.rapports)
            ]);

            const row = await get("SELECT id FROM courses WHERE date = ? AND reunionNum = ? AND courseNum = ?",
                [c.date, c.reunionNum, c.courseNum]);

            if (row && c.participants) {
                for (const p of c.participants) {
                    await run(sqlParticipant, [
                        row.id, p.nom, p.numero, p.sexe, p.age, p.musique, p.gains,
                        p.driver, p.entraineur, p.proprietaire, p.ferrage, p.oeilleres, p.nb_courses, p.nb_victoires, p.nb_places,
                        p.cat_statut || 'STABLE', p.cote_ref, p.statut, p.prediction_score || 0, p.classement || null, p.avis || null
                    ]);
                }
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

export async function getAllCourses() {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const query = `
            SELECT c.*, 
                   (SELECT count(*) FROM participants WHERE course_id = c.id) as nb_participants_stockes,
                   (SELECT '#' || numero || ' ' || nom FROM participants WHERE course_id = c.id AND cote_ref > 0 ORDER BY cote_ref ASC LIMIT 1) as fav_nom,
                   (SELECT cote_ref FROM participants WHERE course_id = c.id AND cote_ref > 0 ORDER BY cote_ref ASC LIMIT 1) as fav_cote,
                   (SELECT '#' || numero || ' ' || nom FROM participants WHERE course_id = c.id AND prediction_score > 0 ORDER BY prediction_score DESC LIMIT 1) as ia_nom,
                   (SELECT prediction_score FROM participants WHERE course_id = c.id AND prediction_score > 0 ORDER BY prediction_score DESC LIMIT 1) as ia_score
            FROM courses c
            ORDER BY c.date DESC, c.heure ASC
            LIMIT 300
        `;
        db.all(query, (err, rows) => {
            if (err) {
                logger.error(`Erreur récupération courses: ${err.message}`);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

export async function getCourseParticipants(courseId) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const query = `
            SELECT p.*, c.prix as prix_course
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
                resolve(rows);
            }
        });
    });
}

export async function getCourseQuinte() {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().split('T')[0];
        const query = `
            SELECT c.*, COUNT(p.id) as nb_partants
            FROM courses c
            JOIN participants p ON c.id = p.course_id
            WHERE c.date = ? 
            GROUP BY c.id
            HAVING nb_partants >= 13
            ORDER BY c.prix DESC, nb_partants DESC
            LIMIT 1
        `;

        db.get(query, [today], (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

export async function getDisciplines() {
    const db = getDB();
    return new Promise((resolve) => {
        db.all("SELECT DISTINCT discipline FROM courses WHERE discipline IS NOT NULL", (err, rows) => {
            resolve(rows ? rows.map(r => r.discipline) : []);
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

export async function getChevauxEnRetardDeGain(days = 2) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        const dateFilter = `WHERE c.date >= date('now') AND c.date <= date('now', '+${days} days')`;

        db.all(`SELECT id, date, reunionNum, courseNum, hippodrome, discipline, prix FROM courses c ${dateFilter}`, async (err, courses) => {
            if (err) return reject(err);

            const opportunities = [];

            for (const course of courses) {
                const participants = await getCourseParticipants(course.id);
                if (!participants || participants.length < 5) continue;

                let totalRatio = 0;
                let totalCourses = 0;
                let count = 0;

                const validParticipants = participants.filter(p => p.nb_courses > 0 && p.gains > 0);
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
        });
    });
}
