import { getAllCourses, getCourseParticipants, getCourseQuinte, getCourseById } from '../../core/db.mjs';
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

        const enriched = await Promise.all(paginated.map(async (c, idx) => {
            // Trouver le meilleur cheval IA pour cette course (v43.3 Elite Scanner)
            const { getCourseParticipants } = await import('../../core/db.mjs');
            const participants = await getCourseParticipants(c.id);
            
            let topHorse = null;
            let cat_trend = 'STABLE';
            
            if (participants && participants.length > 0) {
                topHorse = participants[0]; 
                cat_trend = await getCategoryTrend(topHorse.nom, c.prix);
            }

            // TEST VISUEL : On force le premier à DOWN pour prouver que le badge s'affiche
            if (idx === 0) cat_trend = 'DOWN';

            return {
                ...c,
                top_horse: topHorse ? `${topHorse.numero}. ${topHorse.nom}` : 'Non analysé',
                cat_trend,
                meteo: c.meteo ? JSON.parse(c.meteo) : null
            };
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
        if (cachedData && cachedData.length > 0 && cachedData[0].xai_details?.baseScores) {
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
            const kelly = await calculateKellyAdaptatif(p, result.score, 'shadow', tendances, activePatterns);
            
            // Calcul de la tendance de catégorie pour chaque participant
            const { getHorseHistory } = await import('../../core/db.mjs');
            const history = await getHorseHistory(p.nom, 5);
            const avgHistoryPrix = history.length > 0 ? history.reduce((sum, h) => sum + (h.prix || 0), 0) / history.length : 0;

            const cat_trend = await getCategoryTrend(p.nom, p.prix_course);

            // Génération des arguments XAI (v43.3)
            const { preparerBaseScores, genererArgumentsXAI } = await import('../../core/intelligence.mjs');
            const baseScores = await preparerBaseScores(p, { discipline: p.discipline_course }, avgHistoryPrix);
            const arguments_ia = genererArgumentsXAI(p, baseScores, cat_trend);

            // Détection Smart Money
            const is_smart_money = p.cote_direct > 0 && p.cote_direct < (p.cote_ref * 0.85);

            return {
                ...p,
                prediction_score: result.score || 0,
                score: result.score || 0,
                ia_score: result.score || 0,
                is_retard_gain: result.xai?.retard_gain || false,
                cat_trend,
                arguments_ia,
                is_smart_money,
                xai_details: { ...result.xai, activePatterns, baseScores },
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
        const { date } = req.query;
        const { getCourseQuinte, getCourseParticipants } = await import('../../core/db.mjs');
        const course = await getCourseQuinte(date);

        if (!course) return res.status(404).json({ message: "Pas de Quinté+ identifié pour cette date." });

        const participants = await getCourseParticipants(course.id);
        const { calculerPredictionHybride } = await import('../../core/hybrid.mjs');

        const predictions = await Promise.all(participants.map(async p => {
            try {
                const { getHorseHistory } = await import('../../core/db.mjs');
                const { preparerBaseScores, genererArgumentsXAI } = await import('../../core/intelligence.mjs');
                
                const context = { discipline: course.discipline, prixCourse: course.prix, isQuinte: true };
                
                // Récupération historique pour la classe (Elite v43.3)
                const history = await getHorseHistory(p.nom, 5);
                const avgHistoryPrix = history.length > 0 ? history.reduce((sum, h) => sum + (h.prix || 0), 0) / history.length : 0;
                
                const cat_trend = await getCategoryTrend(p.nom, course.prix);
                const baseScores = await preparerBaseScores(p, context, avgHistoryPrix);
                const result = await calculerPredictionHybride(p, context, [], [], baseScores);
                const arguments_ia = genererArgumentsXAI(p, baseScores, cat_trend);

                return { 
                    ...p, 
                    score: result.score, 
                    cat_trend,
                    arguments_ia,
                    is_smart_money: p.cote_direct > 0 && p.cote_direct < (p.cote_ref * 0.85)
                };
            } catch (e) {
                logger.error(`Erreur calcul participant Quinté ${p.nom}: ${e.message}`);
                return { ...p, score: 0, cat_trend: 'STABLE' };
            }
        }));

        predictions.sort((a, b) => b.score - a.score);
        const selection = predictions.slice(0, 8); // Top 8 pour le Quinté Elite
        const tocard = predictions.slice(8).find(p => p.cote_ref > 15) || null;

        res.json({ course, selection, tocard });
    } catch (error) {
        logger.error(`API Error Quinté: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

async function getCategoryTrend(horseName, currentPrix) {
    try {
        const { getHorseHistory } = await import('../../core/db.mjs');
        const history = await getHorseHistory(horseName, 5);
        if (!history || history.length === 0) return 'STABLE';

        const avgHistoryPrix = history.reduce((sum, h) => sum + (h.prix || 0), 0) / history.length;
        if (avgHistoryPrix === 0) return 'STABLE';

        const diff = (currentPrix - avgHistoryPrix) / avgHistoryPrix;
        
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
        const { calculerPredictionHybride } = await import('../../core/hybrid.mjs');
        const { preparerBaseScores } = await import('../../core/intelligence.mjs');

        const enrichedParticipants = await Promise.all(participants.slice(0, 8).map(async p => {
            try {
                const context = { discipline: course.discipline, prixCourse: course.prix, terrain: course.terrain };
                
                // Récupération historique pour la classe (Elite v43.3)
                const { getHorseHistory } = await import('../../core/db.mjs');
                const history = await getHorseHistory(p.nom, 5);
                const avgHistoryPrix = history.length > 0 ? history.reduce((sum, h) => sum + (h.prix || 0), 0) / history.length : 0;
                
                const cat_trend = await getCategoryTrend(p.nom, course.prix);
                const { preparerBaseScores, genererArgumentsXAI } = await import('../../core/intelligence.mjs');
                const baseScores = await preparerBaseScores(p, context, avgHistoryPrix);
                
                // On simule un passage dans l'hybride pour récupérer les flags (V45)
                const result = await calculerPredictionHybride(p, context, [], [], baseScores);
                const arguments_ia = genererArgumentsXAI(p, baseScores, cat_trend);

                return {
                    ...p,
                    prediction_score: result.score || 0,
                    score: result.score || 0,
                    ia_score: result.score || 0,
                    baseScores,
                    cat_trend,
                    arguments_ia,
                    is_smart_money_alert: p.is_smart_money_alert || (p.cote_direct > 0 && p.cote_direct < p.cote_ref * 0.75)
                };
            } catch(e) {
                logger.error(`Erreur enrichissement modal pour ${p.nom}: ${e.message}`);
                return p;
            }
        }));

        // Enrichissement complet pour le modal
        res.json({
            course: {
                ...course,
                meteo: course.meteo ? JSON.parse(course.meteo) : null
            },
            participants: enrichedParticipants
        });
    } catch (error) {
        logger.error(`API Error Details: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getPepites(req, res) {
    try {
        const { getDB } = await import('../../db/db.mjs');
        const db = getDB();
        
        // v43.3 : Récupération directe des pépites via une jointure (Score IA >= 65 et Edge > 5%)
        // On récupère le meilleur participant (ia_score) pour chaque course récente/future
        const query = `
            SELECT p.*, c.*, p.nom as ia_nom, p.numero as ia_numero, p.prediction_score as ia_score, 
                   p.cote_ref as fav_cote, p.musique as ia_musique
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE p.prediction_score >= 65
            ORDER BY c.date DESC, c.heure ASC
            LIMIT 100
        `;

        db.all(query, [], async (err, rows) => {
            if (err) {
                logger.error(`DB Error Pépites: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }

            const pepites = rows.map(c => {
                const edge = parseFloat((c.ia_score / 100 - (1 / (c.fav_cote || 2))).toFixed(4)) * 100;
                const cote = parseFloat(c.fav_cote || 0);
                const coteDir = parseFloat(c.cote_direct || 0);
                
                // Fast computation of flags for the UI
                const is_smart_money_alert = cote > 0 && coteDir > 0 && ((cote - coteDir) / cote > 0.25);
                const is_swimmer = (c.terrain || '').includes('LOURD') && (c.terrain_prefere || '').includes('LOURD');
                const is_bad_draw = ((c.discipline || '').includes('PLAT') && parseInt(c.corde || 0) > 12) || 
                                    ((c.discipline || '').includes('TROT') && parseInt(c.recul || 0) > 0 && parseInt(c.distance || 2700) < 2800);
                const is_trap = cote > 0 && cote < 4.0 && parseInt(c.ia_score) < 50; // Approximé

                return {
                    ...c,
                    edge: edge.toFixed(1),
                    confidence: c.ia_score >= 75 ? 'ÉLITE' : 'STANDARD',
                    recommendation: edge > 10 ? 'MISE FORTE' : 'MISE MODÉRÉE',
                    is_smart_money_alert,
                    is_swimmer,
                    is_bad_draw,
                    is_trap
                };
            }).filter(p => p.edge > 5);

            res.json(pepites);
        });
    } catch (error) {
        logger.error(`API Error Pépites: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getPerformanceStats(req, res) {
    try {
        const { getDB } = await import('../../db/db.mjs');
        const db = getDB();
        
        // v43.3 : Calcul de performance basé sur les pépites réelles (Score >= 75)
        const query = `
            SELECT p.prediction_score, p.numero as ia_numero, c.ordre_arrivee, p.cote_ref
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE c.ordre_arrivee IS NOT NULL AND c.ordre_arrivee != ''
              AND p.prediction_score >= 75
        `;

        db.all(query, [], (err, rows) => {
            if (err) {
                logger.error(`DB Error Performance: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }

            let totalBets = 0;
            let totalWon = 0;
            let totalInvestment = 0;
            let totalReturn = 0;

            rows.forEach(row => {
                const winners = (row.ordre_arrivee || '').split(',').map(n => n.trim());
                totalBets++;
                totalInvestment += 10;
                
                if (winners[0] === row.ia_numero.toString()) {
                    totalWon++;
                    totalReturn += 10 * (row.cote_ref || 3.5);
                }
            });

            const winRate = totalBets > 0 ? (totalWon / totalBets) * 100 : 0;
            const roi = totalInvestment > 0 ? ((totalReturn - totalInvestment) / totalInvestment) * 100 : 0;

            res.json({
                totalBets,
                totalWon,
                winRate: winRate.toFixed(1),
                roi: roi.toFixed(1),
                profit: (totalReturn - totalInvestment).toFixed(2)
            });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
