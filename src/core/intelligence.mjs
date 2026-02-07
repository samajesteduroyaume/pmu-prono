import logger from '../utils/logger.mjs';

/**
 * MOTEUR D'INTELLIGENCE ARTIFICIELLE "ARCHITECT v12"
 */

const WEIGHTS_BY_DISCIPLINE = {
    'TROT': { FORME: 0.20, ENTOURAGE: 0.30, CONFIANCE: 0.15, CONFIGURATION: 0.20, APTITUDE: 0.05, EXPERT: 0.10 },
    'PLAT': { FORME: 0.45, ENTOURAGE: 0.10, CONFIANCE: 0.15, CONFIGURATION: 0.05, APTITUDE: 0.20, EXPERT: 0.05 },
    'OBSTACLE': { FORME: 0.40, ENTOURAGE: 0.15, CONFIANCE: 0.10, CONFIGURATION: 0.05, APTITUDE: 0.05, EXPERT: 0.25 },
    'DEFAULT': { FORME: 0.30, ENTOURAGE: 0.20, CONFIANCE: 0.10, CONFIGURATION: 0.10, APTITUDE: 0.10, EXPERT: 0.20 }
};

function analyerForme(musique, discipline = 'INCONNUE') {
    if (!musique) return 20;

    const cleanMusic = musique.replace(/\(\d+\)/g, '');
    const perfs = cleanMusic.match(/([0-9DA]|Dist)[a-zA-Z]/g) || [];

    if (perfs.length === 0) return 30;

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
            else if (place <= 9) points = 20;
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

        // Bonus si la discipline de la perf correspond à la course actuelle
        const currentType = isTrot ? (discipline.includes('MONTE') ? 'm' : 'a') : (discipline.includes('PLAT') ? 'p' : (discipline.includes('HAIE') ? 'h' : 's'));
        if (type === currentType) points *= 1.1;

        const weight = Math.pow(0.85, i);
        score += Math.min(100, points) * weight;
        totalWeight += weight;
    }

    return Math.round(score / totalWeight);
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

        const scoreForme = analyerForme(participant.musique, disc);
        const scoreAptitude = analyserClasse(participant);
        const scoreConfig = analyserConfig(participant, disc);
        const scoreExpert = calculerExpertImpact(participant, contexteCourse);

        // Entourage spécialisé
        const topDriversTrot = ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'MOTTIER', 'TOMASELLI', 'GELORMINI'];
        const topJockeysGalop = ['BARZALONA', 'SOUMILLON', 'GUYON', 'PASQUIER', 'DEMURO', 'PICCONE', 'LEMAITRE'];

        const dr = (participant.driver || '').toUpperCase();
        const en = (participant.entraineur || '').toUpperCase();

        const isTopEntourage = (discKey === 'TROT')
            ? topDriversTrot.some(d => dr.includes(d))
            : topJockeysGalop.some(d => dr.includes(d));

        const scoreEntourage = isTopEntourage ? 95 : 50;

        let scoreConfiance = 50;
        const cote = parseFloat(participant.cote_ref);
        if (!isNaN(cote) && cote > 0) {
            if (cote < 3) scoreConfiance = 95;
            else if (cote < 6) scoreConfiance = 80;
            else if (cote < 12) scoreConfiance = 60;
            else if (cote < 25) scoreConfiance = 40;
            else scoreConfiance = 20;
        }

        const finalScore = (
            (scoreForme * weights.FORME) +
            (scoreEntourage * weights.ENTOURAGE) +
            (scoreConfiance * weights.CONFIANCE) +
            (scoreConfig * weights.CONFIGURATION) +
            (scoreAptitude * weights.APTITUDE) +
            (scoreExpert * weights.EXPERT)
        );

        return isNaN(finalScore) ? 50 : Math.round(finalScore);
    } catch (e) {
        logger.error(`IA Error: ${e.message}`);
        return 50;
    }
}
