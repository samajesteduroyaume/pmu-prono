import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, getAllCourses, getCourseParticipants, getIAPerformanceStats, insertCourses, closeDB, getPalmaresStats } from '../core/db.mjs';
import { analyserEtGenererAlertes, getActiveAlerts, getAlertHistory, dismissAlert, dismissAllAlerts, getAlertStats, markAlertAsRead } from '../core/alerts.mjs';
import { fetchDay } from '../core/fetcher.mjs';
import { processDayRaces } from '../core/processor.mjs';
import { calculerPredictionHybride, loadMLModel } from '../core/hybrid.mjs';
import { calculateKellyAdaptatif } from '../core/kelly.mjs';
import logger from '../utils/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const app = express();
const PORT = 3000;

// V29: Cache des patterns optimisés
let cachedPatterns = null;
let lastPatternUpdate = 0;

async function getOrUpdatePatterns() {
    const now = Date.now();
    if (cachedPatterns && (now - lastPatternUpdate < 3600000)) { // 1h cache
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

        // CALCUL DU CONTEXTE "RETARD DE GAIN" (MOYENNES COURSE)
        let totalRatio = 0;
        let totalCourses = 0;
        let countContext = 0;
        const validP = participants.filter(p => p.nb_courses > 0 && p.gains > 0);

        if (validP.length >= 5) {
            for (const p of validP) {
                totalRatio += (p.gains / p.nb_courses);
                totalCourses += p.nb_courses;
                countContext++;
            }
        }

        const contextAvgRatio = countContext > 0 ? (totalRatio / countContext) : 0;
        const contextAvgCourses = countContext > 0 ? (totalCourses / countContext) : 0;

        // V29: Récupérer les patterns et tendances pour le Kelly Adaptatif
        const patternData = await getOrUpdatePatterns();
        const { getTendancesCumulees } = await import('../core/db.mjs');
        const tendances = await getTendancesCumulees(30);

        const enriched = await Promise.all(participants.map(async (p, idx) => {
            const { matchPattern, getPlageHoraire } = await import('../core/pattern_optimizer.mjs');
            const context = {
                discipline: p.discipline,
                prixCourse: p.prix_course,
                hippodrome: p.hippodrome,
                jour: new Date().toLocaleDateString('fr-FR', { weekday: 'long' }),
                plageHoraire: getPlageHoraire(new Date().getHours()),
                avgRatioGains: contextAvgRatio,
                avgCourses: contextAvgCourses
            };

            // Identifier les patterns qui matchent le contexte actuel
            const activePatterns = [];

            patternData.goldenPatterns.forEach(gp => {
                if (matchPattern(gp.pattern, context)) activePatterns.push({ ...gp, type: 'GOLDEN_PATTERN' });
            });
            patternData.dangerPatterns.forEach(dp => {
                if (matchPattern(dp.pattern, context)) activePatterns.push({ ...dp, type: 'DANGER_PATTERN' });
            });

            const result = await calculerPredictionHybride(p, context, activePatterns);
            const kelly = await calculateKellyAdaptatif(p.cote_ref || 2.0, result.score, 1000, tendances, activePatterns);

            if ((idx + 1) % 5 === 0) logger.info(`API [${id}]: Enrichissement progress ${idx + 1}/${participants.length}`);

            return {
                ...p,
                prediction_score: result.score,
                is_retard_gain: result.xai?.retard_gain || false,
                xai_details: { ...result.xai, activePatterns },
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
        const { days } = req.query;
        logger.info(`API: Requête /api/performance (Filtre: ${days || 'TOUT'})`);
        const stats = await getIAPerformanceStats(days ? parseInt(days) : null);
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

app.get('/api/opportunities/retard-de-gain', async (req, res) => {
    try {
        const { days = 1 } = req.query;
        logger.info(`API: Requête Opportunités Retard de Gain (Days: ${days})`);
        const { getChevauxEnRetardDeGain } = await import('../core/db.mjs');
        const targets = await getChevauxEnRetardDeGain(parseInt(days));
        res.json(targets);
    } catch (error) {
        logger.error(`API Error Retard Gain: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// V27: PRONOSTIC QUINTÉ+ SPECIAL
app.get('/api/quinte/prediction', async (req, res) => {
    try {
        const { getCourseQuinte, getCourseParticipants } = await import('../core/db.mjs');
        const course = await getCourseQuinte();

        if (!course) {
            return res.status(404).json({ message: "Pas de Quinté+ identifié pour aujourd'hui." });
        }

        const participants = await getCourseParticipants(course.id);

        // Calcul des scores optimisé Quinté
        const { calculerPredictionHybride } = await import('../core/hybrid.mjs');

        const predictions = await Promise.all(participants.map(async p => {
            const context = {
                discipline: course.discipline,
                prixCourse: course.prix,
                isQuinte: true
            };
            const result = await calculerPredictionHybride(p, context);
            return { ...p, score: result.score, xai: result.xai };
        }));

        predictions.sort((a, b) => b.score - a.score);

        const selection = predictions.slice(0, 5);
        const tocards = predictions.slice(5).filter(p => p.score > 40 && p.cote_ref > 15).slice(0, 1);

        res.json({
            course: course,
            selection: selection,
            tocard: tocards[0] || null
        });

    } catch (error) {
        logger.error(`API Error Quinté: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/palmares', async (req, res) => {
    try {
        logger.info('API: Requête /api/palmares');
        const stats = await getPalmaresStats();
        res.json(stats);
    } catch (error) {
        logger.error(`API Error Palmarès: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// V28: TENDANCES CUMULÉES AVANCÉES
app.get('/api/tendances', async (req, res) => {
    try {
        const { days } = req.query;
        const daysFilter = days ? parseInt(days) : null;

        logger.info(`API: Requête /api/tendances (Filtre: ${daysFilter || 'TOUT'})`);

        const { getTendancesCumulees } = await import('../core/db.mjs');
        const tendances = await getTendancesCumulees(daysFilter);

        res.json(tendances);
    } catch (error) {
        logger.error(`API Error Tendances: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// V28: PATTERNS DE PERFORMANCE
app.get('/api/patterns', async (req, res) => {
    try {
        const { days } = req.query;
        const daysFilter = days ? parseInt(days) : 30; // Par défaut 30 jours

        logger.info(`API: Requête /api/patterns (Filtre: ${daysFilter}j)`);

        const { getHistoriqueParis } = await import('../core/db.mjs');
        const { detecterPatterns } = await import('../core/tendances.mjs');

        const historique = await getHistoriqueParis(daysFilter);
        const patterns = detecterPatterns(historique);

        res.json(patterns);
    } catch (error) {
        logger.error(`API Error Patterns: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// V28: SÉQUENCE ACTUELLE
app.get('/api/sequence', async (req, res) => {
    try {
        logger.info('API: Requête /api/sequence');

        const { getSequenceActuelle } = await import('../core/db.mjs');
        const sequence = await getSequenceActuelle();

        res.json(sequence);
    } catch (error) {
        logger.error(`API Error Séquence: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});


// V29: SYSTÈME D'ALERTES
app.get('/api/alerts', async (req, res) => {
    try {
        logger.info('API: Requête /api/alerts');

        const alerts = getActiveAlerts();
        const stats = getAlertStats();

        res.json({
            alerts,
            stats
        });
    } catch (error) {
        logger.error(`API Error Alerts: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/alerts/history', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        logger.info(`API: Requête /api/alerts/history (limit: ${limit})`);

        const history = getAlertHistory(parseInt(limit));

        res.json(history);
    } catch (error) {
        logger.error(`API Error Alert History: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/alerts/dismiss/:id', async (req, res) => {
    try {
        const alertId = parseInt(req.params.id);
        logger.info(`API: Dismiss alerte #${alertId}`);

        const success = dismissAlert(alertId);

        if (success) {
            res.json({ success: true, message: 'Alerte dismissée' });
        } else {
            res.status(404).json({ success: false, message: 'Alerte non trouvée' });
        }
    } catch (error) {
        logger.error(`API Error Dismiss Alert: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/alerts/dismiss-all', async (req, res) => {
    try {
        logger.info('API: Dismiss toutes les alertes');

        const count = dismissAllAlerts();

        res.json({ success: true, count, message: `${count} alertes dismissées` });
    } catch (error) {
        logger.error(`API Error Dismiss All: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/alerts/read/:id', async (req, res) => {
    try {
        const alertId = parseInt(req.params.id);
        logger.info(`API: Marquer alerte #${alertId} comme lue`);

        const success = markAlertAsRead(alertId);

        if (success) {
            res.json({ success: true, message: 'Alerte marquée comme lue' });
        } else {
            res.status(404).json({ success: false, message: 'Alerte non trouvée' });
        }
    } catch (error) {
        logger.error(`API Error Mark Read: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// V29: GÉNÉRATION AUTOMATIQUE D'ALERTES BASÉE SUR TENDANCES
app.get('/api/alerts/generate', async (req, res) => {
    try {
        const { days } = req.query;
        logger.info('API: Génération automatique d\'alertes');

        const { getTendancesCumulees, getIAPerformanceStats, getHistoriqueParis } = await import('../core/db.mjs');
        const { analyseCompletePatterns } = await import('../core/pattern_optimizer.mjs');

        const tendances = await getTendancesCumulees(days ? parseInt(days) : null);
        const performance = await getIAPerformanceStats(days ? parseInt(days) : null);
        const historique = await getHistoriqueParis(days ? parseInt(days) : 30);
        const patternData = await analyseCompletePatterns(historique);

        const newAlerts = analyserEtGenererAlertes(tendances, performance, patternData);

        res.json({
            success: true,
            generated: newAlerts.length,
            alerts: newAlerts,
            patternStats: patternData.stats
        });
    } catch (error) {
        logger.error(`API Error Generate Alerts: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});


// V29: BACKTESTING AVANCÉ
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

app.post('/api/backtest/compare', express.json(), async (req, res) => {
    try {
        const { startDate, endDate, initialBankroll = 1000 } = req.body;
        logger.info(`API: Comparaison Stratégies Kelly du ${startDate} au ${endDate}`);

        const { compareKellyStrategies } = await import('../ml/backtest.mjs');
        const results = await compareKellyStrategies(startDate, endDate, initialBankroll);

        res.json(results);
    } catch (error) {
        logger.error(`API Compare Strategies Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/backtest/monte-carlo', express.json(), async (req, res) => {
    try {
        const { startDate, endDate, simulations = 100, initialBankroll = 1000 } = req.body;
        logger.info(`API: Simulation Monte Carlo (${simulations} simulations)`);

        const { runMonteCarloSimulation } = await import('../ml/backtest.mjs');
        const results = await runMonteCarloSimulation(startDate, endDate, simulations, initialBankroll);

        res.json(results);
    } catch (error) {
        logger.error(`API Monte Carlo Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});


// V29: OPTIMISATION DE PATTERNS
app.get('/api/patterns/optimized', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        logger.info(`API: Analyse patterns optimisés (${days} jours)`);

        const { getHistoriqueParis } = await import('../core/db.mjs');
        const { analyseCompletePatterns } = await import('../core/pattern_optimizer.mjs');

        const historique = await getHistoriqueParis(parseInt(days));
        const results = await analyseCompletePatterns(historique);

        res.json(results);
    } catch (error) {
        logger.error(`API Patterns Optimized Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/patterns/recommendations', express.json(), async (req, res) => {
    try {
        const { contexte, days = 30 } = req.body;
        logger.info('API: Génération recommandations patterns');

        const { getHistoriqueParis } = await import('../core/db.mjs');
        const { analysePatternsCroises, genererRecommandations } = await import('../core/pattern_optimizer.mjs');

        const historique = await getHistoriqueParis(parseInt(days));
        const { patterns } = await analysePatternsCroises(historique);
        const recommendations = genererRecommandations(patterns, contexte);

        res.json({
            recommendations,
            totalPatterns: patterns.length,
            contexte
        });
    } catch (error) {
        logger.error(`API Recommendations Error: ${error.message}`);
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
