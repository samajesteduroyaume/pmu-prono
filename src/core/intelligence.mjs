import logger from '../utils/logger.mjs';
import { calculateKellyMise } from './kelly.mjs';
import { processAttelé } from './engines/attele_engine.mjs';
import { processMonté } from './engines/monte_engine.mjs';
import { processPlat } from './engines/plat_engine.mjs';
import { processObstacle } from './engines/obstacle_engine.mjs';

/**
 * MOTEUR D'INTELLIGENCE ARTIFICIELLE "ARCHITECT v26 - UNIFIÉ"
 */

const WEIGHTS_BY_DISCIPLINE = {
    'TROT': { FORME: 0.20, ENTOURAGE: 0.25, CONFIANCE: 0.10, CONFIGURATION: 0.30, APTITUDE: 0.10, EXPERT: 0.05 },
    'PLAT': { FORME: 0.25, ENTOURAGE: 0.15, CONFIANCE: 0.15, CONFIGURATION: 0.05, APTITUDE: 0.30, EXPERT: 0.10 },
    'OBSTACLE': { FORME: 0.20, ENTOURAGE: 0.25, CONFIANCE: 0.05, CONFIGURATION: 0.30, APTITUDE: 0.15, EXPERT: 0.05 },
    'DEFAULT': { FORME: 0.25, ENTOURAGE: 0.20, CONFIANCE: 0.15, CONFIGURATION: 0.15, APTITUDE: 0.15, EXPERT: 0.10 }
};

function analyserFormeProfonde(musique, discipline = 'INCONNUE') {
    if (!musique) return 20;

    // 1. Détection de "Rentrée" (Absence prolongée)
    let rentreeMalus = 0;
    const years = musique.match(/\((\d+)\)/g);
    if (years && years.length > 0) {
        const lastYear = parseInt(years[years.length - 1].replace(/[()]/g, ''));
        if (lastYear < 25) rentreeMalus = 30;
        else if (lastYear === 25) rentreeMalus = 10;
    }

    // 2. Analyse Séquentielle Profonde
    const cleanMusic = musique.replace(/\(\d+\)/g, '');
    const perfs = cleanMusic.match(/([0-9DA]|Dist)[a-zA-Z]/g) || [];

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
                points = isTrot ? 0 : 5; // V27: Disqualification au Trot = 0 point (SÉVÈRE)
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
        const weight = Math.pow(0.8, i);
        score += Math.min(130, points) * weight;
        totalWeight += weight;
    }

    const finalFormeScore = Math.round(score / totalWeight) + recentWinBonus;
    return Math.max(0, Math.min(100, finalFormeScore - rentreeMalus));
}

function analyserClasse(participant) {
    const age = parseInt(participant.age) || 5;
    const gains = parseFloat(participant.gains) || 0;
    if (age < 2) return 50;
    // V27: Formule ajustée pour mieux refléter la "valeur" intrinsèque
    const ratio = gains / (age * 15000);
    return Math.min(Math.round(ratio * 60), 100) || 50;
}

function analyserConfig(participant, discipline = '') {
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

export function determinerChangementCategorie(participant, prixCourse) {
    if (!participant.nb_courses || participant.nb_courses < 3) return 'STABLE';
    const gainMoyen = participant.gains / participant.nb_courses;
    if (gainMoyen > prixCourse * 0.8) return 'DESCENTE'; // V27: Seuil ajusté
    if (gainMoyen < (prixCourse / 10)) return 'MONTEE';
    return 'STABLE';
}

export function calculerRegularite(participant) {
    if (!participant.nb_courses || participant.nb_courses === 0) return 0;
    const totalPlaces = (participant.nb_victoires || 0) + (participant.nb_places || 0);
    return Math.round((totalPlaces / participant.nb_courses) * 100);
}

export function calculerExpertImpact(p, contexte) {
    let bonus = 0;
    const prix = contexte.prixCourse || 20000;
    const cat = determinerChangementCategorie(p, prix);
    if (cat === 'DESCENTE') bonus += 25; // V27: Bonus Descente renforcé
    else if (cat === 'MONTEE') bonus -= 15;

    const reg = calculerRegularite(p);
    if (reg > 50) bonus += 20; // V27: Prime à la régularité

    if (p.oeilleres && p.oeilleres !== 'SANS_OEILLERES') bonus += 10;

    return Math.max(0, Math.min(100, 50 + bonus));
}

export async function calculerPrediction(participant, contexteCourse, activePatterns = []) {
    try {
        const disc = (contexteCourse.discipline || 'PLAT').toUpperCase();
        let discKey = 'DEFAULT';
        if (disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE')) discKey = 'TROT';
        else if (disc.includes('PLAT')) discKey = 'PLAT';
        else if (disc.includes('OBSTACLE') || disc.includes('HAIE') || disc.includes('STEEPLE')) discKey = 'OBSTACLE';

        // PRÉ-CALCUL DES SCORES DE BASE (COMMUNS)
        const scoreForme = analyserFormeProfonde(participant.musique, disc);
        const scoreClasse = analyserClasse(participant);
        const scoreConfig = analyserConfig(participant, disc);

        const topEntourage = ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'BARZALONA', 'SOUMILLON', 'GUYON', 'PASQUIER', 'DEMURO', 'MOUROT', 'MOTTIER', 'GELORMINI', 'LAGADEUC'];
        const entourageName = `${(participant.driver || '').toUpperCase()} ${(participant.entraineur || '').toUpperCase()}`;
        const isTop = topEntourage.some(name => entourageName.includes(name));
        let scoreEntourage = isTop ? 95 : 55;

        if (participant.driverStats) {
            const winRate = (participant.driverStats.victoires / participant.driverStats.total_courses) * 100;
            const placeRate = (participant.driverStats.places / participant.driverStats.total_courses) * 100;
            if (participant.driverStats.total_courses > 5) {
                if (winRate > 20 || placeRate > 40) scoreEntourage += 10;
                else if (winRate === 0 && participant.driverStats.total_courses > 20) scoreEntourage -= 10;
            }
        }

        const cote = parseFloat(participant.cote_ref);
        let scoreConfiance = 50;
        if (!isNaN(cote) && cote > 0) {
            if (cote < 3.0) scoreConfiance = 60;
            else if (cote < 7.0) scoreConfiance = 90;
            else if (cote < 15.0) scoreConfiance = 50;
            else if (cote < 30.0) scoreConfiance = 30;
            else scoreConfiance = 15;
        }

        const baseScores = {
            forme: scoreForme,
            entourage: scoreEntourage,
            confiance: scoreConfiance,
            config: scoreConfig,
            aptitude: scoreClasse
        };

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
            engineResult = {
                engine: 'GENERIC V32',
                finalScore: Math.round(
                    (scoreForme * weights.FORME) +
                    (scoreEntourage * weights.ENTOURAGE) +
                    (scoreConfiance * weights.CONFIANCE) +
                    (scoreConfig * weights.CONFIGURATION) +
                    (scoreClasse * weights.APTITUDE)
                )
            };
        }

        let predictionScore = engineResult.finalScore;
        participant.active_engine = engineResult.engine; // Pour le frontend

        // V30: CENSURE TECHNIQUE (PLAFONNAGE)
        const cat = determinerChangementCategorie(participant, contexteCourse.prixCourse || 20000);
        if (cat === 'MONTEE' && !isTop && predictionScore > 75) {
            logger.info(`[IA] CENSURE V32: Plafonnage score (${predictionScore} -> 74) pour ${participant.nom}`);
            predictionScore = 74;
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
        if (cote > 1) {
            const kelly = calculateKellyMise(cote, predictionScore, 1000);
            participant.kelly_suggestion = kelly;
        }

        return Math.round(predictionScore);

    } catch (e) {
        logger.error(`IA Architecture v27 Error: ${e.message}`);
        return 50;
    }
}
