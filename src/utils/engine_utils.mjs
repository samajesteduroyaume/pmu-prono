import { CONFIG } from '../config/settings.mjs';
import { extractMusicPerformances, parseMusicPerformance } from './music.mjs';

/**
 * Calcul de la régularité d'un participant (V27.1 Centralisé)
 */
export function calculerRegularite(p) {
    const totalCourses = Number(p?.nb_courses);
    if (!Number.isFinite(totalCourses) || totalCourses <= 0) return 0;
    const winsValue = Number(p?.nb_victoires);
    const placesValue = Number(p?.nb_places);
    const wins = Number.isFinite(winsValue) ? Math.max(0, winsValue) : 0;
    const places = Number.isFinite(placesValue) ? Math.max(0, placesValue) : 0;
    const totalPlaces = wins + places;
    return Math.max(0, Math.min(100, Math.round((totalPlaces / totalCourses) * 100)));
}

/**
 * Détermination du changement de catégorie (V27.1 Centralisé)
 */
export function determinerChangementCategorie(p, prixCourse) {
    const totalCourses = Number(p?.nb_courses);
    const purse = Number(prixCourse);
    const careerGains = Number(p?.gains);
    if (!Number.isFinite(totalCourses) || totalCourses < 3
        || !Number.isFinite(purse) || purse <= 0
        || !Number.isFinite(careerGains) || careerGains < 0) return 'STABLE';
    
    // v47: Plafond dynamique sur nb_courses pour éviter la dilution excessive des gains (biais chevaux d'âge)
    // On considère que le niveau réel est mieux représenté par les ~20-25 dernières courses max
    const age = Number.parseInt(p?.age, 10);
    const effectiveNbCourses = Math.min(totalCourses, 15 + (Number.isFinite(age) && age > 0 ? age : 5));
    
    const gainMoyen = careerGains / effectiveNbCourses;
    
    if (gainMoyen > purse * 0.8) return 'DESCENTE';
    if (gainMoyen < (purse / 12)) return 'MONTEE'; // v47: Seuil monté légèrement abaissé (10 -> 12) pour être plus sélectif
    return 'STABLE';
}

/**
 * THE SHIELD - Filtrage négatif (V33 Centralisé)
 */
export function checkShieldStatus(p, contexte) {
    let malus = 0;
    const { common } = CONFIG.engine_settings;
    const musique = p.musique || '';
    const perfs = extractMusicPerformances(musique);

    // 1. Échec Chronique
    const disc = (contexte.discipline || '').toUpperCase();
    const isTrot = disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE');
    const type = isTrot ? (disc.includes('MONTE') ? 'm' : 'a') : (disc.includes('PLAT') ? 'p' : 'h');

    const sameDiscPerfs = perfs.filter(perf => parseMusicPerformance(perf).type === type);
    const wins = sameDiscPerfs.filter(perf => {
        const val = parseMusicPerformance(perf).value;
        return val === '1';
    }).length;

    if (sameDiscPerfs.length >= 5 && wins === 0) {
        const places = sameDiscPerfs.filter(perf => {
            const val = parseMusicPerformance(perf).value;
            return ['2', '3'].includes(val);
        }).length;
        if (places === 0) malus += common.shield_malus_max; 
        else if (places / sameDiscPerfs.length < 0.15) malus += common.shield_malus_med;
    }

    // 2. Double Red Flag (DAI/ARR/Chutes sériels)
    if (perfs.length >= 2) {
        const lastTwo = perfs.slice(0, 2);
        const redFlagTokens = new Set(['D', 'DA', 'DAI', 'DIS', 'DIST', 'A', 'T', 'ARR', 'RET']);
        const redFlags = lastTwo.filter(perf => redFlagTokens.has(perf.toUpperCase())).length;
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
