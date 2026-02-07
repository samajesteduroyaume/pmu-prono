import sqlite3 from 'sqlite3';
import { CONFIG } from '../config/settings.mjs';
import logger from '../utils/logger.mjs';

let db = null;

async function createTables() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Table Courses Enrichie
            db.run(`
                CREATE TABLE IF NOT EXISTS courses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT,
                    heure TEXT,
                    hippodrome TEXT,
                    discipline TEXT,
                    distance TEXT,
                    statut TEXT,
                    partants INTEGER,
                    prix REAL,
                    reunionNum TEXT,
                    courseNum TEXT,
                    corde TEXT,
                    categorie TEXT,
                    conditions TEXT,
                    meteo TEXT,     
                    type_pari TEXT,
                    ordre_arrivee TEXT,
                    rapports TEXT,
                    UNIQUE(date, reunionNum, courseNum)
                )
            `);

            // Table Participants (Avec SCORE IA + CLASSEMENT)
            db.run(`
                CREATE TABLE IF NOT EXISTS participants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    course_id INTEGER,
                    nom TEXT,
                    numero INTEGER,
                    sexe TEXT,
                    age INTEGER,
                    musique TEXT,
                    gains REAL,
                    driver TEXT,
                    entraineur TEXT,
                    proprietaire TEXT,
                    ferrage TEXT,
                    oeilleres TEXT,
                    nb_courses INTEGER,
                    nb_victoires INTEGER,
                    nb_places INTEGER,
                    cote_ref REAL,
                    statut TEXT, 
                    prediction_score REAL,
                    classement INTEGER, 
                    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    logger.error(`Erreur création tables: ${err.message}`);
                    reject(err);
                } else {
                    // Table Paris Historique (Bankroll Management)
                    db.run(`
                        CREATE TABLE IF NOT EXISTS paris_historique (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            date TEXT,
                            course_id INTEGER,
                            participant_id INTEGER,
                            mise REAL,
                            cote REAL,
                            resultat TEXT,
                            gain REAL,
                            bankroll_avant REAL,
                            bankroll_apres REAL,
                            FOREIGN KEY(course_id) REFERENCES courses(id),
                            FOREIGN KEY(participant_id) REFERENCES participants(id)
                        )
                    `, (err2) => {
                        if (err2) {
                            logger.error(`Erreur table paris_historique: ${err2.message}`);
                        }
                        logger.info('Tables courses et participants (V12-Arrivées) créées/vérifiées');
                        resolve();
                    });
                }
            });
        });
    });
}

export async function initDB() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(CONFIG.database.path, (err) => {
            if (err) {
                logger.error(`Erreur d'ouverture de la DB: ${err.message}`);
                reject(err);
            } else {
                logger.info(`Base de données connectée: ${CONFIG.database.path}`);
                db.run('PRAGMA foreign_keys = ON');
                createTables().then(resolve).catch(reject);
            }
        });
    });
}

export async function insertCourses(courses) {
    if (!db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
        let insertedCount = 0;
        let pending = courses.length;

        if (pending === 0) {
            resolve(0);
            return;
        }

        db.serialize(() => {
            const stmtCourse = db.prepare(`
                INSERT OR IGNORE INTO courses (
                    date, heure, hippodrome, discipline, distance, statut, partants, prix, 
                    reunionNum, courseNum, corde, categorie, conditions, meteo, type_pari, ordre_arrivee, rapports
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const stmtParticipant = db.prepare(`
                INSERT INTO participants (
                    course_id, nom, numero, sexe, age, musique, gains, 
                    driver, entraineur, proprietaire, ferrage, oeilleres, nb_courses, nb_victoires, nb_places, 
                    cote_ref, statut, prediction_score, classement
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const checkCompletion = () => {
                pending--;
                if (pending === 0) {
                    stmtCourse.finalize();
                    stmtParticipant.finalize((err) => {
                        if (err) {
                            logger.error(`Erreur finalisation: ${err.message}`);
                            reject(err);
                        } else {
                            if (insertedCount > 0) {
                                logger.success(`${insertedCount} courses insérées (avec Résultats)`);
                            }
                            resolve(insertedCount);
                        }
                    });
                }
            };

            for (const c of courses) {
                stmtCourse.run(
                    c.date, c.heure, c.hippodrome, c.discipline, c.distance, c.statut, c.partants, c.prix,
                    c.reunionNum, c.courseNum, c.corde, c.categorie, c.conditions, JSON.stringify(c.meteo), c.type_pari,
                    c.ordre_arrivee, JSON.stringify(c.rapports),
                    function (err) {
                        if (err) {
                            logger.error(`Erreur insertion course ${c.reunionNum}C${c.courseNum}: ${err.message}`);
                            checkCompletion();
                            return;
                        }

                        if (this.changes > 0) {
                            const courseId = this.lastID;
                            insertedCount++;

                            if (c.participants && c.participants.length > 0) {
                                for (const p of c.participants) {
                                    stmtParticipant.run(
                                        courseId, p.nom, p.numero, p.sexe, p.age, p.musique, p.gains,
                                        p.driver, p.entraineur, p.proprietaire, p.ferrage, p.oeilleres, p.nb_courses, p.nb_victoires, p.nb_places,
                                        p.cote_ref, p.statut,
                                        p.prediction_score || 0,
                                        p.classement || null
                                    );
                                }
                            }
                        }
                        checkCompletion();
                    }
                );
            }
        });
    });
}

export async function getAllCourses() {
    if (!db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
        const query = `
            SELECT c.*, count(p.id) as nb_participants_stockes 
            FROM courses c 
            LEFT JOIN participants p ON c.id = p.course_id 
            GROUP BY c.id
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
    if (!db) throw new Error('DB not initialized');

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

export async function getIAPerformanceStats() {
    if (!db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
        // Cette requête complexe calcule :
        // 1. Le nombre total de courses jouées (où on a un prono et un résultat)
        // 2. Le nombre de victoires (IA Top 1 == Arrivée 1)
        // 3. Le ROI basé sur une mise de 1€ sur le favori IA
        // 4. L'historique quotidien pour la courbe de profit
        db.all(`
            WITH TopProne AS (
                SELECT 
                    p.course_id, 
                    p.numero, 
                    p.nom,
                    p.cote_ref, 
                    p.classement,
                    c.date,
                    ROW_NUMBER() OVER(PARTITION BY p.course_id ORDER BY p.prediction_score DESC) as rank_ia
                FROM participants p
                JOIN courses c ON p.course_id = c.id
                WHERE p.prediction_score > 0 AND c.ordre_arrivee IS NOT NULL
            ),
            BestBets AS (
                SELECT * FROM TopProne WHERE rank_ia = 1
            )
            SELECT 
                date,
                COUNT(*) as total_courses,
                SUM(CASE WHEN classement = 1 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN classement = 1 THEN cote_ref ELSE 0 END) as total_returns
            FROM BestBets
            GROUP BY date
            ORDER BY date ASC
        `, (err, rows) => {
            if (err) {
                logger.error(`Erreur stats performance: ${err.message}`);
                reject(err);
                return;
            }

            let cumulativeProfit = 0;
            const history = rows.map(r => {
                const profit = r.total_returns - r.total_courses;
                cumulativeProfit += profit;
                return {
                    date: r.date,
                    profit: parseFloat(profit.toFixed(2)),
                    cumulative: parseFloat(cumulativeProfit.toFixed(2)),
                    winRate: parseFloat(((r.wins / r.total_courses) * 100).toFixed(1))
                };
            });

            const totalCourses = rows.reduce((a, b) => a + b.total_courses, 0);
            const totalWins = rows.reduce((a, b) => a + b.wins, 0);
            const totalReturns = rows.reduce((a, b) => a + b.total_returns, 0);
            const globalROI = totalCourses > 0 ? ((totalReturns / totalCourses) - 1) * 100 : 0;

            resolve({
                global: {
                    total_courses: totalCourses,
                    wins: totalWins,
                    win_rate: totalCourses > 0 ? parseFloat(((totalWins / totalCourses) * 100).toFixed(1)) : 0,
                    roi: parseFloat(globalROI.toFixed(1)),
                    total_profit: parseFloat(cumulativeProfit.toFixed(2))
                },
                history: history
            });
        });
    });
}

export async function closeDB() {
    if (db) {
        return new Promise((resolve) => {
            db.close((err) => {
                if (err) logger.error(`Erreur fermeture DB: ${err.message}`);
                else logger.info('Base de données fermée');
                db = null;
                resolve();
            });
        });
    }
}