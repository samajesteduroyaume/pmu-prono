import logger from '../../utils/logger.mjs';
import cache from '../../utils/cache.mjs';
import { parseDays } from '../../utils/requestParams.mjs';
import { getDB } from '../../db/db.mjs';
import { countChronologicalCourseSplits, splitCourseGroups } from '../../ml/course_split.mjs';
import { MIN_PROMOTION_TEST_COURSES } from '../../ml/promotion_gate.mjs';
import { ML_FEATURE_SCHEMA_VERSION } from '../../ml/model_compatibility.mjs';

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
            SELECT course_id, course_date, feature_vector_json, outcome_rank, settled_at, captured_at, is_non_runner,
                   heuristic_score, prediction_rank, market_rank, feature_schema_version
            FROM prediction_snapshots
            ORDER BY course_date, course_id
        `, (error, result) => error ? reject(error) : resolve(result || [])));
        const grouped = new Map();
        const captureGroups = new Map();
        for (const row of rows) {
            if (!captureGroups.has(row.course_id)) {
                captureGroups.set(row.course_id, { total: 0, settled: 0, invalidFeatures: false, incompatibleFeatureSchema: false });
            }
            const captureCourse = captureGroups.get(row.course_id);
            captureCourse.total++;
            let features;
            try { features = JSON.parse(row.feature_vector_json); } catch { features = null; }
            if (!Array.isArray(features) || features.length !== 15 || !features.every(Number.isFinite)) captureCourse.invalidFeatures = true;
            if (Number(row.feature_schema_version) !== ML_FEATURE_SCHEMA_VERSION) captureCourse.incompatibleFeatureSchema = true;
            if (row.settled_at != null && row.outcome_rank != null) captureCourse.settled++;

            if (Number(row.is_non_runner) === 1) continue;
            if (!grouped.has(row.course_id)) {
                grouped.set(row.course_id, { date: row.course_date, invalidFeatures: false, incompatibleFeatureSchema: false, invalidOutcome: false, hasWinner: false, samples: 0, settledSamples: 0, completeHeuristic: true, hasForecastPick: false, hasMarketPick: false });
            }
            const course = grouped.get(row.course_id);
            if (row.heuristic_score == null || !Number.isFinite(Number(row.heuristic_score))) course.completeHeuristic = false;
            if (Number(row.prediction_rank) > 0) course.hasForecastPick = true;
            if (Number(row.market_rank) > 0) course.hasMarketPick = true;
            if (!Array.isArray(features) || features.length !== 15 || !features.every(Number.isFinite)) course.invalidFeatures = true;
            if (Number(row.feature_schema_version) !== ML_FEATURE_SCHEMA_VERSION) course.incompatibleFeatureSchema = true;
            if (row.settled_at == null || row.outcome_rank == null) course.invalidOutcome = true;
            else {
                course.samples++;
                course.settledSamples++;
                if (Number(row.outcome_rank) === 1) course.hasWinner = true;
            }
        }
        const eligible = [...grouped.values()].filter(course =>
            !course.invalidFeatures && !course.incompatibleFeatureSchema
            && !course.invalidOutcome && course.samples > 0 && course.hasWinner
        );
        const splitCounts = countChronologicalCourseSplits(eligible);
        const testCourseIds = splitCounts.splittable ? new Set(splitCourseGroups(eligible).testCourses.map(course => course.course_id)) : new Set();
        const comparableTestCourses = eligible.filter(course => testCourseIds.has(course.course_id)
            && course.completeHeuristic && course.hasForecastPick && course.hasMarketPick).length;
        const { minimumSettledCourses, minimumDistinctDates } = status.trainingRequirements;
        status.trainingReadiness = {
            eligibleCourses: eligible.length,
            requiredCourses: minimumSettledCourses,
            eligibleDates: splitCounts.dates,
            requiredDates: minimumDistinctDates,
            chronologicalSplit: splitCounts,
            requiredTestCourses: MIN_PROMOTION_TEST_COURSES,
            comparableTestCourses,
            ready: eligible.length >= minimumSettledCourses
                && splitCounts.splittable
                && comparableTestCourses >= MIN_PROMOTION_TEST_COURSES
        };
        const fullySettledCourses = [...captureGroups.values()].filter(course =>
            course.total > 0 && course.settled === course.total
        ).length;
        status.captureHealth = {
            capturedCourses: captureGroups.size,
            capturedRunners: rows.length,
            fullySettledCourses,
            awaitingResultsCourses: captureGroups.size - fullySettledCourses,
            coursesWithInvalidFeatures: [...captureGroups.values()].filter(course => course.invalidFeatures).length,
            coursesWithIncompatibleFeatureSchema: [...captureGroups.values()].filter(course => course.incompatibleFeatureSchema).length,
            nonRunnerSnapshots: rows.filter(row => Number(row.is_non_runner) === 1).length,
            lastCaptureAt: rows.reduce((latest, row) => row.captured_at && (!latest || row.captured_at > latest) ? row.captured_at : latest, null)
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

