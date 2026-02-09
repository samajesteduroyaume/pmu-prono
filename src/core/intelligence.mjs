import logger from '../utils/logger.mjs';
import { calculateKellyMise } from './kelly.mjs';

/**
 * MOTEUR D'INTELLIGENCE ARTIFICIELLE "ARCHITECT v26 - UNIFIÉ"
 */

const WEIGHTS_BY_DISCIPLINE = {
    'TROT': { FORME: 0.25, ENTOURAGE: 0.25, CONFIANCE: 0.20, CONFIGURATION: 0.20, APTITUDE: 0.05, EXPERT: 0.05 },
    'PLAT': { FORME: 0.40, ENTOURAGE: 0.15, CONFIANCE: 0.25, CONFIGURATION: 0.05, APTITUDE: 0.10, EXPERT: 0.05 },
    'OBSTACLE': { FORME: 0.35, ENTOURAGE: 0.20, CONFIANCE: 0.15, CONFIGURATION: 0.10, APTITUDE: 0.10, EXPERT: 0.10 },
    'DEFAULT': { FORME: 0.30, ENTOURAGE: 0.20, CONFIANCE: 0.20, CONFIGURATION: 0.10, APTITUDE: 0.10, EXPERT: 0.10 }
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

        // Bonus Spécialisation (Discipline)
        const currentType = isTrot ? (discipline.includes('MONTE') ? 'm' : 'a') : (discipline.includes('PLAT') ? 'p' : (discipline.includes('HAIE') ? 'h' : 's'));
        if (type === currentType) points *= 1.15;

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

export function calculerPrediction(participant, contexteCourse, activePatterns = []) {
    try {
        const disc = (contexteCourse.discipline || 'PLAT').toUpperCase();
        let discKey = 'DEFAULT';
        if (disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE')) discKey = 'TROT';
        else if (disc.includes('PLAT')) discKey = 'PLAT';
        else if (disc.includes('OBSTACLE') || disc.includes('HAIE') || disc.includes('STEEPLE')) discKey = 'OBSTACLE';

        const weights = WEIGHTS_BY_DISCIPLINE[discKey] || WEIGHTS_BY_DISCIPLINE.DEFAULT;

        // 1. FORME PROFONDE (V27)
        const scoreForme = analyserFormeProfonde(participant.musique, disc);

        // 2. CLASSE (V27)
        const scoreClasse = analyserClasse(participant);

        // 3. CONFIGURATION (Ferrage / Oeilleres)
        const scoreConfig = analyserConfig(participant, disc);

        // 4. ENTOURAGE & FORME (V27 - DRIVER FORM IMPACT)
        const topEntourage = ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'BARZALONA', 'SOUMILLON', 'GUYON', 'PASQUIER', 'DEMURO', 'MOUROT', 'MOTTIER', 'GELORMINI', 'LAGADEUC'];
        const entourageName = `${(participant.driver || '').toUpperCase()} ${(participant.entraineur || '').toUpperCase()}`;
        const isTop = topEntourage.some(name => entourageName.includes(name));
        let scoreEntourage = isTop ? 95 : 55;

        // Bonus Former Driver (Injecté si disponible)
        if (participant.driverStats) {
            const winRate = (participant.driverStats.victoires / participant.driverStats.total_courses) * 100;
            const placeRate = (participant.driverStats.places / participant.driverStats.total_courses) * 100;

            if (participant.driverStats.total_courses > 5) {
                if (winRate > 20 || placeRate > 40) {
                    scoreEntourage += 10; // 🔥 HOT HAND
                } else if (winRate === 0 && participant.driverStats.total_courses > 20) {
                    scoreEntourage -= 10; // ❄️ COLD STREAK
                }
            }
        }

        // 5. CONFIANCE (Marché & MONEY TIME)
        const cote = parseFloat(participant.cote_ref);
        let scoreConfiance = 50;

        // Simulation de Variation de Cote (Money Time)
        // Dans un système réel, on comparerait cote_matin vs cote_actuelle
        // Ici, on simule une "chute" si la cote est basse (< 5) et que c'est un "Bon Coup"
        let isMoneyTime = false;

        // Logique fictive de détection de baisse pour la démo
        // Si cote < 5 et (Forme > 60 ou Entourage > 80), on suppose une baisse de cote
        if (cote > 0 && cote < 5 && (scoreForme > 60 || scoreEntourage > 80)) {
            // On simule une ancienne cote plus haute
            const ancienneCote = cote * (1.3 + (Math.random() * 0.5)); // +30% à +80%
            if (ancienneCote / cote > 1.3) {
                isMoneyTime = true;
            }
        }

        if (!isNaN(cote) && cote > 0) {
            if (cote < 2.5) scoreConfiance = 100;
            else if (cote < 4.5) scoreConfiance = 90;
            else if (cote < 8) scoreConfiance = 75;
            else if (cote < 15) scoreConfiance = 60;
            else if (cote < 30) scoreConfiance = 40;
            else scoreConfiance = 15;

            // Bonus Money Time
            if (isMoneyTime) {
                scoreConfiance += 15; // Boost de confiance
                participant.is_money_time = true; // Flag pour le frontend
            }
        }

        // 6. EXPERT IMPACT (V27 - CONTEXTE & RISQUE)
        let expertScore = calculerExpertImpact(participant, contexteCourse);

        // V27: PÉNALITÉ RISQUE (Vision "Sniper")
        // Si c'est un Handicap avec beaucoup de partants (>13) = Risque élevé
        const nbPartants = contexteCourse.nbPartants || 10;
        const isHandicap = (contexteCourse.nom || '').toUpperCase().includes('HANDICAP');

        if (isHandicap && nbPartants > 13) {
            expertScore -= 15; // Malus "Loterie"
        }


        // V27: DISTANCE & TRACK BIAS (Aptitude Spéciale)
        const hippodrome = (contexteCourse.hippodrome || '').toUpperCase();

        // Bonus 1: Vincennes Meeting D4 (Configuration Optimale)
        if (hippodrome.includes('VINCENNES') && participant.ferrage && participant.ferrage.includes('D4')) {
            expertScore += 10; // Bonus Spécialiste Meeting
            participant.is_track_specialist = true; // Flag frontend
        }

        // Bonus 2: Mémoire de l'IA (Si on avait l'historique complet)
        // Simulation: Si le cheval a gagné > 100k€ et est jeune (<6 ans), on suppose une aptitude à la GP
        if (hippodrome.includes('VINCENNES') && participant.gains > 100000 && participant.age <= 6) {
            expertScore += 5;
        }

        // --- RETARD DE GAIN DETECTION (V27 ULTRA) ---
        // Si les stats moyennes de la course sont fournies dans le contexte
        if (contexteCourse.avgRatioGains > 0 && contexteCourse.avgCourses > 0) {
            const pRatio = participant.gains / (participant.nb_courses || 1);
            const pCourses = participant.nb_courses || 0;

            if (pRatio > (contexteCourse.avgRatioGains * 1.3) && pCourses < contexteCourse.avgCourses) {
                expertScore += 15; // BONUS MASSIF "RETARD DE GAIN"
                participant.is_retard_gain = true; // Flag pour le frontend
                logger.info(`[IA] RETARD GAIN DETECTÉ: ${participant.nom} (+15pts)`);
            }
        }

        const finalScore = (
            (scoreForme * weights.FORME) +
            (scoreEntourage * weights.ENTOURAGE) +
            (scoreConfiance * weights.CONFIANCE) +
            (scoreConfig * weights.CONFIGURATION) +
            (scoreClasse * weights.APTITUDE) +
            (expertScore * weights.EXPERT)
        );

        let predictionScore = isNaN(finalScore) ? 50 : Math.round(finalScore);

        // V29: AJUSTEMENT PAR PATTERNS OPTIMISÉS
        if (activePatterns && activePatterns.length > 0) {
            activePatterns.forEach(p => {
                if (p.type === 'GOLDEN_PATTERN') {
                    const bonus = Math.min(15, p.roi / 5); // Max +15 pts
                    predictionScore += bonus;
                    logger.info(`[IA] Bonus Golden Pattern: +${bonus.toFixed(1)}pts`);
                } else if (p.type === 'DANGER_PATTERN') {
                    const malus = 20; // Malus fixe sévère
                    predictionScore -= malus;
                    logger.info(`[IA] Malus Danger Pattern: -${malus}pts`);
                }
            });
        }

        // V27: STRATÉGIE FINANCIÈRE (KELLY)
        // On enrichit l'objet participant directement
        if (cote > 1) {
            const kelly = calculateKellyMise(cote, predictionScore, 1000); // Bankroll simu 1000€
            participant.kelly_suggestion = kelly;
        }

        return predictionScore;

    } catch (e) {
        logger.error(`IA Architecture v27 Error: ${e.message}`);
        return 50;
    }
}
