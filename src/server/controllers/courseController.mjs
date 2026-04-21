import { getAllCourses, getCourseParticipants, getCourseQuinte } from '../../core/db.mjs';
import { calculerPredictionHybride } from '../../core/hybrid.mjs';
import { calculateKellyAdaptatif } from '../../core/kelly.mjs';
import { getOrUpdatePatterns } from '../app.mjs';
import cache from '../../utils/cache.mjs';
import logger from '../../utils/logger.mjs';

export async function getCourses(req, res) {
    // ... (rest of getCourses unchanged, showing only the modified part)
    try {
        const { date, discipline, page = 1, limit = 50, hippodrome } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const today = new Date().toISOString().split('T')[0];
        const targetDate = date || today;
        const courses = await getAllCourses();

        let filtered = courses.filter(c => {
            const matchDate = !targetDate || targetDate === 'all' || c.date === targetDate;
            const matchDisc = !discipline || c.discipline === discipline;
            const matchHippo = !hippodrome || c.hippodrome.toLowerCase().includes(hippodrome.toLowerCase());
            return matchDate && matchDisc && matchHippo;
        });

        const total = filtered.length;
        const totalPages = Math.ceil(total / parseInt(limit));
        const paginated = filtered.slice(offset, offset + parseInt(limit));

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
        logger.error(`API Error /api/courses: ${error.message}`);
        res.status(500).json({ error: 'Erreur serveur interne', details: error.message });
    }
}

export async function getParticipants(req, res) {
    try {
        const id = req.params.id;
        const cacheKey = cache.generateKey('participants', id);

        // Tentative de récupération depuis le cache
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        const participants = await getCourseParticipants(id);
        if (!participants || participants.length === 0) {
            return res.json([]);
        }

        // Détecter si la course est finie via le premier participant (qui a accès au prix_course via le JOIN)
        // Note: On pourrait aussi récupérer l'objet course complet si besoin.
        const isFinished = participants.some(p => p.classement > 0);

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

        const { getOrUpdatePatterns } = await import('../app.mjs');
        const patternData = await getOrUpdatePatterns();
        const { getTendancesCumulees } = await import('../../core/db.mjs');
        const tendances = await getTendancesCumulees(30);

        const enriched = await Promise.all(participants.map(async (p, idx) => {
            const { matchPattern, getPlageHoraire } = await import('../../core/pattern_optimizer.mjs');
            const context = {
                discipline: p.discipline,
                prixCourse: p.prix_course,
                hippodrome: p.hippodrome,
                jour: new Date().toLocaleDateString('fr-FR', { weekday: 'long' }),
                plageHoraire: getPlageHoraire(new Date().getHours()),
                avgRatioGains: contextAvgRatio,
                avgCourses: contextAvgCourses
            };

            const activePatterns = [];
            patternData.goldenPatterns.forEach(gp => {
                if (matchPattern(gp.pattern, context)) activePatterns.push({ ...gp, type: 'GOLDEN_PATTERN' });
            });
            patternData.dangerPatterns.forEach(dp => {
                if (matchPattern(dp.pattern, context)) activePatterns.push({ ...dp, type: 'DANGER_PATTERN' });
            });

            const result = await calculerPredictionHybride(p, context, activePatterns);
            const kelly = await calculateKellyAdaptatif(p.cote_ref || 2.0, result.score, 'shadow', tendances, activePatterns);

            return {
                ...p,
                prediction_score: result.score,
                is_retard_gain: result.xai?.retard_gain || false,
                xai_details: { ...result.xai, activePatterns },
                kelly_suggestion: kelly
            };
        }));

        // Mise en cache (3600s si finie, 300s sinon)
        const ttl = isFinished ? 3600 : 300;
        cache.set(cacheKey, enriched, ttl);

        res.json(enriched);
    } catch (error) {
        logger.error(`API Error Participants: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}
// ... (rest of file unchanged)

export async function getQuintePrediction(req, res) {
    try {
        const { getCourseQuinte, getCourseParticipants } = await import('../../core/db.mjs');
        const course = await getCourseQuinte();

        if (!course) return res.status(404).json({ message: "Pas de Quinté+ identifié pour aujourd'hui." });

        const participants = await getCourseParticipants(course.id);
        const { calculerPredictionHybride } = await import('../../core/hybrid.mjs');

        const predictions = await Promise.all(participants.map(async p => {
            const context = { discipline: course.discipline, prixCourse: course.prix, isQuinte: true };
            const result = await calculerPredictionHybride(p, context);
            return { ...p, score: result.score, xai: result.xai };
        }));

        predictions.sort((a, b) => b.score - a.score);
        const selection = predictions.slice(0, 5);
        const tocards = predictions.slice(5).filter(p => p.score > 40 && p.cote_ref > 15).slice(0, 1);

        res.json({ course, selection, tocard: tocards[0] || null });
    } catch (error) {
        logger.error(`API Error Quinté: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}
