import logger from '../../utils/logger.mjs';
import cache from '../../utils/cache.mjs';
import { parseDays } from '../../utils/requestParams.mjs';
import { getDB } from '../../db/db.mjs';
import { countChronologicalCourseSplits } from '../../ml/course_split.mjs';
import { MIN_PROMOTION_TEST_COURSES } from '../../ml/promotion_gate.mjs';

function validEvaluationPeriod(startDate, endDate) {
    const validDate = value => {
        if (!value) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    return validDate(startDate) && validDate(endDate) && (!startDate || !endDate || startDate <= endDate);
}

export async function getTendances(req, res) {
    try {
        const { days } = req.query;
        const daysFilter = parseDays(days);
        if (daysFilter === undefined) return res.status(400).json({ error: 'Le paramètre days doit être un entier entre 1 et 3650.' });
        
        const cacheKey = cache.generateKey('tendances', daysFilter ?? 'all');
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const { getTendancesCumulees } = await import('../../core/db.mjs');
        const tendances = await getTendancesCumulees(daysFilter);
        
        cache.set(cacheKey, tendances, 60); // Les réglages peuvent changer après la synchronisation d'une arrivée.
        res.json(tendances);
    } catch (error) {
        logger.error(`API Error Tendances: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getPatterns(req, res) {
    try {
        const { days } = req.query;
        const daysFilter = parseDays(days, 30);
        if (daysFilter === undefined) return res.status(400).json({ error: 'Le paramètre days doit être un entier entre 1 et 3650.' });
        const { getHistoriqueParis } = await import('../../core/db.mjs');
        const { detecterPatterns } = await import('../../core/tendances.mjs');
        const historique = await getHistoriqueParis(daysFilter);
        const patterns = detecterPatterns(historique);
        res.json(patterns);
    } catch (error) {
        logger.error(`API Error Patterns: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getSequence(req, res) {
    try {
        const { getSequenceActuelle } = await import('../../core/db.mjs');
        const sequence = await getSequenceActuelle();
        res.json(sequence);
    } catch (error) {
        logger.error(`API Error Séquence: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function valueHunter(req, res) {
    try {
        const { date } = req.query;
        const { detectOpportunities } = await import('../../core/value_hunter.mjs');
        const opportunities = await detectOpportunities(date);
        
        // Broadcast via Websocket si Smart Money détecté
        const valueSignals = opportunities.filter(o => o.is_value_signal);
        if (valueSignals.length > 0) {
            const io = req.app.get('io');
            if (io) {
                io.emit('value_opportunity_alert', valueSignals);
            }
        }

        res.json(opportunities);
    } catch (error) {
        logger.error(`API Value Hunter Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function backtest(req, res) {
    try {
        const { startDate, endDate } = req.body;
        if (!validEvaluationPeriod(startDate, endDate)) return res.status(400).json({ error: 'Période invalide : dates attendues au format AAAA-MM-JJ.' });
        const { getForecastEvaluation } = await import('../../core/forecast_evaluation.mjs');
        res.json(await getForecastEvaluation({ startDate, endDate }));
    } catch (error) {
        logger.error(`API Backtest Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function backtestCompare(req, res) {
    // L'évaluation standard inclut déjà la comparaison IA/marché sur les mêmes courses.
    return backtest(req, res);
}

export async function forecastEvaluation(req, res) {
    try {
        const { startDate, endDate } = req.query;
        if (!validEvaluationPeriod(startDate, endDate)) {
            return res.status(400).json({ error: 'Période invalide : dates attendues au format AAAA-MM-JJ.' });
        }
        const { getForecastEvaluation } = await import('../../core/forecast_evaluation.mjs');
        res.json(await getForecastEvaluation({ startDate, endDate }));
    } catch (error) {
        logger.error(`API Forecast Evaluation Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getMLStatusController(req, res) {
    try {
        const { getMLStatus } = await import('../../core/hybrid.mjs');
        const status = getMLStatus();
        const db = getDB();
        const rows = await new Promise((resolve, reject) => db.all(`
            SELECT course_id, course_date, feature_vector_json, outcome_rank, settled_at
            FROM prediction_snapshots
            WHERE course_id IN (
                SELECT DISTINCT course_id FROM prediction_snapshots WHERE settled_at IS NOT NULL
            )
            ORDER BY course_date, course_id
        `, (error, result) => error ? reject(error) : resolve(result || [])));
        const grouped = new Map();
        for (const row of rows) {
            if (!grouped.has(row.course_id)) {
                grouped.set(row.course_id, { date: row.course_date, invalidFeatures: false, invalidOutcome: false, hasWinner: false, samples: 0 });
            }
            const course = grouped.get(row.course_id);
            let features;
            try { features = JSON.parse(row.feature_vector_json); } catch { features = null; }
            if (!Array.isArray(features) || features.length !== 15 || !features.every(Number.isFinite)) course.invalidFeatures = true;
            if (row.settled_at == null || row.outcome_rank == null) course.invalidOutcome = true;
            else {
                course.samples++;
                if (Number(row.outcome_rank) === 1) course.hasWinner = true;
            }
        }
        const eligible = [...grouped.values()].filter(course =>
            !course.invalidFeatures && !course.invalidOutcome && course.samples > 0 && course.hasWinner
        );
        const splitCounts = countChronologicalCourseSplits(eligible);
        const { minimumSettledCourses, minimumDistinctDates } = status.trainingRequirements;
        status.trainingReadiness = {
            eligibleCourses: eligible.length,
            requiredCourses: minimumSettledCourses,
            eligibleDates: splitCounts.dates,
            requiredDates: minimumDistinctDates,
            chronologicalSplit: splitCounts,
            requiredTestCourses: MIN_PROMOTION_TEST_COURSES,
            ready: eligible.length >= minimumSettledCourses
                && splitCounts.splittable
                && splitCounts.test >= MIN_PROMOTION_TEST_COURSES
        };
        res.json(status);
    } catch (error) {
        logger.error(`API ML Status Error: ${error.message}`);
        res.status(500).json({ error: 'État ML indisponible.' });
    }
}

export async function backtestMonteCarlo(req, res) {
    return res.status(410).json({ error: 'Simulation désactivée : elle utilisait des données historiques recalculées et ne mesure pas des pronostics enregistrés avant course.' });
}

export async function getOptimizedPatterns(req, res) {
    try {
        const days = parseDays(req.query.days, 30);
        if (days === undefined) return res.status(400).json({ error: 'Le paramètre days doit être un entier entre 1 et 3650.' });
        const { getHistoriqueParis } = await import('../../core/db.mjs');
        const { analyseCompletePatterns } = await import('../../core/pattern_optimizer.mjs');
        const historique = await getHistoriqueParis(days);
        const results = await analyseCompletePatterns(historique);
        res.json(results);
    } catch (error) {
        logger.error(`API Patterns Optimized Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getRecommendations(req, res) {
    try {
        const { contexte } = req.body || {};
        const days = parseDays(req.body?.days, 30);
        if (days === undefined) return res.status(400).json({ error: 'Le paramètre days doit être un entier entre 1 et 3650.' });
        const { getHistoriqueParis } = await import('../../core/db.mjs');
        const { analysePatternsCroises, genererRecommandations } = await import('../../core/pattern_optimizer.mjs');
        const historique = await getHistoriqueParis(days);
        const { patterns } = await analysePatternsCroises(historique);
        const recommendations = genererRecommandations(patterns, contexte);
        res.json({ recommendations, totalPatterns: patterns.length, contexte });
    } catch (error) {
        logger.error(`API Recommendations Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function reloadMLModelController(req, res) {
    try {
        const { loadMLModel } = await import('../../core/hybrid.mjs');
        const success = await loadMLModel();
        if (success) {
            logger.success('[API] Modèle ML rechargé en mémoire avec succès !');
            res.json({ success: true, message: 'Modèle ML rechargé en mémoire avec succès !' });
        } else {
            res.status(500).json({ success: false, message: 'Échec du rechargement du modèle ML' });
        }
    } catch (error) {
        logger.error(`API Reload ML Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

