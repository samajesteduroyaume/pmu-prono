import { getAllCourses, getCourseParticipants, recordShadowBet } from './db.mjs';
import { calculerPredictionHybride } from './hybrid.mjs';
import { calculateKellyAdaptatif, calibrateProbability } from './kelly.mjs';
import CONFIG from '../config/settings.mjs';
import logger from '../utils/logger.mjs';

const VH_CONFIG = CONFIG.engine_settings.value_hunter;
const FINANCE = CONFIG.engine_settings.finance;

/**
 * VALUE HUNTER v27.1
 * Extrait les pépites selon les réglages Architect.
 */
export async function detectOpportunities(date = new Date().toISOString().split('T')[0]) {
    logger.header(`--- VALUE HUNTER : RECHERCHE DU ${date} ---`);
    
    const courses = await getAllCourses();
    const todayCourses = courses.filter(c => c.date === date && VH_CONFIG.target_disciplines.includes(c.discipline));
    
    logger.info(`${todayCourses.length} courses (${VH_CONFIG.target_disciplines.join(', ')}) identifiées.`);
    
    const opportunities = [];

    for (const course of todayCourses) {
        const participants = await getCourseParticipants(course.id);
        
        for (const p of participants) {
            // 1. Calcul Prediction
            const prediction = await calculerPredictionHybride(p, { discipline: course.discipline });
            
            // 2. Calcul Kelly & Value
            const cote = p.cote_ref || 2.0;
            const probaCalibree = calibrateProbability(prediction.score);
            
            // V30: Détection Smart Money (Logic: Si la cote est anormalement basse par rapport à la proba IA, ça "pousse")
            // Ou si on avait un historique de cotes (recordCoteHistorique), on comparerait l'évolution.
            // Ici on va simuler une détection de "pression" si Edge est très positif mais la cote baisse.
            const marketProb = 1 / cote;
            const edge = probaCalibree - marketProb;
            
            const isSmartMoney = (prediction.score > 70 && cote < 3.0) || (edge > 0.15);

            const kelly = await calculateKellyAdaptatif(cote, prediction.score, FINANCE.bankroll_default);
            
            // 3. Identification de la Value Pro
            // On durcit les conditions : Edge minimum de 5%
            if (kelly.mise > 0 && edge > VH_CONFIG.min_edge_value) {
                const opp = {
                    date: date,
                    reunion: course.reunionNum,
                    course: course.courseNum,
                    participant_id: p.id,
                    nom: p.nom,
                    cote: cote,
                    score: prediction.score,
                    proba: probaCalibree,
                    edge: edge,
                    mise: kelly.mise,
                    advice: kelly.advice,
                    is_smart_money: isSmartMoney,
                    confidence: Math.round(probaCalibree * 100)
                };
                
                opportunities.push(opp);
                
                // Enregistrement automatique en Shadow Bet
                try {
                    await recordShadowBet(opp);
                    if (isSmartMoney) {
                        logger.success(`[SMART MONEY] Détecté sur ${p.nom} ! Edge: ${(edge*100).toFixed(1)}%`);
                    } else {
                        logger.success(`[VALUE] Opportunité trouvée : ${p.nom} (Edge: ${(edge*100).toFixed(1)}%)`);
                    }
                } catch (e) {
                    logger.error(`Erreur shadow recording: ${e.message}`);
                }
            }
        }
    }

    logger.info(`Analyse terminée. ${opportunities.length} opportunités de "Value" trouvées.`);
    return opportunities;
}
