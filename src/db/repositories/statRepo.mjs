import { getDB } from '../db.mjs';
import { getHistoriqueParis } from './pariRepo.mjs';
import { analyserTendancesCompletes } from '../../core/tendances.mjs';
import logger from '../../utils/logger.mjs';

export async function getTendancesCumulees(days = null) {
    try {
        const historique = await getHistoriqueParis(days);
        if (!historique || historique.length === 0) {
            return {
                tendance: { tendance: 'NEUTRE', pente: 0 },
                momentum: 50,
                drawdown: { current: 0, max: 0, currentPercent: 0, maxPercent: 0 },
                variance: { variance: 0, ecartType: 0 },
                sharpe: 0,
                sequence: { type: 'NEUTRE', count: 0, depuis: null },
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
                WHERE p.prediction_score >= 80 AND c.ordre_arrivee IS NOT NULL ${dateFilter}
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
                    gain: profit,
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
                    roi_type: 'theoretical_flat_bet',
                    total_profit: parseFloat(cumulativeProfit.toFixed(2))
                },
                history: history
            });
        });
    });
}

export async function getAdvancedStats() {
    const db = getDB();
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

export async function getPalmaresStats() {
    const db = getDB();
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

export async function getPerformanceParDiscipline(days = null) {
    const db = getDB();
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
                WHERE p.prediction_score >= 80 AND c.ordre_arrivee IS NOT NULL ${dateFilter}
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
    const db = getDB();
    if (!driverName) return null;
    return new Promise((resolve) => {
        db.get(`
            SELECT 
                COUNT(*) as total_courses,
                SUM(CASE WHEN classement = '1' THEN 1 ELSE 0 END) as victoires,
                SUM(CASE WHEN CAST(classement AS INTEGER) <= 3 THEN 1 ELSE 0 END) as places
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE p.driver = ?
            AND c.date >= date('now', '-30 days')
        `, [driverName], (err, row) => {
            if (err) {
                logger.error(`Erreur stats driver ${driverName}: ${err.message}`);
                resolve(null);
            } else {
                resolve(row);
            }
        });
    });
}

export async function getSynergyScore(driverName, trainerName) {
    const db = getDB();
    if (!driverName || !trainerName) return 50;

    return new Promise((resolve) => {
        const query = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN classement = '1' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN CAST(classement AS INTEGER) <= 3 THEN 1 ELSE 0 END) as places
            FROM participants
            WHERE driver = ? AND entraineur = ?
            AND classement IS NOT NULL
        `;
        db.get(query, [driverName, trainerName], (err, row) => {
            if (err || !row || row.total < 3) {
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

export async function getOptimizationSample(discipline, limit = 500) {
    const db = getDB();
    return new Promise((resolve) => {
        const query = `
            SELECT 
                p.*, 
                c.prix as prix_course, 
                c.discipline,
                c.hippodrome
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE c.discipline = ? 
              AND c.ordre_arrivee IS NOT NULL 
              AND c.ordre_arrivee != ''
            ORDER BY c.date DESC
            LIMIT ?
        `;
        db.all(query, [discipline, limit], (err, rows) => {
            resolve(rows || []);
        });
    });
}
