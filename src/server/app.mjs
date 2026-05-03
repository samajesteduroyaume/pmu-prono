import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.mjs';

// Import Database
import { initDB } from '../db/db.mjs';
import { loadMLModel } from '../core/hybrid.mjs';

// Import Routes
import courseRoutes from './routes/courses.mjs';
import alertRoutes from './routes/alerts.mjs';
import mlRoutes from './routes/ml.mjs';
import financeRoutes from './routes/finance.mjs';
import syncRoutes from './routes/sync.mjs';
import tuningRoutes from './routes/tuning.mjs';
import * as statController from './controllers/statController.mjs';
import * as mlController from './controllers/mlController.mjs';
import * as financeController from './controllers/financeController.mjs';
import * as winrateController from './controllers/winrateController.mjs';

// Middlewares
import { errorHandler } from './middleware/errorHandler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const app = express();
const PORT = process.env.PORT || 3000;

// V29: Cache des patterns optimisés (Shared legacy logic for now)
let cachedPatterns = { goldenPatterns: [], dangerPatterns: [], stats: {} };
let lastPatternUpdate = 0;

export async function getOrUpdatePatterns() {
    const now = Date.now();
    if (cachedPatterns && (now - lastPatternUpdate < 3600000)) {
        return cachedPatterns;
    }
    try {
        const { getHistoriqueParis } = await import('../core/db.mjs');
        const { analyseCompletePatterns } = await import('../core/pattern_optimizer.mjs');
        const historique = await getHistoriqueParis(30);
        cachedPatterns = await analyseCompletePatterns(historique);
        lastPatternUpdate = now;
        logger.info('[V29] Patterns optimisés mis à jour en cache');
        return cachedPatterns;
    } catch (e) {
        logger.error(`[V29] Erreur update patterns: ${e.message}`);
        return cachedPatterns || { goldenPatterns: [], dangerPatterns: [], stats: {} };
    }
}

// Branding Console
console.log("\x1b[32m%s\x1b[0m", "------------------------------------------------------------");
console.log("\x1b[32m%s\x1b[0m", "         ARCHITECT v27.1 - ELITE PUNTER SYSTEM             ");
console.log("\x1b[32m%s\x1b[0m", "------------------------------------------------------------");

// Global Middlewares
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});
app.use(express.static(path.join(PROJECT_ROOT, 'public')));

// API Routes Mapping
app.use('/api/courses', courseRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/ml', mlRoutes); // New unified ML route
app.use('/api/finance', financeRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/tuning', tuningRoutes);

// Legacy/Compatibility Routes (Mapped to new controllers)
app.get('/api/performance', statController.getPerformance);
app.get('/api/performance/advanced', statController.getAdvanced);
app.get('/api/performance/winrate', winrateController.getWinRateStats); // v44: Win Rate Reporting
app.get('/api/performance/shadow', financeController.getShadowPerformanceStats);
app.get('/api/palmares', statController.getPalmares);
app.get('/api/tendances', mlController.getTendances);
app.get('/api/patterns', mlController.getPatterns);
app.get('/api/sequence', mlController.getSequence);
app.get('/api/value-hunter', mlController.valueHunter);
app.get('/api/opportunities/retard-de-gain', async (req, res) => {
    const { getChevauxEnRetardDeGain } = await import('../core/db.mjs');
    const { days = 1 } = req.query;
    const targets = await getChevauxEnRetardDeGain(parseInt(days));
    res.json(targets);
});

// Root route for UI compatibility
app.get('/', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'public/index.html'));
});

// Error Handling
app.use(errorHandler);

// Start Server
async function startServer() {
    try {
        await initDB();
        await loadMLModel();
        app.listen(PORT, () => {
            logger.header(`SERVEUR MODULARISÉ LANCÉ (Port: ${PORT})`);
            logger.info(`Dashboard accessible sur: http://localhost:${PORT}`);
        });
    } catch (e) {
        logger.error(`Erreur démarrage serveur: ${e.message}`);
        process.exit(1);
    }
}

startServer();
