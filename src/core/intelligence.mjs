import logger from '../utils/logger.mjs';

/**
 * MOTEUR D'INTELLIGENCE ARTIFICIELLE "ARCHITECT v26 - UNIFIÉ"
 */

const WEIGHTS_BY_DISCIPLINE = {
    'TROT': { FORME: 0.20, ENTOURAGE: 0.30, CONFIANCE: 0.15, CONFIGURATION: 0.20, APTITUDE: 0.05, EXPERT: 0.10 },
    'PLAT': { FORME: 0.45, ENTOURAGE: 0.10, CONFIANCE: 0.15, CONFIGURATION: 0.05, APTITUDE: 0.20, EXPERT: 0.05 },
    'OBSTACLE': { FORME: 0.40, ENTOURAGE: 0.15, CONFIANCE: 0.10, CONFIGURATION: 0.05, APTITUDE: 0.05, EXPERT: 0.25 },
    'DEFAULT': { FORME: 0.30, ENTOURAGE: 0.20, CONFIANCE: 0.10, CONFIGURATION: 0.10, APTITUDE: 0.10, EXPERT: 0.20 }
};

function analyserFormeProfonde(musique, discipline = 'INCONNUE') {
    if (!musique) return 20;

    // 1. Détection de "Rentrée" (Absence prolongée)
    // Les parenthèses indiquent l'année (ex: (24) ou (25)). 
    // Si on voit (24) alors qu'on est en février 2026, c'est une rentrée après > 1 an.
    let rentreeMalus = 0;
    const years = musique.match(/\((\d+)\)/g);
    if (years && years.length > 0) {
        const lastYear = parseInt(years[years.length - 1].replace(/[()]/g, ''));
        if (lastYear < 25) rentreeMalus = 30; // Malus sévère si dernière course en 2024 ou avant
        else if (lastYear === 25) rentreeMalus = 10; // Malus léger si dernière course début 2025
    }

    const cleanMusic = musique.replace(/\(\d+\)/g, '');
    const perfs = cleanMusic.match(/([0-9DA]|Dist)[a-zA-Z]/g) || [];

    if (perfs.length === 0) return Math.max(0, 30 - rentreeMalus);

    let score = 0;
    let totalWeight = 0;
    const depth = Math.min(perfs.length, 6);

    const isTrot = discipline.includes('TROT') || discipline.includes('ATTELE') || discipline.includes('MONTE');

    for (let i = 0; i < depth; i++) {
        const perf = perfs[i];
        const type = perf.slice(-1).toLowerCase(); // a, m, s, h, p
        const val = perf.slice(0, -1).toUpperCase();

        let points = 20;

        if (!isNaN(val)) {
            const place = parseInt(val);
            if (place === 1) points = 100;
            else if (place === 2) points = 80;
            else if (place === 3) points = 65;
            else if (place === 4) points = 50;
            else if (place === 5) points = 40;
            else if (place <= 9) points = 15;
            else points = 5;
        } else {
            // Fautes spécialisées
            if (val === 'D' || val === 'DIST') {
                points = isTrot ? 0 : 10; // Plus critique au Trot
            } else if (val === 'A' || val === 'ARR') {
                points = 5; // Arrêté
            } else if (val === 'T' || val === 'TB') {
                points = 5; // Tombé (Obstacle)
            }
        }

        // Bonus si la discipline de la perf correspond à la course actuelle (Spécialisation)
        const currentType = isTrot ? (discipline.includes('MONTE') ? 'm' : 'a') : (discipline.includes('PLAT') ? 'p' : (discipline.includes('HAIE') ? 'h' : 's'));
        if (type === currentType) points *= 1.15; // 15% de bonus pour la spécialité

        const weight = Math.pow(0.85, i);
        score += Math.min(115, points) * weight;
        totalWeight += weight;
    }

    const finalFormeScore = Math.round(score / totalWeight);
    return Math.max(5, finalFormeScore - rentreeMalus);
}

function analyserClasse(participant) {
    const age = parseInt(participant.age) || 5;
    const gains = parseFloat(participant.gains) || 0;
    if (age < 2) return 50;
    const ratio = gains / (age * 12000);
    return Math.min(Math.round(ratio * 45), 100) || 50;
}

function analyserConfig(participant, discipline = '') {
    const isTrot = discipline.includes('TROT') || discipline.includes('ATTELE') || discipline.includes('MONTE');
    if (!isTrot) return 50; // Moins d'impact hors Trot (ferrage)

    let score = 40;
    const ferrage = (participant.ferrage || '').toUpperCase();
    if (ferrage.includes('D4')) score = 95;
    else if (ferrage.includes('DA') || ferrage.includes('DP')) score = 75;
    else if (ferrage.includes('PL')) score = 60;
    return score;
}

export function determinerChangementCategorie(participant, prixCourse) {
    if (!participant.nb_courses || participant.nb_courses < 3) return 'STABLE';
    const gainMoyen = participant.gains / participant.nb_courses;
    if (gainMoyen > prixCourse * 0.7) return 'DESCENTE';
    if (gainMoyen < (prixCourse / 12)) return 'MONTEE';
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
    if (cat === 'DESCENTE') bonus += 20;
    else if (cat === 'MONTEE') bonus -= 10;

    const reg = calculerRegularite(p);
    if (reg > 50) bonus += 15;

    if (p.oeilleres && p.oeilleres !== 'SANS_OEILLERES') bonus += 10;

    // Aptitude corde/distance (si dispo dans futur)
    return Math.max(0, Math.min(100, 50 + bonus));
}

export function calculerPrediction(participant, contexteCourse) {
    try {
        const disc = (contexteCourse.discipline || 'PLAT').toUpperCase();
        let discKey = 'DEFAULT';
        if (disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE')) discKey = 'TROT';
        else if (disc.includes('PLAT')) discKey = 'PLAT';
        else if (disc.includes('OBSTACLE') || disc.includes('HAIE') || disc.includes('STEEPLE')) discKey = 'OBSTACLE';

        const weights = WEIGHTS_BY_DISCIPLINE[discKey] || WEIGHTS_BY_DISCIPLINE.DEFAULT;

        // 1. FORME PROFONDE
        const scoreForme = analyserFormeProfonde(participant.musique, disc);

        // 2. CLASSE
        const age = parseInt(participant.age) || 5;
        const gains = parseFloat(participant.gains) || 0;
        const scoreClasse = (age < 2) ? 50 : Math.min(Math.round((gains / (age * 12000)) * 45), 100);

        // 3. CONFIGURATION (Ferrage / Oeilleres)
        let scoreConfig = 50;
        if (discKey === 'TROT') {
            const ferrage = (participant.ferrage || '').toUpperCase();
            if (ferrage.includes('D4')) scoreConfig = 95;
            else if (ferrage.includes('DA') || ferrage.includes('DP')) scoreConfig = 75;
            else if (ferrage.includes('PL')) scoreConfig = 60;
        } else {
            if (participant.oeilleres && participant.oeilleres !== 'SANS_OEILLERES') scoreConfig = 70;
        }

        // 4. ENTOURAGE
        const topEntourage = ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'BARZALONA', 'SOUMILLON', 'GUYON', 'PASQUIER', 'DEMURO', 'MOUROT', 'MOTTIER'];
        const entourageName = `${(participant.driver || '').toUpperCase()} ${(participant.entraineur || '').toUpperCase()}`;
        const isTop = topEntourage.some(name => entourageName.includes(name));
        const scoreEntourage = isTop ? 90 : 50;

        // 5. CONFIANCE (Marché)
        const cote = parseFloat(participant.cote_ref);
        let scoreConfiance = 50;
        if (!isNaN(cote) && cote > 0) {
            if (cote < 3) scoreConfiance = 95;
            else if (cote < 7) scoreConfiance = 80;
            else if (cote < 15) scoreConfiance = 60;
            else if (cote < 30) scoreConfiance = 40;
            else scoreConfiance = 20;
        }

        // 6. EXPERT IMPACT
        const expertScore = calculerExpertImpact(participant, contexteCourse);

        const finalScore = (
            (scoreForme * weights.FORME) +
            (scoreEntourage * weights.ENTOURAGE) +
            (scoreConfiance * weights.CONFIANCE) +
            (scoreConfig * weights.CONFIGURATION) +
            (scoreClasse * weights.APTITUDE) +
            (expertScore * weights.EXPERT)
        );

        return isNaN(finalScore) ? 50 : Math.round(finalScore);
    } catch (e) {
        logger.error(`IA Architecture v26 Error: ${e.message}`);
        return 50;
    }
}
