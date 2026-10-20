import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import { networkInterfaces } from 'node:os';
import logger from '../utils/logger.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';
import { parseDays } from '../utils/requestParams.mjs';

// Import Database
import { initDB, closeDB } from '../db/db.mjs';
import { loadMLModel, enableModelHotReload, disableModelHotReload } from '../core/hybrid.mjs';
import { syncLive, waitForSyncIdle } from '../core/sync_manager.mjs';

// Import Routes
import courseRoutes from './routes/courses.mjs';
import alertRoutes from './routes/alerts.mjs';
import mlRoutes from './routes/ml.mjs';
import financeRoutes from './routes/finance.mjs';
import syncRoutes from './routes/sync.mjs';
import tuningRoutes from './routes/tuning.mjs';
import agentRoutes from './routes/agent.mjs';
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
const allowedOrigins = new Set(
    String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
);
const isAllowedOrigin = (origin, callback) => {
    // Requests without an Origin header are server-to-server or same-origin non-browser clients.
    callback(null, !origin || allowedOrigins.has(origin));
};

let shuttingDown = false;
let shutdownPromise = null;
let trainingChild = null;
const scheduledTimers = new Set();
const backgroundTasks = new Set();

function trackBackgroundTask(task) {
    const promise = Promise.resolve().then(task);
    backgroundTasks.add(promise);
    promise.catch(error => logger.error(`[BACKGROUND] Erreur: ${error.message}`))
        .finally(() => backgroundTasks.delete(promise));
    return promise;
}

function scheduleTimeout(callback, delay) {
    if (shuttingDown) return null;
    const timer = setTimeout(() => {
        scheduledTimers.delete(timer);
        trackBackgroundTask(callback);
    }, delay);
    scheduledTimers.add(timer);
    return timer;
}

function scheduleInterval(callback, delay) {
    if (shuttingDown) return null;
    let isRunning = false;
    const timer = setInterval(() => {
        if (isRunning || shuttingDown) return;
        isRunning = true;
        trackBackgroundTask(async () => {
            try {
                await callback();
            } finally {
                isRunning = false;
            }
        });
    }, delay);
    scheduledTimers.add(timer);
    return timer;
}

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
console.log("\x1b[32m%s\x1b[0m", "         ARCHITECT v43.3 - ELITE PUNTER SYSTEM             ");
console.log("\x1b[32m%s\x1b[0m", "------------------------------------------------------------");

// Global Middlewares
app.use(cors({ origin: isAllowedOrigin }));
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
app.use('/api/agent', agentRoutes);

// Legacy/Compatibility Routes (Mapped to new controllers)
app.get('/api/performance', statController.getPerformance);
app.get('/api/performance/advanced', statController.getAdvanced);
app.get('/api/performance/winrate', winrateController.getWinRateStats); // v44: Win Rate Reporting
app.get('/api/performance/forecast', mlController.forecastEvaluation);
app.get('/api/performance/shadow', financeController.getShadowPerformanceStats);
app.get('/api/palmares', statController.getPalmares);
app.get('/api/ecuries/compare', statController.getEcuries);
app.get('/api/tendances', mlController.getTendances);
app.get('/api/patterns', mlController.getPatterns);
app.get('/api/sequence', mlController.getSequence);
app.get('/api/value-hunter', mlController.valueHunter);
app.post('/api/backtest/compare', mlController.backtestCompare);
app.post('/api/backtest', mlController.backtest);
app.get('/api/opportunities/retard-de-gain', async (req, res) => {
    const { getChevauxEnRetardDeGain } = await import('../core/db.mjs');
    const days = parseDays(req.query.days, 1);
    if (days === undefined) return res.status(400).json({ error: 'Le paramètre days doit être un entier entre 1 et 3650.' });
    const targets = await getChevauxEnRetardDeGain(days);
    res.json(targets);
});

// Root route for UI compatibility
app.get('/', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'public/index.html'));
});

// Error Handling
app.use(errorHandler);

import { createServer } from 'http';
import { Server } from 'socket.io';

const server = createServer(app);
const io = new Server(server, {
    cors: { origin: isAllowedOrigin },
    // Browsers enforce CORS for polling but not WebSocket upgrades, so check Origin here too.
    allowRequest: (req, callback) => isAllowedOrigin(req.headers.origin, callback)
});
app.set('io', io);

export function stopServer() {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    shutdownPromise = (async () => {
        for (const timer of scheduledTimers) {
            clearTimeout(timer);
            clearInterval(timer);
        }
        scheduledTimers.clear();
        disableModelHotReload();
        if (trainingChild && trainingChild.exitCode === null) trainingChild.kill('SIGTERM');
        await new Promise(resolve => io.close(() => resolve()));
        await Promise.allSettled([...backgroundTasks]);
        await waitForSyncIdle();
        await closeDB();
    })();
    return shutdownPromise;
}

// Start Server
async function startServer() {
    try {
        await initDB();
        await loadMLModel();
        const { refreshProspectiveCalibration } = await import('../core/kelly.mjs');
        await refreshProspectiveCalibration((await import('../core/hybrid.mjs')).getMLMetadata()?.version || 'heuristic-fallback');
        enableModelHotReload();

        // V46: Background Auto-Sync (Every 5 minutes)
        // Fetches new races and updates arrivals/results automatically
        scheduleInterval(async () => {
            try {
                logger.info('[V46] Auto-Sync: Déclenchement de la synchronisation live...');
                const results = await syncLive();
                if (results.totalCourses > 0) {
                    logger.success(`[V46] Auto-Sync: ${results.totalCourses} courses mises à jour.`);
                    io.emit('sync_update', { count: results.totalCourses, timestamp: new Date() });
                }
                if (results.errors.length > 0) {
                    logger.warn(`[V46] Auto-Sync: ${results.errors.length} journée(s) en erreur.`);
                }
            } catch (e) {
                logger.error(`[V46] Auto-Sync Error: ${e.message}`);
            }
        }, 300000); // 300,000ms = 5 minutes

        // Synchronisation immédiate au démarrage pour charger la journée en cours si le serveur était éteint
        logger.info('[STARTUP] Exécution de la synchronisation initiale au démarrage...');
        trackBackgroundTask(async () => {
            const results = await syncLive();
            const logSync = results.errors.length === 0 ? logger.success.bind(logger) : logger.warn.bind(logger);
            logSync(`[STARTUP] Sync initiale: ${results.totalCourses} courses, ${results.errors.length} erreur(s).`);
            if (results.totalCourses > 0) {
                io.emit('sync_update', { count: results.totalCourses, timestamp: new Date() });
            }
        });

        // Programmation du téléchargement automatique du nouveau programme PMU chaque matin à 06h30
        const scheduleMorningSync = () => {
            const now = new Date();
            const nextMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 30, 0);
            if (now >= nextMorning) {
                nextMorning.setDate(nextMorning.getDate() + 1);
            }
            const msUntilMorning = nextMorning.getTime() - now.getTime();

            logger.info(`[CRON MATIN] Prochaine synchronisation du matin programmée à 06h30 (dans ${(msUntilMorning / 3600000).toFixed(2)}h).`);

            scheduleTimeout(async () => {
                try {
                    logger.header('[CRON MATIN] 06H30 - Démarrage du téléchargement du nouveau programme PMU...');
                    let results = await syncLive(true);

                    // Mécanisme de Retry si 0 course (API PMU temporairement en retard)
                    if (results.totalCourses === 0) {
                        logger.warn('[CRON MATIN] 0 course récupérée à 06h30. Réessai programmé dans 15 minutes...');
                        scheduleTimeout(async () => {
                            try {
                                logger.info('[CRON MATIN RETRY] Tentative de re-synchronisation à 06h45...');
                                results = await syncLive(true);
                                const logSync = results.errors.length === 0 ? logger.success.bind(logger) : logger.warn.bind(logger);
                                logSync(`[CRON MATIN RETRY] ${results.totalCourses} courses, ${results.errors.length} erreur(s).`);
                                io.emit('sync_update', { count: results.totalCourses, timestamp: new Date() });
                            } catch (err) {
                                logger.error(`[CRON MATIN RETRY Error] Échec de la synchronisation: ${err.message}`);
                            }
                        }, 15 * 60 * 1000);
                    } else {
                        const logSync = results.errors.length === 0 ? logger.success.bind(logger) : logger.warn.bind(logger);
                        logSync(`[CRON MATIN] Synchronisation matinale : ${results.totalCourses} courses, ${results.errors.length} erreur(s).`);
                        io.emit('sync_update', { count: results.totalCourses, timestamp: new Date() });
                    }
                } catch (err) {
                    logger.error(`[CRON MATIN Error] Échec de la synchronisation matinale: ${err.message}`);
                }
                scheduleMorningSync();
            }, msUntilMorning);
        };
        scheduleMorningSync();

        // Exécution de l'entraînement IA dans un processus fils totalement isolé (Fork)
        // afin de garantir une immunité totale de la RAM du serveur web HTTP
        const runRetrainInChildProcess = () => {
            return new Promise((resolve, reject) => {
                const cronScript = path.join(PROJECT_ROOT, 'src/pipelines/retrain_cron.mjs');
                logger.info(`[CRON WORKER] Démarrage du réentraînement IA isolé (${cronScript})...`);

                const child = fork(cronScript, [], {
                    cwd: PROJECT_ROOT,
                    env: { ...process.env },
                    execArgv: ['--max-old-space-size=1536']
                });
                trainingChild = child;

                child.on('exit', (code) => {
                    if (trainingChild === child) trainingChild = null;
                    if (code === 0) {
                        logger.success('[CRON WORKER] Processus d\'entraînement IA exécuté et terminé avec succès !');
                        resolve();
                    } else {
                        logger.error(`[CRON WORKER] Le processus d'entraînement a quitté avec le code: ${code}`);
                        reject(new Error(`Worker exited with code ${code}`));
                    }
                });

                child.on('error', (err) => {
                    if (trainingChild === child) trainingChild = null;
                    logger.error(`[CRON WORKER Error] Échec du processus fils d'entraînement: ${err.message}`);
                    reject(err);
                });
            });
        };

        // Réentraînement hebdomadaire recommandé pour laisser la calibration
        // accumuler assez de courses réglées avec la même génération de poids.
        const scheduleWeeklyRetrain = () => {
            const now = new Date();
            const nextRetrain = new Date(now);
            const daysUntilSunday = (7 - now.getDay()) % 7;
            nextRetrain.setDate(now.getDate() + daysUntilSunday);
            nextRetrain.setHours(23, 30, 0, 0);
            if (nextRetrain <= now) nextRetrain.setDate(nextRetrain.getDate() + 7);
            const msUntilRetrain = nextRetrain.getTime() - now.getTime();

            logger.info(`[CRON] Prochain réentraînement IA programmé dimanche à 23h30 (dans ${(msUntilRetrain / 3600000).toFixed(2)}h).`);

            scheduleTimeout(async () => {
                try {
                    logger.header('[CRON] DIMANCHE 23H30 - Synchronisation finale puis réentraînement isolé du modèle IA...');
                    try {
                        logger.info('[CRON] Récupération des arrivées et résultats définitifs de la journée...');
                        await syncLive();
                    } catch (sErr) {
                        logger.warn(`[CRON] Pré-sync nocturne échouée, entraînement maintenu: ${sErr.message}`);
                    }

                    // Exécution isolée dans un worker fils
                    await runRetrainInChildProcess();

                    // Rechargement immédiat à chaud du modèle dans la mémoire du serveur web principal
                    logger.info('[CRON] Rechargement du nouveau modèle IA dans le serveur web actif...');
                    const reloaded = await loadMLModel();
                    if (reloaded) {
                        logger.success('[CRON] Nouveau modèle IA rechargé à chaud en mémoire !');
                        io.emit('ml_model_reloaded', { timestamp: new Date() });
                    }
                } catch (err) {
                    logger.error(`[CRON Error] Échec du réentraînement nocturne : ${err.message}`);
                }
                scheduleWeeklyRetrain();
            }, msUntilRetrain);
        };
        scheduleWeeklyRetrain();

        io.on('connection', (socket) => {
            logger.info(`[Socket] Nouveau client connecté: ${socket.id}`);
            socket.on('disconnect', () => {
                logger.info(`[Socket] Client déconnecté: ${socket.id}`);
            });
        });

        server.listen(PORT, '0.0.0.0', () => {
            const shutdownOnSignal = signal => {
                logger.info(`[SHUTDOWN] Signal ${signal} reçu, arrêt propre du serveur...`);
                stopServer().then(() => {
                    logger.info('[SHUTDOWN] Serveur, tâches planifiées et base fermés.');
                }).catch(error => {
                    logger.error(`[SHUTDOWN] Arrêt incomplet : ${error.message}`);
                    process.exitCode = 1;
                });
            };
            process.once('SIGINT', () => shutdownOnSignal('SIGINT'));
            process.once('SIGTERM', () => shutdownOnSignal('SIGTERM'));
            logger.header(`SERVEUR MODULARISÉ LANCÉ (Port: ${PORT})`);
            logger.info(`Dashboard local: http://localhost:${PORT}`);
            const networkAddress = Object.values(networkInterfaces()).flat()
                .find(address => !address.internal && (address.family === 'IPv4' || address.family === 4))?.address;
            logger.info(networkAddress
                ? `Dashboard réseau: http://${networkAddress}:${PORT}`
                : 'Dashboard réseau: adresse IPv4 locale introuvable.');
            logger.info(`[Socket.io] Serveur WebSocket prêt`);
        });
    } catch (e) {
        logger.error(`Erreur démarrage serveur: ${e.message}`);
        process.exit(1);
    }
}

if (isMainModule(import.meta.url)) {
    startServer();
}

export { app, server, startServer };
