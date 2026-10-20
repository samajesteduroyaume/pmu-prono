import { getCoursesPage, getCourseParticipants, getCourseQuinte, getCourseById } from '../../core/db.mjs';
import { calculerPredictionHybride, getMLMetadata } from '../../core/hybrid.mjs';
import { calculateKellyAdaptatif, calibrateProbability, refreshProspectiveCalibration } from '../../core/kelly.mjs';
import { getOrUpdatePatterns } from '../app.mjs';
import cache from '../../utils/cache.mjs';
import logger from '../../utils/logger.mjs';
import { formatDate, formatHeure } from '../../utils/dateUtils.mjs';
import { getDB } from '../../db/db.mjs';
import { isNonRunnerStatus, NON_RUNNER_STATUS_SQL } from '../../core/runner_status.mjs';

async function getCourseSnapshots(courseId) {
    const db = getDB();
    return new Promise((resolve, reject) => db.all(
        'SELECT * FROM prediction_snapshots WHERE course_id = ? ORDER BY prediction_rank',
        [courseId],
        (error, rows) => error ? reject(error) : resolve(rows || [])
    ));
}

function raceHasStarted(course, participants = []) {
    if (!course) return true;
    const status = String(course.statut || '').toUpperCase();
    if (course.ordre_arrivee || /ARRIV|TERMINE|FIN_COURSE|EN_COURS|PARTI|DEPART|ANNULE/.test(status)) return true;
    if (participants.some(row => Number(row.classement) > 0)) return true;
    const today = formatDate(new Date());
    // If date/time data is incomplete, fail closed: recalculating could expose
    // information learned after a same-day race has started.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(course.date || '')) || !today) return true;
    if (course.date < today) return true;
    if (course.date > today) return false;
    if (!course.heure) return true;
    const scheduledTime = String(course.heure).slice(0, 5);
    const nowTime = formatHeure(new Date());
    const [hour, minute] = scheduledTime.split(':').map(Number);
    if (!/^\d{2}:\d{2}$/.test(scheduledTime) || !Number.isInteger(hour) || !Number.isInteger(minute)
        || hour > 23 || minute > 59 || nowTime === '--:--') return true;
    return `${course.date}T${scheduledTime}` <= `${today}T${nowTime}`;
}

function applyFrozenPredictions(participants, snapshots) {
    const byParticipant = new Map(snapshots.map(row => [Number(row.participant_id), row]));
    return participants.map(participant => {
        const snapshot = isRunner(participant) ? byParticipant.get(Number(participant.id)) : null;
        const score = snapshot ? Number(snapshot.prediction_score) : null;
        return {
            ...participant,
            prediction_score: score,
            score,
            ia_score: score,
            prediction_rank: snapshot ? Number(snapshot.prediction_rank) : null,
            odds_at_prediction: snapshot?.odds_at_prediction == null ? null : Number(snapshot.odds_at_prediction),
            market_probability_at_prediction: snapshot?.market_probability == null ? null : Number(snapshot.market_probability),
            predictionAvailable: Boolean(snapshot),
            prediction_source: snapshot ? 'snapshot-pre-course' : null,
            prediction_model_version: snapshot?.model_version || null,
            is_ai_top_pick: snapshot ? Number(snapshot.prediction_rank) === 1 : false,
            kelly_suggestion: null,
            prediction_unavailable_reason: snapshot ? null : 'Aucun pronostic pré-course enregistré pour cette course.'
        };
    });
}

function isRunner(participant) {
    return !isNonRunnerStatus(participant.statut);
}

function averageHistoryPrize(history) {
    const prizes = history.map(row => Number(row.prix)).filter(value => Number.isFinite(value) && value > 0);
    return prizes.length ? prizes.reduce((sum, value) => sum + value, 0) / prizes.length : 0;
}

function comparePredictions(a, b) {
    return (Number(b.prediction_score ?? b.score) - Number(a.prediction_score ?? a.score))
        || ((Number(a.odds_at_prediction ?? a.cote_ref) > 1 ? Number(a.odds_at_prediction ?? a.cote_ref) : Infinity)
            - (Number(b.odds_at_prediction ?? b.cote_ref) > 1 ? Number(b.odds_at_prediction ?? b.cote_ref) : Infinity))
        || (Number(a.numero) - Number(b.numero));
}

function getScheduledCalendar(course) {
    // Course dates are calendar dates in Paris; avoid interpreting them in the host timezone.
    const date = new Date(`${course.date}T12:00:00Z`);
    const hour = Number.parseInt(String(course.heure || '').slice(0, 2), 10);
    return {
        jour: Number.isFinite(date.getTime()) ? date.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' }) : null,
        hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null
    };
}

export async function getCourses(req, res) {
    const startTime = Date.now();
    try {
        await refreshProspectiveCalibration(getMLMetadata()?.version || 'heuristic-fallback');
        const { date, discipline, page = 1, limit = 50, hippodrome } = req.query;

        const today = formatDate(new Date());
        let targetDate = date;
        if (date === undefined || date === '' || date === null || date === 'null') {
            targetDate = today;
        }

        const { courses: paginated, total } = await getCoursesPage({
            date: targetDate && targetDate !== 'all' ? targetDate : null,
            discipline: discipline && discipline !== 'ALL' ? discipline : null,
            hippodrome,
            page,
            limit
        });
        const totalPages = Math.ceil(total / limit) || 1;

        const enriched = await Promise.all(paginated.map(async c => {
            const participants = await getCourseParticipants(c.id);
            
            let topHorse = null;
            let cat_trend = 'STABLE';
            let scoreAtPrediction = null;
            let predictionAvailable = false;
            
            if (participants && participants.length > 0) {
                if (raceHasStarted(c, participants)) {
                    const snapshots = await getCourseSnapshots(c.id);
                    const frozenTop = snapshots.find(row => Number(row.prediction_rank) === 1);
                    if (frozenTop) {
                        topHorse = { numero: frozenTop.horse_number, nom: frozenTop.horse_name };
                        scoreAtPrediction = Number(frozenTop.prediction_score);
                    } else {
                        predictionAvailable = false;
                        scoreAtPrediction = null;
                    }
                } else {
                    topHorse = participants.find(isRunner) || null;
                    if (topHorse) {
                        const score = Number(topHorse.prediction_score);
                        if (Number.isFinite(score)) {
                            scoreAtPrediction = score;
                            predictionAvailable = true;
                        }
                        cat_trend = await getCategoryTrend(topHorse.nom, c.prix, c);
                    }
                }
            }

            let meteoObj = null;
            if (c.meteo) {
                try {
                    meteoObj = typeof c.meteo === 'string' ? JSON.parse(c.meteo) : c.meteo;
                } catch (e) {
                    meteoObj = null;
                }
            }

            return {
                ...c,
                top_horse: topHorse ? `${topHorse.numero}. ${topHorse.nom}` : predictionAvailable ? 'Non analysé' : 'Pronostic indisponible',
                ia_score: scoreAtPrediction,
                predictionAvailable,
                cat_trend,
                meteo: meteoObj
            };
        }));

        res.json({
            success: true,
            data: enriched,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            meta: {
                timestamp: new Date().toISOString(),
                execution_time_ms: Date.now() - startTime
            }
        });
    } catch (error) {
        logger.error(`API Error /api/courses: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erreur serveur interne', details: error.message });
    }
}

export async function getParticipants(req, res) {
    try {
        await refreshProspectiveCalibration(getMLMetadata()?.version || 'heuristic-fallback');
        const id = req.params.id;
        const cacheKey = cache.generateKey('participants-v3', id);

        const [course, participants] = await Promise.all([getCourseById(id), getCourseParticipants(id)]);
        if (!participants || participants.length === 0) {
            return res.json([]);
        }

        if (raceHasStarted(course, participants)) {
            const snapshots = await getCourseSnapshots(id);
            const frozen = applyFrozenPredictions(participants, snapshots);
            cache.set(cacheKey, frozen, 86400);
            return res.json(frozen);
        }

        const cachedData = cache.get(cacheKey);
        if (cachedData && cachedData.length > 0 && cachedData[0].xai_details?.baseScores) {
            return res.json(cachedData);
        }

        const activeRunners = participants.filter(isRunner);

        let totalRatio = 0;
        let totalCourses = 0;
        let countContext = 0;
        const validP = participants.filter(p => {
            const courses = Number(p.nb_courses);
            const gains = Number(p.gains);
            return isRunner(p) && Number.isFinite(courses) && courses > 0
                && Number.isFinite(gains) && gains > 0;
        });

        if (validP.length >= 5) {
            for (const p of validP) {
                totalRatio += (Number(p.gains) / Number(p.nb_courses));
                totalCourses += Number(p.nb_courses);
                countContext++;
            }
        }

        const contextAvgRatio = countContext > 0 ? (totalRatio / countContext) : 0;
        const contextAvgCourses = countContext > 0 ? (totalCourses / countContext) : 0;

        const patternData = await getOrUpdatePatterns();
        const { getTendancesCumulees } = await import('../../core/db.mjs');
        const tendances = await getTendancesCumulees(30);

        const enriched = await Promise.all(participants.map(async p => {
            if (!isRunner(p)) {
                return { ...p, prediction_score: null, score: null, ia_score: null, predictionAvailable: false, is_ai_top_pick: false };
            }
            const { matchPattern, getPlageHoraire } = await import('../../core/pattern_optimizer.mjs');
            const calendar = getScheduledCalendar(course);
            const context = {
                discipline: p.discipline_course || p.discipline,
                prixCourse: p.prix_course || 0,
                hippodrome: p.hippodrome_course || p.hippodrome,
                terrain: p.terrain_course || p.terrain,
                distance: p.distance_course_raw || p.distance_course || p.distance,
                corde: p.corde,
                jour: calendar.jour,
                plageHoraire: calendar.hour === null ? null : getPlageHoraire(calendar.hour),
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

            // Calcul de la tendance de catégorie pour chaque participant
            const { getHorseHistory } = await import('../../core/db.mjs');
            const history = await getHorseHistory(p.nom, 5, { date: course.date, time: course.heure });
            const avgHistoryPrix = averageHistoryPrize(history);

            const cat_trend = await getCategoryTrend(p.nom, p.prix_course, course);

            // Génération des arguments XAI (v43.3)
            const { preparerBaseScores, genererArgumentsXAI } = await import('../../core/intelligence.mjs');
            const baseScores = await preparerBaseScores(p, context, avgHistoryPrix);
            const result = await calculerPredictionHybride(p, context, activePatterns, activeRunners, baseScores);
            const arguments_ia = genererArgumentsXAI(p, baseScores, cat_trend);

            return {
                ...p,
                prediction_score: result.score || 0,
                score: result.score || 0,
                ia_score: result.score || 0,
                _activePatterns: activePatterns,
                is_retard_gain: result.xai?.retard_gain || false,
                cat_trend,
                arguments_ia,
                xai_details: { ...result.xai, activePatterns, baseScores },
                kelly_suggestion: null
            };
        }));

        const ranked = enriched.filter(horse => horse.prediction_score != null && Number.isFinite(Number(horse.prediction_score))).sort(comparePredictions);
        ranked.forEach((horse, index) => {
            horse.prediction_rank = index + 1;
            horse.predictionAvailable = true;
            horse.is_ai_top_pick = index === 0;
        });
        enriched.filter(horse => horse.prediction_score == null || !Number.isFinite(Number(horse.prediction_score))).forEach(horse => {
            horse.prediction_rank = null;
            horse.is_ai_top_pick = false;
        });

        if (ranked.length > 0) {
            const topPick = ranked[0];
            topPick.kelly_suggestion = await calculateKellyAdaptatif(
                topPick,
                topPick.prediction_score,
                'shadow',
                tendances,
                topPick._activePatterns
            );
            enriched.forEach(horse => {
                delete horse._activePatterns;
            });
        }

        // Mise en cache (86400s = 24h si finie, 300s sinon)
        cache.set(cacheKey, enriched, 300);

        res.json(enriched);
    } catch (error) {
        logger.error(`API Error Participants: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}
// ... (rest of file unchanged)

export async function getQuintePrediction(req, res) {
    try {
        const { date } = req.query;
        const course = await getCourseQuinte(date);

        if (!course) return res.status(404).json({ message: "Pas de Quinté+ identifié pour cette date." });

        const participants = await getCourseParticipants(course.id);
        if (raceHasStarted(course, participants)) {
            const snapshots = await getCourseSnapshots(course.id);
            const frozen = applyFrozenPredictions(participants, snapshots).filter(row => row.predictionAvailable).sort(comparePredictions);
            const selection = frozen.slice(0, 8);
            return res.json({
                course,
                selection,
                tocard: frozen.slice(8).find(row => Number(row.odds_at_prediction) > 15) || null,
                predictionAvailable: frozen.length > 0,
                predictionMethodology: 'Pronostics capturés avant le départ; les courses sans snapshot ne sont pas reconstituées.'
            });
        }
        const activeRunners = participants.filter(isRunner);

        const predictions = await Promise.all(activeRunners.map(async p => {
            try {
                const { getHorseHistory } = await import('../../core/db.mjs');
                const { preparerBaseScores, genererArgumentsXAI } = await import('../../core/intelligence.mjs');
                
                const context = {
                    discipline: course.discipline,
                    prixCourse: course.prix,
                    terrain: course.terrain,
                    distance: course.distance,
                    corde: course.corde,
                    isQuinte: true
                };
                
                // Récupération historique pour la classe (Elite v43.3)
                const history = await getHorseHistory(p.nom, 5, { date: course.date, time: course.heure });
                const avgHistoryPrix = averageHistoryPrize(history);
                
                const cat_trend = await getCategoryTrend(p.nom, course.prix, course);
                const baseScores = await preparerBaseScores(p, context, avgHistoryPrix);
                const result = await calculerPredictionHybride(p, context, [], activeRunners, baseScores);
                const arguments_ia = genererArgumentsXAI(p, baseScores, cat_trend);

                return { 
                    ...p, 
                    score: result.score, 
                    prediction_score: result.score,
                    ia_score: result.score,
                    cat_trend,
                    arguments_ia
                };
            } catch (e) {
                logger.error(`Erreur calcul participant Quinté ${p.nom}: ${e.message}`);
                return { ...p, score: null, prediction_score: null, ia_score: null, predictionAvailable: false, cat_trend: 'STABLE' };
            }
        }));

        const rankedPredictions = predictions.filter(prediction => prediction.prediction_score != null
            && Number.isFinite(Number(prediction.prediction_score)))
            .sort(comparePredictions);
        rankedPredictions.forEach((prediction, index) => {
            prediction.prediction_rank = index + 1;
            prediction.predictionAvailable = true;
        });
        const selection = rankedPredictions.slice(0, 8); // Top 8 pour le Quinté Elite
        const tocard = rankedPredictions.slice(8).find(p => p.cote_ref > 15) || null;

        res.json({ course, selection, tocard, predictionAvailable: rankedPredictions.length > 0 });
    } catch (error) {
        logger.error(`API Error Quinté: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

async function getCategoryTrend(horseName, currentPrix, course = null) {
    try {
        const { getHorseHistory } = await import('../../core/db.mjs');
        const before = course?.date ? { date: course.date, time: course.heure } : null;
        const history = await getHorseHistory(horseName, 5, before);
        if (!history || history.length === 0) return 'STABLE';

        const avgHistoryPrix = averageHistoryPrize(history);
        if (avgHistoryPrix === 0) return 'STABLE';

        const currentPrize = Number(currentPrix);
        if (!Number.isFinite(currentPrize) || currentPrize <= 0) return 'STABLE';
        const diff = (currentPrize - avgHistoryPrix) / avgHistoryPrix;
        
        // Seuil réduit à 10% pour plus de réactivité
        if (diff < -0.10) {
            logger.info(`[CLASS] ${horseName} DESCEND: Prix ${currentPrix} vs Moy ${avgHistoryPrix.toFixed(0)}`);
            return 'DOWN'; 
        }
        if (diff > 0.10) {
            logger.info(`[CLASS] ${horseName} MONTE: Prix ${currentPrix} vs Moy ${avgHistoryPrix.toFixed(0)}`);
            return 'UP';
        }
        return 'STABLE';
    } catch (e) {
        return 'STABLE';
    }
}

export async function getCourseDetails(req, res) {
    try {
        const { id } = req.params;
        const course = await getCourseById(id);
        
        if (!course) {
            return res.status(404).json({ error: "Course introuvable" });
        }

        const participants = await getCourseParticipants(id);
        if (raceHasStarted(course, participants)) {
            const snapshots = await getCourseSnapshots(id);
            return res.json({
                course: { ...course, meteo: typeof course.meteo === 'string' ? (() => { try { return JSON.parse(course.meteo); } catch { return null; } })() : course.meteo },
                participants: applyFrozenPredictions(participants, snapshots),
                predictionMethodology: 'Pronostic pré-course figé; aucune prédiction historique n’est recalculée.'
            });
        }
        const { preparerBaseScores } = await import('../../core/intelligence.mjs');
        const activeRunners = participants.filter(isRunner);

        const enrichedParticipants = await Promise.all(participants.map(async p => {
            try {
                if (!isRunner(p)) {
                    return { ...p, prediction_score: null, score: null, ia_score: null, predictionAvailable: false };
                }
                const context = {
                    discipline: course.discipline,
                    prixCourse: course.prix,
                    terrain: course.terrain,
                    distance: course.distance,
                    corde: course.corde,
                    hippodrome: course.hippodrome
                };
                
                // Récupération historique pour la classe (Elite v43.3)
                const { getHorseHistory } = await import('../../core/db.mjs');
                const history = await getHorseHistory(p.nom, 5, { date: course.date, time: course.heure });
                const avgHistoryPrix = averageHistoryPrize(history);
                
                const cat_trend = await getCategoryTrend(p.nom, course.prix, course);
                const { genererArgumentsXAI } = await import('../../core/intelligence.mjs');
                const baseScores = await preparerBaseScores(p, context, avgHistoryPrix);
                
                // On simule un passage dans l'hybride pour récupérer les flags (V45)
                const result = await calculerPredictionHybride(p, context, [], activeRunners, baseScores);
                const arguments_ia = genererArgumentsXAI(p, baseScores, cat_trend);

                return {
                    ...p,
                    prediction_score: result.score || 0,
                    score: result.score || 0,
                    ia_score: result.score || 0,
                    baseScores,
                    cat_trend,
                    arguments_ia
                };
            } catch(e) {
                logger.error(`Erreur enrichissement modal pour ${p.nom}: ${e.message}`);
                return { ...p, prediction_score: null, score: null, ia_score: null, predictionAvailable: false };
            }
        }));

        const rankedParticipants = enrichedParticipants.filter(p => p.prediction_score != null
            && Number.isFinite(Number(p.prediction_score))).sort(comparePredictions);
        rankedParticipants.forEach((p, index) => {
            p.prediction_rank = index + 1;
            p.predictionAvailable = true;
        });

        let meteoObj = null;
        if (course.meteo) {
            try {
                meteoObj = typeof course.meteo === 'string' ? JSON.parse(course.meteo) : course.meteo;
            } catch (e) {
                meteoObj = null;
            }
        }

        // Enrichissement complet pour le modal
        res.json({
            course: {
                ...course,
                meteo: meteoObj
            },
            participants: [...rankedParticipants, ...enrichedParticipants.filter(p => p.prediction_score == null
                || !Number.isFinite(Number(p.prediction_score)))]
        });
    } catch (error) {
        logger.error(`API Error Details: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getPepites(req, res) {
    try {
        const modelVersion = getMLMetadata()?.version || 'heuristic-fallback';
        await refreshProspectiveCalibration(modelVersion);
        const db = getDB();

        // Le score, la cote et le favori marché doivent provenir du même snapshot
        // et de la même version que la calibration prospective.
        const query = `
            SELECT p.*, p.corde as ia_corde, p.recul as ia_recul,
                   c.*, ps.horse_name as ia_nom, ps.horse_number as ia_numero,
                   ps.prediction_score as ia_score,
                   ps.odds_at_prediction as fav_cote,
                   ps.market_probability,
                   p.musique as ia_musique
            FROM prediction_snapshots ps
            JOIN participants p ON p.id = ps.participant_id AND p.course_id = ps.course_id
            JOIN courses c ON c.id = ps.course_id
            WHERE ps.prediction_rank = 1 AND ps.prediction_score >= 65
              AND ps.odds_at_prediction > 1
              AND ps.market_probability IS NOT NULL AND ps.market_probability > 0
              AND ps.model_version = ?
              AND COALESCE(UPPER(p.statut), 'PARTANT') NOT IN (${NON_RUNNER_STATUS_SQL})
              AND (c.date > ? OR (c.date = ? AND time(c.heure) > time(?)))
              AND COALESCE(c.ordre_arrivee, '') = ''
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%ARRIV%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%TERMINE%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%FIN_COURSE%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%ANNULE%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%EN_COURS%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%PARTI%'
              AND UPPER(COALESCE(c.statut, '')) NOT LIKE '%DEPART%'
            ORDER BY c.date ASC, time(c.heure) ASC, c.id ASC
            LIMIT 100
        `;

        const today = formatDate(new Date());
        db.all(query, [modelVersion, today, today, formatHeure(new Date())], async (err, rows) => {
            if (err) {
                logger.error(`DB Error Pépites: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }

            const pepites = rows.map(c => {
                // The score is ranking points, not a probability. Calibrate it before
                // comparing it with the market's implied probability.
                const winProbability = calibrateProbability(Number(c.ia_score));
                const marketProbability = Number(c.market_probability);
                if (!Number.isFinite(winProbability) || !Number.isFinite(marketProbability)) return null;
                const edge = (winProbability - marketProbability) * 100;
                const cote = parseFloat(c.fav_cote || 0);
                // Fast computation of flags for the UI
                const is_swimmer = (c.terrain || '').includes('LOURD') && (c.terrain_prefere || '').includes('LOURD');
                const discipline = String(c.discipline || '').toUpperCase();
                const is_bad_draw = (discipline.includes('PLAT') && Number(c.ia_corde) >= 14) ||
                                    (discipline.includes('TROT') && Number(c.ia_recul) > 0 && Number(c.distance || 2700) < 2800);

                return {
                    ...c,
                    edge: edge.toFixed(1),
                    confidence: c.ia_score >= 75 ? 'ÉLITE' : 'STANDARD',
                    recommendation: edge > 10 ? 'MISE FORTE' : 'MISE MODÉRÉE',
                    is_swimmer,
                    is_bad_draw,
                };
            }).filter(p => p && Number(p.edge) > 5);

            res.json(pepites);
        });
    } catch (error) {
        logger.error(`API Error Pépites: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getPerformanceStats(req, res) {
    try {
        const db = getDB();
        
        db.all(`
            SELECT prediction_score, outcome_rank, official_payout
            FROM prediction_snapshots
            WHERE prediction_rank = 1 AND prediction_score >= 75 AND outcome_rank IS NOT NULL
        `, [], (err, rows) => {
            if (err) {
                logger.error(`DB Error Performance: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }

            let totalBets = 0;
            let totalWon = 0;
            let totalReturns = 0;
            let payoutsComplete = true;
            rows.forEach(row => {
                totalBets++;
                if (Number(row.outcome_rank) === 1) {
                    totalWon++;
                    if (Number(row.official_payout) > 0) totalReturns += Number(row.official_payout);
                    else payoutsComplete = false;
                }
            });

            const winRate = totalBets > 0 ? (totalWon / totalBets) * 100 : 0;
            // Sans gagnant, les mises réglées ont toutes perdu : le ROI est connu (-100%).
            // S'il y a des gagnants, le calcul exige leurs rapports officiels.
            const roiAvailable = totalBets > 0 && (totalWon === 0 || payoutsComplete);
            res.json({
                totalBets,
                totalWon,
                winRate: winRate.toFixed(1),
                roi: roiAvailable ? (((totalReturns / totalBets) - 1) * 100).toFixed(1) : null,
                profit: totalBets > 0 && payoutsComplete ? (totalReturns - totalBets).toFixed(2) : null,
                roiUnavailableReason: !totalBets ? 'Aucun snapshot réglé avec score ≥ 75.' : roiAvailable ? '' : 'Rapports officiels incomplets pour les gagnants.'
            });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
