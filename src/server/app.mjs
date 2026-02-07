import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, getAllCourses, getCourseParticipants, getIAPerformanceStats, closeDB } from '../core/db.mjs';
import logger from '../utils/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
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
            const matchDate = !targetDate || c.date === targetDate;
            const matchDisc = !discipline || c.discipline === discipline;
            const matchHippo = !hippodrome || c.hippodrome.toLowerCase().includes(hippodrome.toLowerCase());
            return matchDate && matchDisc && matchHippo;
        });

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
        res.json(participants);
    } catch (error) {
        logger.error(`API Error: ${error.message}`);
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

app.get('/api/stats', async (req, res) => {
    res.json({ message: "Stats endpoint pending" });
});

// Start Server
async function startServer() {
    try {
        await initDB();
        app.listen(PORT, () => {
            logger.header(`SERVEUR LANCÉ`);
            logger.info(`Dashboard accessible sur: http://localhost:${PORT}`);
        });
    } catch (e) {
        logger.error(`Erreur démarrage serveur: ${e.message}`);
    }
}

startServer();
