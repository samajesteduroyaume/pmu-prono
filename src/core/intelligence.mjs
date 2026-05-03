import logger from '../utils/logger.mjs';
import { CONFIG } from '../config/settings.mjs';
import { determinerChangementCategorie, calculerRegularite } from '../utils/engine_utils.mjs';

// EXPORTS POUR COMPATIBILITÉ (FAÇADE)
export { determinerChangementCategorie, calculerRegularite };

import { calculateKellyMise } from './kelly.mjs';
import { getSynergyScore } from './db.mjs';
import { processAttelé } from './engines/attele_engine.mjs';
import { processMonté } from './engines/monte_engine.mjs';
import { processPlat } from './engines/plat_engine.mjs';
import { processObstacle } from './engines/obstacle_engine.mjs';
import { detectInconsistencies, applyCorrection } from './inconsistency_checker.mjs';
import { evaluerSignalGate } from './signal_gate.mjs';

/**
 * MOTEUR D'INTELLIGENCE ARTIFICIELLE "ARCHITECT v30 - ELITE"
 */


export function analyserFormeProfonde(musique, discipline = 'INCONNUE', avgHistoryPrix = 0) {
    if (!musique) return 20;

    // 1. Détection de "Rentrée" (Absence prolongée)
    let rentreeMalus = 0;
    const currentYear = new Date().getFullYear();
    const currentYearShort = currentYear % 100;
    
    const trimmedMusique = musique.trim();
    // Si la musique commence par une année entre parenthèses, le cheval n'a pas couru cette année
    if (trimmedMusique.startsWith('(')) {
        const firstYearMatch = trimmedMusique.match(/^\((\d+)\)/);
        if (firstYearMatch) {
            const lastRunYear = parseInt(firstYearMatch[1]);
            // Gestion robuste du changement de siècle
            const diff = (currentYearShort < lastRunYear) ? (currentYearShort + 100 - lastRunYear) : (currentYearShort - lastRunYear);
            
            if (diff > 1) rentreeMalus = CONFIG.architect.malus.rentreeLongue; 
            else if (diff === 1) rentreeMalus = CONFIG.architect.malus.rentreeSaisonniere;
        }
    }

    // 2. Analyse Séquentielle Profonde
    const cleanMusic = musique.replace(/\(\d+\)/g, '');
    const perfs = cleanMusic.match(/([0-9]|DA|DAI|Dist)[a-zA-Z]?/g) || [];

    if (perfs.length === 0) return Math.max(0, 30 - rentreeMalus);

    let score = 0;
    let totalWeight = 0;
    const depth = Math.min(perfs.length, 6); // Analyse sur 6 dernières courses

    const isTrot = discipline.includes('TROT') || discipline.includes('ATTELE') || discipline.includes('MONTE');

    // Bonus Victoire Récente (V27)
    let recentWinBonus = 0;

    for (let i = 0; i < depth; i++) {
        const perf = perfs[i];
        const type = perf.slice(-1).toLowerCase();
        const val = perf.slice(0, -1).toUpperCase();

        let points = 20;

        if (!isNaN(val)) {
            const place = parseInt(val);
            if (place === 1) {
                points = 120; // V27: Victoire valorisée (+20pts)
                if (i === 0) recentWinBonus = 15; // Bonus immédiat si dernière course gagnée
            }
            else if (place === 2) points = 90;
            else if (place === 3) points = 75;
            else if (place === 4) points = 60;
            else if (place === 5) points = 50;
            else if (place <= 7) points = 30; // V27: Top 7 reste correct
            else points = 10;
        } else {
            // Fautes spécialisées
            if (val === 'D' || val === 'DIST' || val === 'DAI') {
                points = isTrot ? CONFIG.architect.malus.trotDA : 5; // V27.1: Moins sévère pour laisser une chance aux opportunités (50 pts)
            } else if (val === 'A' || val === 'ARR') {
                points = 5;
            } else if (val === 'T' || val === 'TB') {
                points = 5;
            }
        }

        // Bonus Spécialisation (Discipline) - V31: Renforcé pour Spécialités
        const currentType = isTrot ? (discipline.includes('MONTE') ? 'm' : 'a') : (discipline.includes('PLAT') ? 'p' : (discipline.includes('HAIE') ? 'h' : 's'));
        if (type === currentType) {
            const specBonus = (discipline.includes('MONTE') || !isTrot) ? 1.25 : 1.15;
            points *= specBonus;
        }

        // Pondération Dégressive (La dernière perf compte le plus)
        // V27: Dégressivité plus marquée (0.8 au lieu de 0.85)
        const weight = Math.pow(CONFIG.architect.forme.decay, i);
        score += Math.min(130, points) * weight;
        totalWeight += weight;
    }

    // 3. Détection d'Irrégularité (v43.1)
    let irregularityMalus = 0;
    const recentRanks = perfs.slice(0, 3).map(p => {
        const val = p.slice(0, -1).toUpperCase();
        return isNaN(val) ? 10 : parseInt(val);
    });
    if (recentRanks.includes(1) && (recentRanks.includes(0) || recentRanks.some(r => r > 8))) {
        irregularityMalus = 15; // Cheval "Tout ou Rien"
    }

    const finalFormeScore = Math.round(score / totalWeight) + recentWinBonus;
    let baseResult = finalFormeScore - rentreeMalus - irregularityMalus;

    // V43.3: MULTIPLICATEUR DE CLASSE (Indice de Forme Dynamique)
    // On valorise la forme si elle a été acquise dans des courses à forte allocation
    if (avgHistoryPrix > 0) {
        const disciplineAvg = isTrot ? 25000 : 35000; // Moyennes estimées par discipline
        const classMultiplier = Math.min(1.3, Math.max(0.8, avgHistoryPrix / disciplineAvg));
        baseResult *= classMultiplier;
    }

    return Math.max(0, Math.min(100, Math.round(baseResult)));
}

export function analyserClasse(participant) {
    const age = parseInt(participant.age) || 5;
    const gains = parseFloat(participant.gains) || 0;
    if (age < 2) return 50;
    // V27: Formule ajustée pour mieux refléter la "valeur" intrinsèque
    const ratio = gains / (age * CONFIG.architect.classe.factor);
    return Math.min(Math.round(ratio * 60), 100) || 50;
}

export function analyserConfig(participant, discipline = '') {
    const isTrot = discipline.includes('TROT') || discipline.includes('ATTELE') || discipline.includes('MONTE');
    if (!isTrot) return 60; // Base neutre hors Trot

    let score = 50;
    const ferrage = (participant.ferrage || '').toUpperCase();

    // V27: Impact Déferrage renforcé
    if (ferrage.includes('D4')) score = 100; // Optimal
    else if (ferrage.includes('DA') || ferrage.includes('DP')) score = 80; // Bon
    else if (ferrage.includes('PL')) score = 65; // Plaqué (correct)

    return score;
}

// Les fonctions determinerChangementCategorie et calculerRegularite ont été déplacées dans src/utils/engine_utils.mjs

export function calculerScoreConfiance(cote) {
    let scoreConfiance = 50;
    const c = parseFloat(cote);
    if (!isNaN(c) && c > 0) {
        if (c < 2.0) scoreConfiance = 95;
        else if (c < 3.5) scoreConfiance = 85;
        else if (c < 7.0) scoreConfiance = 70;
        else if (c < 15.0) scoreConfiance = 45;
        else if (c < 30.0) scoreConfiance = 25;
        else scoreConfiance = 10;
    }
    return scoreConfiance;
}

export async function calculerScoreEntourage(participant) {
    const topDrivers = CONFIG.experts.drivers;
    const topTrainers = CONFIG.experts.trainers;
    
    const driverName = (participant.driver || '').toUpperCase();
    const trainerName = (participant.entraineur || '').toUpperCase();
    
    const isTopDriver = topDrivers.some(name => driverName.includes(name));
    const isTopTrainer = topTrainers.some(name => trainerName.includes(name));
    
    const isElite = isTopDriver && isTopTrainer;
    let scoreEntourage = isElite ? 98 : (isTopDriver || isTopTrainer ? 85 : 55);

    // V40: SYNERGIE D'ENTOURAGE (DYNAMIQUE)
    const synergyScore = await getSynergyScore(driverName, trainerName);
    if (synergyScore > 70) {
        scoreEntourage += 5;
        participant.has_synergy = true; 
    } else if (synergyScore < 40) {
        scoreEntourage -= 10;
    }

    if (participant.driverStats) {
        const winRate = (participant.driverStats.victoires / participant.driverStats.total_courses) * 100;
        const placeRate = (participant.driverStats.places / participant.driverStats.total_courses) * 100;
        if (participant.driverStats.total_courses > 5) {
            if (winRate > 20 || placeRate > 40) scoreEntourage += 10;
            else if (winRate === 0 && participant.driverStats.total_courses > 20) scoreEntourage -= 10;
        }
    }

    return Math.max(0, Math.min(100, scoreEntourage));
}

export async function preparerBaseScores(participant, contexteCourse, avgHistoryPrix = 0) {
    const disc = (contexteCourse.discipline || 'PLAT').toUpperCase();
    
    const scoreForme = analyserFormeProfonde(participant.musique, disc, avgHistoryPrix);
    const scoreClasse = analyserClasse(participant);
    const scoreConfig = analyserConfig(participant, disc);

    const scoreEntourage = await calculerScoreEntourage(participant);
    const scoreConfiance = calculerScoreConfiance(participant.cote_ref);

    return {
        forme: scoreForme,
        entourage: scoreEntourage,
        confiance: scoreConfiance,
        config: scoreConfig,
        aptitude: scoreClasse,
        avgPrix: (avgHistoryPrix / 1000).toFixed(1)
    };
}

export async function calculerPrediction(participant, contexteCourse, activePatterns = []) {
    try {
        const disc = (contexteCourse.discipline || 'PLAT').toUpperCase();
        const baseScores = await preparerBaseScores(participant, contexteCourse);
        const isElite = (baseScores.entourage >= 98); // Approximation pour le malus de catégorie


        // DÉLÉGATION AU MOTEUR SPÉCIALISÉ
        let engineResult;
        if (disc.includes('MONTE')) {
            engineResult = await processMonté(participant, contexteCourse, baseScores);
        } else if (disc.includes('ATTELE') || disc.includes('TROT')) {
            engineResult = await processAttelé(participant, contexteCourse, baseScores);
        } else if (disc.includes('PLAT')) {
            engineResult = await processPlat(participant, contexteCourse, baseScores);
        } else if (disc.includes('HAIE') || disc.includes('STEEPLE') || disc.includes('CROSS') || disc.includes('OBSTACLE')) {
            engineResult = await processObstacle(participant, contexteCourse, baseScores);
        } else {
            // Moteur par défaut (Fallback)
            let discKey = 'DEFAULT';
            if (disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE')) discKey = 'TROT';
            else if (disc.includes('PLAT')) discKey = 'PLAT';
            else if (disc.includes('OBSTACLE') || disc.includes('HAIE') || disc.includes('STEEPLE') || disc.includes('CROSS')) discKey = 'OBSTACLE';
            
            const weights = CONFIG.weights[discKey];
            engineResult = {
                engine: 'ARCHITECT-GENERIC v30',
                finalScore: Math.round(
                    (baseScores.forme * weights.FORME) +
                    (baseScores.entourage * weights.ENTOURAGE) +
                    (baseScores.confiance * weights.CONFIANCE) +
                    (baseScores.config * weights.CONFIGURATION) +
                    (baseScores.aptitude * weights.APTITUDE) +
                    (50 * (weights.EXPERT || 0)) // Base d'expertise neutre (50) pour le générique
                )
            };
        }

        let predictionScore = engineResult.finalScore;
        participant.active_engine = engineResult.engine; // Pour le frontend

        // V40: INTELLIGENCE ÉMOTIONNELLE (AVIS)
        const avis = (participant.avis || '').toUpperCase();
        if (avis === 'POSITIF') {
            predictionScore += 5;
            logger.info(`[IA] SENTIMENT POSITIF: +5 pts pour ${participant.nom}`);
        } else if (avis === 'NEGATIF') {
            predictionScore -= 15;
            logger.info(`[IA] SENTIMENT NEGATIF: -15 pts pour ${participant.nom}`);
        }

        // V33 - "THE SHIELD" SHUTDOWN LOGIC
        // Si le bonus d'expertise est très négatif, on neutralise le cheval (Score < 30)
        if (engineResult.expertiseBonus <= -30) {
            logger.info(`[IA] SHIELD SHUTDOWN: ${participant.nom} neutralisé (Expertise Malus: ${engineResult.expertiseBonus})`);
            predictionScore = Math.min(predictionScore, 30);
            participant.is_shielded = true; // Flag frontend
        }

        // V30: MALUS DE CATÉGORIE (PROGRESSIF)
        const cat = determinerChangementCategorie(participant, contexteCourse.prixCourse || 20000);
        if (cat === 'MONTEE' && !isElite && predictionScore > 70) {
            const malus = Math.min(15, (predictionScore - 70)); 
            logger.info(`[IA] CAT-MALUS v30: -${malus} pts pour ${participant.nom} (Montée de cat)`);
            predictionScore -= malus;
        }

        // V29: AJUSTEMENT PAR PATTERNS OPTIMISÉS
        if (activePatterns && activePatterns.length > 0) {
            activePatterns.forEach(p => {
                if (p.type === 'GOLDEN_PATTERN') {
                    const bonus = Math.min(15, p.roi / 5);
                    predictionScore += bonus;
                } else if (p.type === 'DANGER_PATTERN') {
                    predictionScore -= 20;
                }
            });
        }

        // V27: STRATÉGIE FINANCIÈRE (KELLY)
        const cote = parseFloat(participant.cote_ref);
        if (cote > 1) {
            // V40: CALCUL DE L'EDGE (IA vs MARCHÉ)
            const iaProb = predictionScore / 100;
            const marketProb = 1 / cote;
            const edge = (iaProb - marketProb) * 100;
            
            participant.edge_stat = parseFloat(edge.toFixed(2));
            participant.market_prob = parseFloat((marketProb * 100).toFixed(2));

            const kelly = calculateKellyMise(cote, predictionScore, 1000);
            participant.kelly_suggestion = kelly;
        }

        // V42: DÉTECTION DES INCOHÉRENCES ET CORRECTION FINALE
        const alerts = detectInconsistencies(participant, contexteCourse, baseScores, predictionScore);
        if (alerts.length > 0) {
            predictionScore = applyCorrection(predictionScore, alerts);
            participant.inconsistency_alerts = alerts; // Pour affichage UI
            participant.is_inconsistent = true;
        }

        // V43: SIGNAL GATE — Évaluation multi-signaux
        const gate = evaluerSignalGate(participant, contexteCourse, predictionScore);
        participant.signal_gate = gate; // Pour affichage UI et Value Hunter

        return Math.round(Math.max(0, Math.min(100, predictionScore)));

    } catch (e) {
        logger.error(`IA Architecture v40 Error: ${e.message}`);
        return 50;
    }
}

/**
 * V43.3: GÉNÉRATEUR D'ARGUMENTS XAI
 * Produit des justifications textuelles basées sur les vecteurs de performance
 */
export function genererArgumentsXAI(participant, baseScores, cat_trend) {
    const arguments_ia = [];
    
    // Analyse de la Forme
    if (baseScores.forme >= 85) arguments_ia.push("Forme étincelante (série de performances elite)");
    else if (baseScores.forme >= 70) arguments_ia.push("En condition ascendante (forme solide)");
    
    // Analyse de l'Entourage
    if (baseScores.entourage >= 95) arguments_ia.push("Duo Driver/Entraîneur au sommet (synergie maximale)");
    else if (participant.has_synergy) arguments_ia.push("Excellente synergie historique entre l'entourage");
    
    // Analyse de la Catégorie
    if (cat_trend === 'DOWN') arguments_ia.push("Engagement visé : descend de catégorie (lot abordable)");
    else if (cat_trend === 'UP' && baseScores.forme >= 80) arguments_ia.push("Tente sa chance au niveau supérieur (confiance entourage)");
    
    // Analyse de la Configuration
    if (baseScores.config >= 90) arguments_ia.push("Configuration de ferrage optimale (déferré des 4)");
    
    // Analyse du Sentiment
    const avis = (participant.avis || '').toUpperCase();
    if (avis === 'POSITIF') arguments_ia.push("Sentiment de l'entourage très favorable");

    // Fallback si pas assez d'arguments
    if (arguments_ia.length === 0) arguments_ia.push("Profil équilibré et régulier pour ce lot");
    
    return arguments_ia.slice(0, 3); // Top 3 arguments
}

/**
 * V40: CALCUL DE L'EDGE (DIFFÉRENTIEL DE SCORE)
 * Identifie l'écart entre le premier et le second favoris IA
 */
export function calculerEdge(predictions) {
    if (!predictions || predictions.length < 2) return { edge: 0, label: 'PRUDENCE' };
    
    const sorted = [...predictions].sort((a, b) => b.score - a.score);
    const top1 = sorted[0];
    const top2 = sorted[1];
    
    const edge = top1.score - top2.score;
    let label = 'VALEUR';
    
    if (edge > 20) label = 'ULTRA-CONFIDENCE';
    else if (edge > 10) label = 'SOLIDE';
    else if (edge < 3) label = 'INCERTAIN';
    
    return {
        edge,
        label,
        top1: top1.nom,
        diff: edge
    };
}
