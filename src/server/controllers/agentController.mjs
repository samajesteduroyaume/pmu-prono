import logger from '../../utils/logger.mjs';
import { syncLive, syncHistory } from '../../core/sync_manager.mjs';
import { getCourses, getCourseDetails, getQuintePrediction, getPepites } from '../controllers/courseController.mjs';
import { getPerformance } from '../controllers/statController.mjs';
import { getDB } from '../../db/db.mjs';

/**
 * Controller pour le contrôle à distance par IA (AI Agent Remote API)
 */

// Key secret d'API facultative (sécurité si définie dans .env)
const AGENT_API_KEY = process.env.AGENT_API_KEY || null;

function checkAuth(req) {
    if (!AGENT_API_KEY) return true;
    const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    return providedKey === AGENT_API_KEY;
}

/**
 * GET /api/agent/status - État complet du système pour l'IA
 */
export async function getAgentStatus(req, res) {
    if (!checkAuth(req)) {
        return res.status(401).json({ success: false, error: 'Clé API Agent non valide ou manquante.' });
    }

    try {
        const memory = process.memoryUsage();
        const db = getDB();

        const dbInfo = await new Promise((resolve) => {
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM courses) as total_courses,
                    (SELECT COUNT(*) FROM participants) as total_participants,
                    (SELECT MAX(date) FROM courses) as latest_course_date
            `, [], (err, row) => resolve(row || { total_courses: 0, total_participants: 0, latest_course_date: null }));
        });

        res.json({
            success: true,
            system: {
                name: "ARCHITECT PMU PRONO",
                version: "43.4 ELITE",
                uptime: process.uptime(),
                memory_mb: Math.round(memory.heapUsed / 1024 / 1024),
                timestamp: new Date().toISOString()
            },
            database: {
                connected: true,
                total_courses: dbInfo.total_courses,
                total_participants: dbInfo.total_participants,
                latest_date: dbInfo.latest_course_date
            },
            capabilities: [
                "SYNC_MARKET",
                "GET_QUINTE_PREDICTION",
                "GET_PEPITES_IA",
                "ANALYZE_COURSE",
                "GET_FINANCE_STATS",
                "QUERY_DATABASE",
                "GET_HORSE_HISTORY",
                "GET_ENTOURAGE_STATS"
            ]
        });
    } catch (e) {
        logger.error(`[Agent API] Status error: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
}

/**
 * POST /api/agent/command - Exécution de commandes par l'IA à distance
 */
export async function executeAgentCommand(req, res) {
    if (!checkAuth(req)) {
        return res.status(401).json({ success: false, error: 'Clé API Agent non valide ou manquante.' });
    }

    const { action, params = {} } = req.body;
    logger.info(`[Agent API] Commande IA reçue: ${action}`);

    try {
        switch (action) {
            case 'SYNC_MARKET': {
                const days = params.days || 1;
                const result = await syncHistory(days);
                return res.json({
                    success: true,
                    action: 'SYNC_MARKET',
                    message: `Synchronisation réussie pour ${days} jour(s).`,
                    data: result
                });
            }

            case 'GET_QUINTE': {
                const date = params.date || null;
                const reqMock = { query: { date } };
                let responseData = null;
                let statusCode = 200;
                const resMock = {
                    json: (data) => { responseData = data; },
                    status: (code) => { statusCode = code; return resMock; }
                };
                await getQuintePrediction(reqMock, resMock);
                return res.json({
                    success: statusCode === 200 && !responseData?.error,
                    action: 'GET_QUINTE',
                    data: responseData
                });
            }

            case 'GET_PEPITES': {
                let responseData = null;
                const resMock = {
                    json: (data) => { responseData = data; },
                    status: () => resMock
                };
                await getPepites({}, resMock);
                return res.json({
                    success: true,
                    action: 'GET_PEPITES',
                    data: responseData
                });
            }

            case 'ANALYZE_COURSE': {
                const courseId = params.courseId;
                if (!courseId) {
                    return res.status(400).json({ success: false, error: 'Paramètre courseId requis.' });
                }
                const reqMock = { params: { id: courseId } };
                let responseData = null;
                const resMock = {
                    json: (data) => { responseData = data; },
                    status: () => resMock
                };
                await getCourseDetails(reqMock, resMock);
                return res.json({
                    success: true,
                    action: 'ANALYZE_COURSE',
                    courseId,
                    data: responseData
                });
            }

            case 'QUERY_DATABASE': {
                const sql = params.sql;
                if (!sql || typeof sql !== 'string') {
                    return res.status(400).json({ success: false, error: 'Paramètre SQL texte requis.' });
                }
                // Sécurité lecture seule (SELECT uniquement)
                if (!sql.trim().toUpperCase().startsWith('SELECT')) {
                    return res.status(400).json({ success: false, error: 'Seules les requêtes SELECT sont autorisées.' });
                }
                const db = getDB();
                const rows = await new Promise((resolve, reject) => {
                    db.all(sql, (err, rows) => err ? reject(err) : resolve(rows));
                });
                return res.json({
                    success: true,
                    action: 'QUERY_DATABASE',
                    count: rows.length,
                    data: rows
                });
            }

            case 'GET_HORSE_HISTORY': {
                const horseName = params.horseName || params.nom;
                if (!horseName) {
                    return res.status(400).json({ success: false, error: 'Paramètre horseName requis.' });
                }
                const db = getDB();
                const rows = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT p.*, c.date, c.hippodrome, c.discipline, c.distance, c.statut as course_statut, c.ordre_arrivee
                        FROM participants p
                        JOIN courses c ON p.course_id = c.id
                        WHERE p.nom LIKE ?
                        ORDER BY c.date DESC
                        LIMIT 20
                    `, [`%${horseName}%`], (err, rows) => err ? reject(err) : resolve(rows));
                });
                return res.json({
                    success: true,
                    action: 'GET_HORSE_HISTORY',
                    horseName,
                    count: rows.length,
                    data: rows
                });
            }

            case 'GET_ENTOURAGE_STATS': {
                const name = params.name;
                const role = params.role || 'driver'; // 'driver' ou 'entraineur'
                if (!name) {
                    return res.status(400).json({ success: false, error: 'Paramètre name requis.' });
                }
                const col = role === 'entraineur' ? 'entraineur' : 'driver';
                const db = getDB();
                const row = await new Promise((resolve, reject) => {
                    db.get(`
                        SELECT 
                            ${col} as name,
                            COUNT(*) as total_courses,
                            SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as victoires,
                            SUM(CASE WHEN CAST(classement AS INTEGER) BETWEEN 1 AND 3 THEN 1 ELSE 0 END) as podiums
                        FROM participants
                        WHERE ${col} LIKE ? AND classement IS NOT NULL
                    `, [`%${name}%`], (err, row) => err ? reject(err) : resolve(row));
                });
                const total = row?.total_courses || 0;
                const victoires = row?.victoires || 0;
                const podiums = row?.podiums || 0;
                return res.json({
                    success: true,
                    action: 'GET_ENTOURAGE_STATS',
                    role,
                    data: {
                        name: row?.name || name,
                        total_courses: total,
                        victoires,
                        podiums,
                        taux_victoire: total > 0 ? parseFloat(((victoires / total) * 100).toFixed(1)) : 0,
                        taux_podium: total > 0 ? parseFloat(((podiums / total) * 100).toFixed(1)) : 0
                    }
                });
            }

            case 'GET_FINANCE_STATS': {
                const db = getDB();
                const portfolio = await new Promise((resolve, reject) => {
                    db.all(`SELECT * FROM portfolio`, (err, rows) => err ? reject(err) : resolve(rows));
                });
                const shadowStats = await new Promise((resolve, reject) => {
                    db.get(`
                        SELECT 
                            COUNT(*) as total_bets,
                            SUM(CASE WHEN resultat = 'WIN' THEN 1 ELSE 0 END) as wins,
                            SUM(mise) as total_mise,
                            SUM(gain) as total_gain
                        FROM shadow_bets
                    `, (err, row) => err ? reject(err) : resolve(row));
                });
                return res.json({
                    success: true,
                    action: 'GET_FINANCE_STATS',
                    data: {
                        portfolio,
                        shadow: {
                            total_bets: shadowStats?.total_bets || 0,
                            wins: shadowStats?.wins || 0,
                            win_rate: shadowStats?.total_bets ? parseFloat(((shadowStats.wins / shadowStats.total_bets) * 100).toFixed(1)) : 0,
                            total_mise: shadowStats?.total_mise || 0,
                            total_gain: shadowStats?.total_gain || 0,
                            profit: (shadowStats?.total_gain || 0) - (shadowStats?.total_mise || 0)
                        }
                    }
                });
            }

            default:
                return res.status(400).json({
                    success: false,
                    error: `Action '${action}' non reconnue. Actions valides: SYNC_MARKET, GET_QUINTE, GET_PEPITES, ANALYZE_COURSE, QUERY_DATABASE, GET_HORSE_HISTORY, GET_ENTOURAGE_STATS, GET_FINANCE_STATS.`
                });
        }
    } catch (e) {
        logger.error(`[Agent API] Command Error (${action}): ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
}

/**
 * GET /api/agent/schema - Spécification des fonctions pour LLM / OpenAI Function Calling
 */
export async function getAgentSchema(req, res) {
    res.json({
        name: "pmu_architect_agent",
        description: "API de contrôle à distance et d'accès complet à la base de données de l'IA ARCHITECT PMU-Prono",
        tools: [
            {
                name: "sync_market",
                description: "Synchronise les cotes, partants et résultats hippiques PMU en direct",
                parameters: {
                    type: "object",
                    properties: {
                        days: { type: "number", description: "Nombre de jours à synchroniser (1 à 180 jours / 6 mois)" }
                    }
                }
            },
            {
                name: "get_quinte_prediction",
                description: "Obtient la sélection de 8 chevaux et le tocard de l'IA pour la course événement Quinté+",
                parameters: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "Date au format YYYY-MM-DD" }
                    }
                }
            },
            {
                name: "get_pepites",
                description: "Récupère les meilleures pépites à forte valeur (Score IA >= 60%, Edge > 5%)",
                parameters: { type: "object", properties: {} }
            },
            {
                name: "analyze_course",
                description: "Analyse complète détaillée des partants d'une course spécifique avec explications XAI",
                parameters: {
                    type: "object",
                    properties: {
                        courseId: { type: "number", description: "ID numérique de la course" }
                    },
                    required: ["courseId"]
                }
            },
            {
                name: "get_horse_history",
                description: "Recherche l'historique de performances et de résultats d'un cheval dans la base de données",
                parameters: {
                    type: "object",
                    properties: {
                        horseName: { type: "string", description: "Nom complet ou partiel du cheval" }
                    },
                    required: ["horseName"]
                }
            },
            {
                name: "get_entourage_stats",
                description: "Obtient les statistiques de victoires et de podiums d'un driver, jockey ou entraîneur",
                parameters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Nom de la personne" },
                        role: { type: "string", description: "'driver' ou 'entraineur'" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "get_finance_stats",
                description: "Consulte les statistiques financières, le ROI, les paris shadow et l'état du portfolio",
                parameters: { type: "object", properties: {} }
            },
            {
                name: "query_database",
                description: "Exécute une requête SQL SELECT directe sur la base de données SQLite pour toute recherche spécifique",
                parameters: {
                    type: "object",
                    properties: {
                        sql: { type: "string", description: "Requête SQL SELECT" }
                    },
                    required: ["sql"]
                }
            }
        ]
    });
}
