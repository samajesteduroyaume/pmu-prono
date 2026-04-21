import { getAllCourses, getCourseParticipants, recordShadowBet } from './db.mjs';
import { calculerPredictionHybride } from './hybrid.mjs';
import { calculateKellyAdaptatif, calibrateProbability } from './kelly.mjs';
import CONFIG from '../config/settings.mjs';
import logger from '../utils/logger.mjs';

const VH_CONFIG = CONFIG.engine_settings.value_hunter;
const FINANCE = CONFIG.engine_settings.finance;

/**
 * VALUE HUNTER v43
 * Filtre strict : Edge > 8%, cote 2.5-12, zéro incohérence, Signal Gate ≥ 3/5
 */
export async function detectOpportunities(date = new Date().toISOString().split('T')[0]) {
    logger.header(`--- VALUE HUNTER v43 : RECHERCHE DU ${date} ---`);
    
    const courses = await getAllCourses();
    const todayCourses = courses.filter(c => c.date === date && VH_CONFIG.target_disciplines.includes(c.discipline));
    
    logger.info(`${todayCourses.length} courses (${VH_CONFIG.target_disciplines.join(', ')}) identifiées.`);
    
    const opportunities = [];

    for (const course of todayCourses) {
        const participants = await getCourseParticipants(course.id);
        
        for (const p of participants) {
            // 1. Calcul Prediction (enrichit le participant avec signal_gate et is_inconsistent)
            const prediction = await calculerPredictionHybride(p, { discipline: course.discipline });
            
            const cote = parseFloat(p.cote_ref) || 2.0;
            const probaCalibree = calibrateProbability(prediction.score);
            const marketProb = 1 / cote;
            const edge = probaCalibree - marketProb;
            
            // --- FILTRES V43 STRICTS ---

            // Filtre 1 : Score IA minimum
            if (prediction.score < VH_CONFIG.min_score) continue;

            // Filtre 2 : Cote dans la zone de valeur (2.5 - 12)
            if (cote < VH_CONFIG.min_cote || cote > VH_CONFIG.max_cote) continue;

            // Filtre 3 : Edge minimum 8%
            if (edge <= VH_CONFIG.min_edge_value) continue;

            // Filtre 4 : Aucune incohérence détectée
            if (VH_CONFIG.require_no_inconsistency && p.is_inconsistent) {
                logger.info(`[VALUE HUNTER] Rejeté (incohérence) : ${p.nom}`);
                continue;
            }

            // Filtre 5 : Signal Gate — minimum 3/5 signaux positifs
            const gate = p.signal_gate;
            if (gate && !gate.go) {
                logger.info(`[VALUE HUNTER] Rejeté (Signal Gate ${gate.score}/5) : ${p.nom}`);
                continue;
            }

            // Détection Smart Money (baisse de cote > 20%)
            const isSmartMoney = edge > 0.15 || (prediction.score > 70 && cote < 4.0);

            const kelly = await calculateKellyAdaptatif(cote, prediction.score, FINANCE.bankroll_default);
            if (kelly.mise <= 0) continue;

            const opp = {
                date: date,
                reunion: course.reunionNum,
                course: course.courseNum,
                participant_id: p.id,
                nom: p.nom,
                cote: cote,
                score: prediction.score,
                proba: probaCalibree,
                edge: parseFloat((edge * 100).toFixed(2)),
                mise: kelly.mise,
                advice: kelly.advice,
                is_smart_money: isSmartMoney,
                confidence: Math.round(probaCalibree * 100),
                signal_gate: gate
            };
            
            opportunities.push(opp);
            
            try {
                await recordShadowBet(opp);
                const tag = isSmartMoney ? '[SMART MONEY] 🔥' : '[VALUE ✅]';
                logger.success(`${tag} ${p.nom} | Cote: ${cote} | Edge: ${(edge*100).toFixed(1)}% | Gate: ${gate?.recommendation || 'N/A'}`);
            } catch (e) {
                logger.error(`Erreur shadow recording: ${e.message}`);
            }
        }
    }

    logger.info(`Analyse terminée. ${opportunities.length} opportunités filtrées (v43 strict).`);
    return opportunities;
}

