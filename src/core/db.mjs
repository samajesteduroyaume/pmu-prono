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
                    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
                    UNIQUE(course_id, numero)
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

                        // Indexation Critique
                        db.run('CREATE INDEX IF NOT EXISTS idx_participants_course_id ON participants(course_id)');
                        db.run('CREATE INDEX IF NOT EXISTS idx_participants_cote_ref ON participants(cote_ref)');
                        db.run('CREATE INDEX IF NOT EXISTS idx_participants_prediction_score ON participants(prediction_score)');
                        db.run('CREATE INDEX IF NOT EXISTS idx_courses_date ON courses(date)');

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

    if (!courses || courses.length === 0) return 0;

    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                // Fonction utilitaire pour wrapper run en Promise
                const run = (sql, params) => new Promise((res, rej) => {
                    db.run(sql, params, function (err) {
                        if (err) rej(err);
                        else res(this);
                    });
                });

                // Fonction utilitaire pour wrapper get en Promise
                const get = (sql, params) => new Promise((res, rej) => {
                    db.get(sql, params, (err, row) => {
                        if (err) rej(err);
                        else res(row);
                    });
                });

                await run('BEGIN TRANSACTION');

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
                        cat_statut, cote_ref, statut, prediction_score, classement
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(course_id, numero) DO UPDATE SET
                        cote_ref = excluded.cote_ref,
                        statut = excluded.statut,
                        classement = excluded.classement,
                        musique = excluded.musique,
                        gains = excluded.gains,
                        cat_statut = excluded.cat_statut
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
                                p.cat_statut || 'STABLE', p.cote_ref, p.statut, p.prediction_score || 0, p.classement || null
                            ]);
                        }
                    }
                }

                await run('COMMIT');
                logger.success(`${courses.length} courses synchronisées (v23 Stable)`);
                resolve(courses.length);

            } catch (err) {
                logger.error(`Erreur Transaction: ${err.message}`);
                db.run('ROLLBACK');
                reject(err);
            }
        });
    });
}

export async function getAllCourses() {
    if (!db) throw new Error('DB not initialized');

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

export async function getIAPerformanceStats(days = null) {
    if (!db) throw new Error('DB not initialized');

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
                    p.numero, 
                    p.nom,
                    p.cote_ref, 
                    p.classement,
                    c.date,
                    c.discipline,
                    c.hippodrome,
                    c.heure,
                    ROW_NUMBER() OVER(PARTITION BY p.course_id ORDER BY p.prediction_score DESC) as rank_ia
                FROM participants p
                JOIN courses c ON p.course_id = c.id
                WHERE p.prediction_score > 0 AND c.ordre_arrivee IS NOT NULL ${dateFilter}
            ),
            BestBets AS (
                SELECT * FROM TopProne WHERE rank_ia = 1
            )
            SELECT 
                date,
                discipline,
                hippodrome,
                heure,
                nom,
                cote_ref,
                classement,
                COUNT(*) as total_courses,
                SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN CAST(cote_ref AS FLOAT) ELSE 0 END) as total_returns
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
                const isWin = r.wins > 0;
                return {
                    date: r.date,
                    profit: parseFloat(profit.toFixed(2)),
                    cumulative: parseFloat(cumulativeProfit.toFixed(2)),
                    winRate: parseFloat(((r.wins / r.total_courses) * 100).toFixed(1)),
                    gain: profit, // Pour les calculs de tendances
                    resultat: isWin ? 'WIN' : 'LOSE',
                    discipline: r.discipline,
                    hippodrome: r.hippodrome,
                    heure: r.heure
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

/**
 * Récupère l'historique complet des paris avec détails pour analyse de tendances
 * @param {number} days - Nombre de jours à récupérer (null = tout)
 * @returns {Promise<Array>} Historique détaillé
 */
export async function getHistoriqueParis(days = null) {
    if (!db) throw new Error('DB not initialized');

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
                WHERE p.prediction_score > 0 AND c.ordre_arrivee IS NOT NULL ${dateFilter}
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

/**
 * Calcule les tendances cumulées avec le module tendances.mjs
 * @param {number} days - Nombre de jours à analyser
 * @returns {Promise<Object>} Analyse complète des tendances
 */
export async function getTendancesCumulees(days = null) {
    if (!db) throw new Error('DB not initialized');

    try {
        // Import dynamique du module tendances
        const { analyserTendancesCompletes } = await import('./tendances.mjs');

        // Récupération de l'historique
        const historique = await getHistoriqueParis(days);

        if (!historique || historique.length === 0) {
            return {
                tendance: { tendance: 'NEUTRE', pente: 0 },
                momentum: 50,
                drawdown: { current: 0, max: 0, currentPercent: 0, maxPercent: 0 },
                variance: { variance: 0, ecartType: 0 },
                sharpe: 0,
                sequence: { type: 'NEUTRE', count: 0, depuis: null },
                patterns: {
                    meilleureDiscipline: null,
                    meilleureHeure: null,
                    meilleursJours: [],
                    hippodromesPerformants: []
                }
            };
        }

        // Analyse complète
        const analyse = analyserTendancesCompletes(historique, historique);

        return analyse;

    } catch (error) {
        logger.error(`Erreur calcul tendances: ${error.message}`);
        throw error;
    }
}

/**
 * Récupère la séquence actuelle (victoires/défaites consécutives)
 * @returns {Promise<Object>} Séquence actuelle
 */
export async function getSequenceActuelle() {
    if (!db) throw new Error('DB not initialized');

    try {
        const { detecterSequences } = await import('./tendances.mjs');
        const historique = await getHistoriqueParis(30); // 30 derniers jours

        if (!historique || historique.length === 0) {
            return { type: 'NEUTRE', count: 0, depuis: null };
        }

        return detecterSequences(historique);

    } catch (error) {
        logger.error(`Erreur séquence actuelle: ${error.message}`);
        return { type: 'NEUTRE', count: 0, depuis: null };
    }
}

/**
 * Récupère les performances détaillées par discipline
 * @param {number} days - Nombre de jours à analyser
 * @returns {Promise<Object>} Stats par discipline
 */
export async function getPerformanceParDiscipline(days = null) {
    if (!db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
        let dateFilter = '';
        if (days) {
            dateFilter = `AND c.date >= date('now', '-${days} days')`;
        }

        db.all(`
            WITH TopProne AS (
                SELECT 
                    p.course_id,
                    p.classement,
                    p.cote_ref,
                    c.discipline,
                    ROW_NUMBER() OVER(PARTITION BY p.course_id ORDER BY p.prediction_score DESC) as rank_ia
                FROM participants p
                JOIN courses c ON p.course_id = c.id
                WHERE p.prediction_score > 0 AND c.ordre_arrivee IS NOT NULL ${dateFilter}
            )
            SELECT 
                discipline,
                COUNT(*) as total_courses,
                SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN CAST(cote_ref AS FLOAT) ELSE 1 END) as total_returns,
                COUNT(*) as total_mises
            FROM TopProne
            WHERE rank_ia = 1
            GROUP BY discipline
            ORDER BY wins DESC
        `, (err, rows) => {
            if (err) {
                logger.error(`Erreur performance par discipline: ${err.message}`);
                reject(err);
                return;
            }

            const stats = {};
            rows.forEach(r => {
                const roi = r.total_courses > 0 ? ((r.total_returns / r.total_courses) - 1) * 100 : 0;
                stats[r.discipline] = {
                    total_courses: r.total_courses,
                    wins: r.wins,
                    win_rate: parseFloat(((r.wins / r.total_courses) * 100).toFixed(1)),
                    roi: parseFloat(roi.toFixed(1)),
                    profit: parseFloat((r.total_returns - r.total_courses).toFixed(2))
                };
            });

            resolve(stats);
        });
    });
}

export async function getDriverStats(driverName) {
    if (!db || !driverName) return null;
    return new Promise((resolve) => {
        // Analyse sur les 30 derniers jours (approx)
        db.get(`
            SELECT 
                COUNT(*) as total_courses,
                SUM(CASE WHEN classement = '1' THEN 1 ELSE 0 END) as victoires,
                SUM(CASE WHEN CAST(classement AS INTEGER) <= 3 THEN 1 ELSE 0 END) as places
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE (p.driver = ? OR p.jockey = ?)
            AND c.date >= date('now', '-30 days')
        `, [driverName, driverName], (err, row) => {
            if (err) {
                logger.error(`Erreur stats driver ${driverName}: ${err.message}`);
                resolve(null);
            } else {
                resolve(row);
            }
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
/**
 * Statistiques Avancées pour le Dashboard
 */
export async function getAdvancedStats() {
    if (!db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
        // 1. Top 3 Rate
        db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN p.classement <= 3 THEN 1 ELSE 0 END) as top3
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE p.classement = 1 
                AND c.ordre_arrivee IS NOT NULL 
                AND c.ordre_arrivee != ''
                AND p.prediction_score = (
                    SELECT MAX(p2.prediction_score) 
                    FROM participants p2 
                    WHERE p2.course_id = p.course_id
                )
        `, (err, top3Data) => {
            if (err) return reject(err);

            const top3_rate = top3Data.total > 0
                ? ((top3Data.top3 / top3Data.total) * 100).toFixed(1)
                : 0;

            // 2. Précision par Discipline
            db.all(`
                SELECT 
                    c.discipline,
                    COUNT(*) as total,
                    SUM(CASE 
                        WHEN p.classement = 1 THEN 1 
                        ELSE 0 
                    END) as wins
                FROM participants p
                JOIN courses c ON p.course_id = c.id
                WHERE c.ordre_arrivee IS NOT NULL 
                    AND c.ordre_arrivee != ''
                    AND p.prediction_score = (
                        SELECT MAX(p2.prediction_score) 
                        FROM participants p2 
                        WHERE p2.course_id = p.course_id
                    )
                GROUP BY c.discipline
            `, (err2, disciplineData) => {
                if (err2) return reject(err2);

                const by_discipline = {};
                disciplineData.forEach(d => {
                    by_discipline[d.discipline] = {
                        total: d.total,
                        wins: d.wins,
                        win_rate: d.total > 0 ? ((d.wins / d.total) * 100).toFixed(1) : 0
                    };
                });

                // 3. Confiance Moyenne
                db.get(`
                    SELECT AVG(p.prediction_score) as avg_confidence
                    FROM participants p
                    JOIN courses c ON p.course_id = c.id
                    WHERE p.classement = 1
                        AND c.ordre_arrivee IS NOT NULL
                        AND p.prediction_score = (
                            SELECT MAX(p2.prediction_score) 
                            FROM participants p2 
                            WHERE p2.course_id = p.course_id
                        )
                `, (err3, confData) => {
                    if (err3) return reject(err3);

                    // 4. Meilleur Rapport
                    db.get(`
                        SELECT 
                            p.nom,
                            p.cote_ref,
                            c.date,
                            c.hippodrome,
                            (p.cote_ref - 1) as gain_potentiel
                        FROM participants p
                        JOIN courses c ON p.course_id = c.id
                        WHERE p.classement = 1
                            AND c.ordre_arrivee IS NOT NULL
                            AND p.prediction_score = (
                                SELECT MAX(p2.prediction_score) 
                                FROM participants p2 
                                WHERE p2.course_id = p.course_id
                            )
                        ORDER BY p.cote_ref DESC
                        LIMIT 1
                    `, (err4, bestData) => {
                        if (err4) return reject(err4);

                        // 5. Insights
                        db.get(`
                            SELECT 
                                c.hippodrome,
                                COUNT(*) as total,
                                SUM(CASE WHEN p.classement = 1 THEN 1 ELSE 0 END) as wins
                            FROM participants p
                            JOIN courses c ON p.course_id = c.id
                            WHERE c.ordre_arrivee IS NOT NULL
                                AND p.prediction_score = (
                                    SELECT MAX(p2.prediction_score) 
                                    FROM participants p2 
                                    WHERE p2.course_id = p.course_id
                                )
                            GROUP BY c.hippodrome
                            HAVING total >= 10
                            ORDER BY (CAST(wins AS FLOAT) / total) DESC
                            LIMIT 1
                        `, (err5, hippoData) => {
                            if (err5) return reject(err5);

                            db.get(`
                                SELECT 
                                    p.driver,
                                    COUNT(*) as total,
                                    SUM(CASE WHEN p.classement = 1 THEN 1 ELSE 0 END) as wins
                                FROM participants p
                                JOIN courses c ON p.course_id = c.id
                                WHERE c.ordre_arrivee IS NOT NULL
                                    AND p.driver IS NOT NULL
                                    AND p.driver != ''
                                    AND p.prediction_score = (
                                        SELECT MAX(p2.prediction_score) 
                                        FROM participants p2 
                                        WHERE p2.course_id = p.course_id
                                    )
                                GROUP BY p.driver
                                HAVING total >= 5
                                ORDER BY (CAST(wins AS FLOAT) / total) DESC
                                LIMIT 1
                            `, (err6, driverData) => {
                                if (err6) return reject(err6);

                                resolve({
                                    top3_rate: parseFloat(top3_rate),
                                    by_discipline,
                                    avg_confidence: confData?.avg_confidence ? parseFloat(confData.avg_confidence.toFixed(1)) : 0,
                                    best_rapport: bestData || null,
                                    insights: {
                                        best_hippodrome: hippoData ? {
                                            name: hippoData.hippodrome,
                                            win_rate: ((hippoData.wins / hippoData.total) * 100).toFixed(1),
                                            total: hippoData.total
                                        } : null,
                                        best_driver: driverData ? {
                                            name: driverData.driver,
                                            win_rate: ((driverData.wins / driverData.total) * 100).toFixed(1),
                                            total: driverData.total
                                        } : null
                                    }
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}
/**
 * Statistiques Palmarès (Jockeys, Chevaux, Entraîneurs, Propriétaires)
 */
export async function getPalmaresStats() {
    if (!db) throw new Error('DB not initialized');

    const getRanking = (column, limit = 50) => {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    ${column} as name,
                    COUNT(*) as courses,
                    SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as victoires,
                    SUM(CASE WHEN CAST(classement AS INTEGER) <= 3 THEN 1 ELSE 0 END) as places
                FROM participants p
                JOIN courses c ON p.course_id = c.id
                WHERE ${column} IS NOT NULL AND ${column} != '' 
                  AND c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
                  AND p.classement IS NOT NULL
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

/**
 * Détection des chevaux en "Retard de Gain"
 * Critères : 
 * 1. Ratio Gains/Courses > Moyenne de la course * 1.3 (+30% de qualité intrinsèque)
 * 2. Moins de courses courues que la moyenne (Cheval préservé)
 * 3. Absents depuis moins de 60 jours (Condition physique)
 */
export async function getChevauxEnRetardDeGain(days = 2) {
    if (!db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
        // On récupère d'abord les courses à venir
        const dateFilter = `WHERE c.date >= date('now') AND c.date <= date('now', '+${days} days')`;

        db.all(`SELECT id, date, reunionNum, courseNum, hippodrome, discipline, prix FROM courses c ${dateFilter}`, async (err, courses) => {
            if (err) return reject(err);

            const opportunities = [];

            for (const course of courses) {
                // Pour chaque course, on récupère les partants
                const participants = await getCourseParticipants(course.id);

                if (!participants || participants.length < 5) continue;

                // Calcul des indicateurs moyens de la course (Cohort Stats)
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

                // Identification des cibles
                for (const p of validParticipants) {
                    const pRatio = p.gains / p.nb_courses;
                    // Critère 1: Qualité Supérieure (+30%)
                    const isQuality = pRatio > (avgRatio * 1.3);
                    // Critère 2: Préservé (Moins de courses que la moyenne)
                    const isPreserved = p.nb_courses < avgCourses;
                    // Critère 3: Forme (Musique récente, pas d'absence > 60j, simplifiée ici par la musique 0p...)
                    // On peut checker si la musique commence par une perf récente (non implémenté ici en SQL pur, on suppose OK)

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

            // Tri par potentiel (Différence de qualité)
            opportunities.sort((a, b) => b.diff_percent - a.diff_percent);
            resolve(opportunities);
        });
    });
}

/**
 * Récupère la course identifiée comme le Quinté+ du jour
 * Critères: Plus de 13 partants, Allocation la plus élevée, R1 souvent.
 */
export function getCourseQuinte() {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().split('T')[0];
        // On cherche la course avec le plus de partants et le plus gros prix aujourd'hui
        // La requête est un peu complexe : on doit joindre participants et courses
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
