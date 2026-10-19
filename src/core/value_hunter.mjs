import { getAllCourses, getCourseParticipants, recordShadowBet } from './db.mjs';
import { calculerPredictionHybride, getMLMetadata } from './hybrid.mjs';
import { calculateKellyAdaptatif, calibrateProbability, refreshProspectiveCalibration } from './kelly.mjs';
import CONFIG from '../config/settings.mjs';
import logger from '../utils/logger.mjs';
import { formatDate, formatHeure } from '../utils/dateUtils.mjs';

const VH_CONFIG = CONFIG.engine_settings.value_hunter;
const FINANCE = CONFIG.engine_settings.finance;

function isCourseStillUpcoming(course, today, now) {
    if (course.date > today) return true;
    if (course.date !== today) return false;

    const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(String(course.heure || '').trim());
    if (!match) return false;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23) return false;
    const [nowHour, nowMinute] = now.split(':').map(Number);
    if (!Number.isInteger(nowHour) || !Number.isInteger(nowMinute)) return false;
    return hour * 60 + minute > nowHour * 60 + nowMinute;
}

/**
 * VALUE HUNTER v43
 * Filtre strict : Edge > 5% (min_edge_value), cote 2.5-15, zéro incohérence, Signal Gate ≥ 3/6
 * fix v48.1: commentaire corrigé (Edge > 8% était inexact, le seuil réel est min_edge_value = 0.05 = 5%)
 */
export async function detectOpportunities(date = formatDate(new Date())) {
    logger.header(`--- VALUE HUNTER v43 : RECHERCHE DU ${date} ---`);
    const version = getMLMetadata()?.version || 'heuristic-fallback';
    const calibration = await refreshProspectiveCalibration(version);
    if (calibration.samples < 100) logger.warn(`[VALUE HUNTER] Calibration désactivée : ${calibration.samples}/100 courses prospectives réglées pour ${version}.`);
    
    const courses = await getAllCourses();
    const today = formatDate(new Date());
    const now = formatHeure(new Date());
    const todayCourses = courses.filter(c => c.date === date
        && VH_CONFIG.target_disciplines.includes(c.discipline)
        && isCourseStillUpcoming(c, today, now));
    
    logger.info(`${todayCourses.length} courses (${VH_CONFIG.target_disciplines.join(', ')}) identifiées.`);
    
    const opportunities = [];

    for (const course of todayCourses) {
        const status = String(course.statut || '').toUpperCase();
        if (course.ordre_arrivee || /ARRIV|TERMINE|FIN_COURSE|EN_COURS|PARTI|DEPART|ANNULE|NON_PARTANT/.test(status)) continue;
        const participants = (await getCourseParticipants(course.id)).filter(p =>
            !['NON_PARTANT', 'NON-PARTANT', 'NON PARTANT', 'FORFAIT', 'NP', 'ABANDONNE', 'DISQUALIFIE', 'RETIRE']
                .includes(String(p.statut || '').trim().toUpperCase())
        );
        if (!participants.length) continue;

        const courseContext = {
            discipline: course.discipline,
            prixCourse: course.prix || 0,
            distance: course.distance,
            terrain: course.terrain,
            corde: course.corde
        };
        const scoredRunners = await Promise.all(participants.map(async p => {
            try {
                return { participant: p, prediction: await calculerPredictionHybride(p, courseContext, [], participants) };
            } catch (error) {
                logger.error(`[VALUE HUNTER] Pronostic indisponible pour ${p.nom}: ${error.message}`);
                return null;
            }
        }));
        // Sans tous les scores, impossible de confirmer quel cheval est réellement premier.
        if (scoredRunners.some(runner => runner === null)) continue;
        // La calibration prospective est entraînée sur les meilleurs choix IA
        // (rang 1) : garder un seul candidat par course respecte cet échantillon.
        const { participant: p, prediction } = scoredRunners.reduce((best, current) =>
            current.prediction.score > best.prediction.score ? current : best
        );
            const cote = Number(p.cote_ref);
            // An assumed price invents an edge. Only work from a valid live market quote.
            if (!Number.isFinite(cote) || cote <= 1) continue;
            const probaCalibree = calibrateProbability(prediction.score);
            if (probaCalibree === null) continue;
            const marketTotal = participants.reduce((sum, runner) => {
                const odds = Number(runner.cote_ref);
                return sum + (odds > 1 ? 1 / odds : 0);
            }, 0);
            const marketProb = marketTotal > 0 ? (1 / cote) / marketTotal : 1 / cote;
            const edge = probaCalibree - marketProb;
            
            // --- FILTRES V43 STRICTS ---

            // Filtre 1 : Score IA minimum
            if (prediction.score < VH_CONFIG.min_score) continue;

            // Filtre 2 : Cote dans la zone de valeur (2.5 - 15)
            if (cote < VH_CONFIG.min_cote || cote > VH_CONFIG.max_cote) continue;

            // Filtre 3 : Edge minimum
            if (edge <= VH_CONFIG.min_edge_value) continue;

            // Filtre 4 : Aucune incohérence détectée
            if (VH_CONFIG.require_no_inconsistency && p.is_inconsistent) {
                logger.info(`[VALUE HUNTER] Rejeté (incohérence) : ${p.nom}`);
                continue;
            }

            // Filtre 5 : Signal Gate — minimum 3/6 signaux positifs
            const gate = p.signal_gate;
            if (!gate?.go) {
                logger.info(`[VALUE HUNTER] Rejeté (Signal Gate absent ou insuffisant${gate ? ` ${gate.score}/6` : ''}) : ${p.nom}`);
                continue;
            }

            // Signal de valeur renforcé
            const isValueSignal = edge > 0.15 || (prediction.score > 70 && cote < 4.0);

            const kelly = await calculateKellyAdaptatif(p, prediction.score, FINANCE.bankroll_default);
            if (kelly.mise <= 0) continue;

            const opp = {
                date: date,
                course_id: course.id,
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
                is_value_signal: isValueSignal,
                confidence: Math.round(probaCalibree * 100),
                signal_gate: gate,
                heure: course.heure
            };
            
            opportunities.push(opp);
            
            try {
                await recordShadowBet(opp);
                const tag = isValueSignal ? '[VALUE FORTE ✅]' : '[VALUE ✅]';
                logger.success(`${tag} ${p.nom} | Cote: ${cote} | Edge: ${(edge*100).toFixed(1)}% | Gate: ${gate?.recommendation || 'N/A'}`);
            } catch (e) {
                logger.error(`Erreur shadow recording: ${e.message}`);
            }
    }

    // Trier par heure (v43.3 Chronologique)
    opportunities.sort((a, b) => {
        const hA = a.heure || '23:59';
        const hB = b.heure || '23:59';
        return hA.localeCompare(hB);
    });

    logger.info(`Analyse terminée. ${opportunities.length} opportunités filtrées (v43 strict).`);
    return opportunities;
}

