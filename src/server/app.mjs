import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, getAllCourses, getCourseParticipants, getIAPerformanceStats, insertCourses, closeDB } from '../core/db.mjs';
import { fetchDay } from '../core/fetcher.mjs';
import { processDayRaces } from '../core/processor.mjs';
import { calculerPredictionHybride, loadMLModel } from '../core/hybrid.mjs';
import { calculerMiseDynamique } from '../core/bankroll.mjs';
import logger from '../utils/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const app = express();
const PORT = 3000;

// Branding Console
console.log("\x1b[32m%s\x1b[0m", "------------------------------------------------------------");
console.log("\x1b[32m%s\x1b[0m", "             PMU PRONO - SYSTÈME D'ANALYSE V22              ");
console.log("\x1b[32m%s\x1b[0m", "------------------------------------------------------------");

// Middleware
app.use(cors());
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});
app.use(express.static(path.join(PROJECT_ROOT, 'public')));

// API Routes
app.get('/api/courses', async (req, res) => {
    try {
        const {
            date,
            discipline,
            page = 1,
            limit = 50,
            hippodrome
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        logger.info(`API: /api/courses - page=${page}, limit=${limit}, date=${date || 'all'}`);

        // Si aucun filtre, retourner les courses du jour par défaut
        const today = new Date().toISOString().split('T')[0];
        const targetDate = date || today;
        const courses = await getAllCourses();

        // Filtrage côté serveur
        let filtered = courses.filter(c => {
            const matchDate = !targetDate || targetDate === 'all' || c.date === targetDate;
            const matchDisc = !discipline || c.discipline === discipline;
            const matchHippo = !hippodrome || c.hippodrome.toLowerCase().includes(hippodrome.toLowerCase());
            return matchDate && matchDisc && matchHippo;
        });

        logger.info(`API: Courses found=${courses.length}, Filtered=${filtered.length} (Date: ${targetDate})`);

        // Pagination
        const total = filtered.length;
        const totalPages = Math.ceil(total / parseInt(limit));
        const paginated = filtered.slice(offset, offset + parseInt(limit));

        // Enrichissement
        const enriched = paginated.map(c => ({
            ...c,
            meteo: c.meteo ? JSON.parse(c.meteo) : null
        }));

        res.json({
            data: enriched,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages,
                hasNext: parseInt(page) < totalPages,
                hasPrev: parseInt(page) > 1
            }
        });
    } catch (error) {
        logger.error(`API Error: ${error.message}`);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/courses/:id/participants', async (req, res) => {
    try {
        const id = req.params.id;
        logger.info(`API: Requête participants pour course ${id}`);

        const participants = await getCourseParticipants(id);
        logger.info(`API: ${participants.length} participants trouvés pour la course ${id}`);

        const enriched = await Promise.all(participants.map(async (p, idx) => {
            const result = await calculerPredictionHybride(p, { discipline: p.discipline, prixCourse: p.prix_course });
            const kelly = calculerMiseDynamique(result.score, p.cote_ref || 2.0);

            if ((idx + 1) % 5 === 0) logger.info(`API [${id}]: Enrichissement progress ${idx + 1}/${participants.length}`);

            return {
                ...p,
                prediction_score: result.score,
                xai_details: result.xai,
                kelly_suggestion: kelly
            };
        }));

        logger.info(`API: Enrichissement envoyé pour course ${id}`);
        res.json(enriched);
    } catch (error) {
        logger.error(`API Error Participants: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/performance', async (req, res) => {
    try {
        logger.info('API: Requête /api/performance');
        const stats = await getIAPerformanceStats();
        res.json(stats);
    } catch (error) {
        logger.error(`API Error Performance: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/performance/advanced', async (req, res) => {
    try {
        logger.info('API: Requête /api/performance/advanced');
        const { getAdvancedStats } = await import('../core/db.mjs');
        const stats = await getAdvancedStats();
        res.json(stats);
    } catch (error) {
        logger.error(`API Error Advanced Stats: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/sync', express.json(), async (req, res) => {
    try {
        const { date, days = 1 } = req.body;
        const targetDate = date ? new Date(date) : new Date();
        const results = [];

        logger.info(`API: Lancement synchronisation pour ${days} jour(s) à partir de ${targetDate.toISOString().split('T')[0]}`);

        for (let i = 0; i < days; i++) {
            const current = new Date(targetDate);
            current.setDate(current.getDate() - i);
            const dateStr = current.toISOString().split('T')[0];

            logger.info(`API: Sync [${i + 1}/${days}] - ${dateStr}`);
            const data = await fetchDay(current);
            if (data && data.programme) {
                const processed = await processDayRaces(data, dateStr);
                const result = await insertCourses(processed);
                results.push({ date: dateStr, count: result });
            } else {
                results.push({ date: dateStr, count: 0, warning: 'Aucune donnée' });
            }
        }

        const totalInserted = results.reduce((sum, r) => sum + r.count, 0);
        logger.success(`API: Synchronisation terminée (${totalInserted} courses sur ${days} jours)`);
        res.json({ success: true, count: totalInserted, details: results });
    } catch (error) {
        logger.error(`API Sync Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/sync/live', async (req, res) => {
    try {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];

        logger.info(`LIVE SYNC: Rafraîchissement des cotes pour ${dateStr}`);

        const data = await fetchDay(today);
        if (!data || !data.programme) {
            return res.status(404).json({ error: 'Aucune donnée live disponible' });
        }

        const processed = await processDayRaces(data, dateStr);
        const count = await insertCourses(processed);

        res.json({ success: true, count, date: dateStr });
    } catch (error) {
        logger.error(`Live Sync Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/backtest', express.json(), async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        logger.info(`API: Lancement Backtest du ${startDate} au ${endDate}`);

        const { runBacktest } = await import('../ml/backtest.mjs');
        const results = await runBacktest(startDate, endDate);

        res.json(results);
    } catch (error) {
        logger.error(`API Backtest Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Start Server
async function startServer() {
    try {
        await initDB();
        await loadMLModel(); // Charger le modèle IA au démarrage
        app.listen(PORT, () => {
            logger.header(`SERVEUR LANCÉ`);
            logger.info(`Dashboard accessible sur: http://localhost:${PORT}`);
        });
    } catch (e) {
        logger.error(`Erreur démarrage serveur: ${e.message}`);
    }
}

startServer();
