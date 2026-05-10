import { CONFIG } from '../config/settings.mjs';

/**
 * Calcul de la régularité d'un participant (V27.1 Centralisé)
 */
export function calculerRegularite(p) {
    if (!p.nb_courses || p.nb_courses === 0) return 0;
    const totalPlaces = (p.nb_victoires || 0) + (p.nb_places || 0);
    return Math.round((totalPlaces / p.nb_courses) * 100);
}

/**
 * Détermination du changement de catégorie (V27.1 Centralisé)
 */
export function determinerChangementCategorie(p, prixCourse) {
    if (!p.nb_courses || p.nb_courses < 3) return 'STABLE';
    
    // v47: Plafond dynamique sur nb_courses pour éviter la dilution excessive des gains (biais chevaux d'âge)
    // On considère que le niveau réel est mieux représenté par les ~20-25 dernières courses max
    const effectiveNbCourses = Math.min(p.nb_courses, 15 + (parseInt(p.age) || 5));
    
    const gainMoyen = p.gains / effectiveNbCourses;
    
    if (gainMoyen > prixCourse * 0.8) return 'DESCENTE';
    if (gainMoyen < (prixCourse / 12)) return 'MONTEE'; // v47: Seuil monté légèrement abaissé (10 -> 12) pour être plus sélectif
    return 'STABLE';
}

/**
 * THE SHIELD - Filtrage négatif (V33 Centralisé)
 */
export function checkShieldStatus(p, contexte) {
    let malus = 0;
    const { common } = CONFIG.engine_settings;
    const musique = p.musique || '';
    const cleanMusic = musique.replace(/\(\d+\)/g, '');
    const perfs = cleanMusic.match(/([0-9DA]|Dist)[a-zA-Z]?/g) || [];

    // 1. Échec Chronique
    const disc = (contexte.discipline || '').toUpperCase();
    const isTrot = disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE');
    const type = isTrot ? (disc.includes('MONTE') ? 'm' : 'a') : (disc.includes('PLAT') ? 'p' : 'h');

    const sameDiscPerfs = perfs.filter(perf => perf.slice(-1).toLowerCase() === type);
    const wins = sameDiscPerfs.filter(perf => perf.startsWith('1')).length;

    if (sameDiscPerfs.length >= 5 && wins === 0) {
        const places = sameDiscPerfs.filter(perf => ['2', '3'].includes(perf[0])).length;
        if (places === 0) malus += common.shield_malus_max; 
        else if (places / sameDiscPerfs.length < 0.15) malus += common.shield_malus_med;
    }

    // 2. Double Red Flag (DAI/ARR sériels)
    if (perfs.length >= 2) {
        const lastTwo = perfs.slice(0, 2);
        const redFlags = lastTwo.filter(perf => ['D', 'A', 'T', 'Dist'].some(f => perf.toUpperCase().startsWith(f.toUpperCase()))).length;
        if (redFlags === 2) malus += common.red_flag_malus;
    }

    return malus;
}

/**
 * Récupération des Crack Drivers (Centralisé)
 */
export function getCracks() {
    return CONFIG.experts.drivers.slice(0, 4); // On prend les 4 premiers par défaut comme "Cracks"
}
