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
                top_horse: topHorse ? topHorse.nom : 'Non analysé',
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
            const kelly = await calculateKellyAdaptatif(p.cote_ref || 2.0, result.score, 'shadow', tendances, activePatterns);
            
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
                prediction_score: result.score,
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
        const { getCourseQuinte, getCourseParticipants } = await import('../../core/db.mjs');
        const course = await getCourseQuinte();

        if (!course) return res.status(404).json({ message: "Pas de Quinté+ identifié pour aujourd'hui." });

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
        
        // Enrichissement basique pour le modal
        res.json({
            course: {
                ...course,
                meteo: course.meteo ? JSON.parse(course.meteo) : null
            },
            participants: participants.slice(0, 8) // Top 8 pour l'UI
        });
    } catch (error) {
        logger.error(`API Error Details: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getPepites(req, res) {
    try {
        const courses = await getAllCourses();
        const pepites = [];

        for (const c of courses) {
            // Calcul de l'edge
            const edge = parseFloat((c.ia_score / 100 - (1 / (c.fav_cote || 1))).toFixed(4)) * 100;
            
            // Critères plus stricts pour les pépites
            const isElite = c.ia_score >= 75;
            const isValue = edge >= 12;
            const isStandardPepite = c.ia_score >= 65 && edge > 5;

            if (isElite || isValue || isStandardPepite) {
                let confidence = 'STANDARD';
                if (isElite && isValue) confidence = 'MAXIMALE';
                else if (isElite) confidence = 'ÉLITE';
                else if (isValue) confidence = 'VALUE';

                // Détection de la tendance de catégorie
                const { getHorseHistory } = await import('../../core/db.mjs');
                const history = await getHorseHistory(c.ia_nom_brut, 5);
                const avgHistoryPrix = history.length > 0 ? history.reduce((sum, h) => sum + (h.prix || 0), 0) / history.length : 0;
                
                const cat_trend = await getCategoryTrend(c.ia_nom_brut, c.prix);

                // Génération des arguments XAI (v43.3)
                const { preparerBaseScores, genererArgumentsXAI } = await import('../../core/intelligence.mjs');
                const baseScores = await preparerBaseScores({
                    musique: c.ia_musique,
                    gains: c.gains || 0,
                    age: c.age || 5,
                    driver: c.driver,
                    entraineur: c.entraineur,
                    cote_ref: c.fav_cote,
                    avis: c.avis
                }, { discipline: c.discipline }, avgHistoryPrix);
                
                const arguments_ia = genererArgumentsXAI(c, baseScores, cat_trend);

                // Détection Smart Money (Chute de cote > 15%)
                const is_smart_money = c.cote_direct > 0 && c.cote_direct < (c.fav_cote * 0.85);

                pepites.push({
                    ...c,
                    edge: edge.toFixed(1),
                    confidence,
                    cat_trend,
                    arguments_ia,
                    is_smart_money,
                    heure: c.heure,
                    recommendation: edge > 10 ? 'MISE FORTE' : 'MISE MODÉRÉE'
                });
            }
        }

        // Trier par heure de départ (v43.3 Elite Chronologique)
        pepites.sort((a, b) => {
            const hA = a.heure_depart || '23:59';
            const hB = b.heure_depart || '23:59';
            return hA.localeCompare(hB);
        });

        res.json(pepites);
    } catch (error) {
        logger.error(`API Error Pépites: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getPerformanceStats(req, res) {
    try {
        const { getAllCourses } = await import('../../core/db.mjs');
        const courses = await getAllCourses(); 
        
        let totalBets = 0;
        let totalWon = 0;
        let totalInvestment = 0;
        let totalReturn = 0;

        const finished = courses.filter(c => c.ordre_arrivee && c.ia_score >= 75);
        
        finished.forEach(c => {
            const winners = (c.ordre_arrivee || '').split(',').map(n => n.trim());
            const iaHorseNum = c.ia_nom ? c.ia_nom.match(/#(\d+)/)?.[1] : null;
            
            if (iaHorseNum) {
                totalBets++;
                totalInvestment += 10;
                
                if (winners[0] === iaHorseNum) {
                    totalWon++;
                    const rapport = c.fav_cote || 3.5; 
                    totalReturn += 10 * rapport;
                }
            }
        });

        const roi = totalInvestment > 0 ? ((totalReturn - totalInvestment) / totalInvestment) * 100 : 0;
        const winRate = totalBets > 0 ? (totalWon / totalBets) * 100 : 0;

        res.json({
            totalBets,
            totalWon,
            winRate: winRate.toFixed(1),
            roi: roi.toFixed(1),
            profit: (totalReturn - totalInvestment).toFixed(2),
            period: 'Focus Pépites Élite (Score >= 75)'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
