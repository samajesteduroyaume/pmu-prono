// src/core/engines/distance_terrain.mjs
// ARCHITECT v43.1 — Module Distance & Terrain (Performance Data-Driven)

function parseDistance(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const normalized = String(value ?? '').trim().replace(/[\s_]/g, '').replace(/m$/i, '');
    return normalized ? Number(normalized) : NaN;
}

/**
 * Analyse si un cheval a des références à une distance similaire.
 * Utilise distances_history (JSON stocké depuis API PMU) en priorité.
 * @param {object} participant - Le participant (avec distances_history depuis DB)
 * @param {number} distanceCourse - La distance de la course en mètres
 * @param {string} discipline - La discipline (TROT, PLAT, OBSTACLE...)
 * @returns {number} Bonus/malus entre -20 et +20
 */
export function analyserDistance(participant, distanceCourse, discipline) {
    if (!distanceCourse) return 0;
    const dist = parseDistance(distanceCourse);
    if (!Number.isFinite(dist) || dist <= 0) return 0;

    const disciplineNorm = String(discipline || '').toUpperCase();
    const isTrot = ['TROT', 'ATTELE', 'MONTE'].some(code => disciplineNorm.includes(code));
    const tolerance = isTrot ? 300 : 600;

    // Priorité 1 : Historique réel (distances_history JSON stocké en DB)
    if (participant.distances_history) {
        try {
            const historique = typeof participant.distances_history === 'string'
                ? JSON.parse(participant.distances_history)
                : participant.distances_history;

            if (Array.isArray(historique) && historique.length > 0) {
                const validHistory = historique.map(entry => {
                    const distance = parseDistance(typeof entry === 'object' && entry !== null ? entry.d : entry);
                    const rank = typeof entry === 'object' && entry !== null ? Number(entry.p) : NaN;
                    return { distance, rank };
                }).filter(entry => Number.isFinite(entry.distance) && entry.distance > 0);

                // v43.1 : Filtrage intelligent (Refs à la distance)
                const refs = validHistory.filter(entry => Math.abs(entry.distance - dist) <= tolerance);

                if (refs.length > 0) {
                    // Calculer le taux de réussite à cette distance (si données dispo)
                    const winsAtDist = refs.filter(entry => entry.rank === 1).length;
                    const placesAtDist = refs.filter(entry => entry.rank > 1 && entry.rank <= 3).length;

                    if (winsAtDist >= 1) return 20;   // Déjà gagné sur la distance
                    if (placesAtDist >= 1) return 12; // Déjà placé sur la distance
                    if (refs.length >= 3) return 8;   // Spécialiste de la distance (souvent couru)
                    return 4;                        // Référence neutre
                }

                // Historique existant mais aucune référence à cette distance
                if (validHistory.length >= 4) return -12;
            }
        } catch (e) {
            // JSON invalide, continuer avec fallback
        }
    }

    // distance_course est la distance de la course évaluée, pas une référence
    // passée. Sans historique daté, le signal doit rester neutre.
    return 0;
}

/**
 * Analyse la compatibilité cheval/terrain depuis les données API PMU.
 * Utilise terrain_prefere (extrait des performances historiques API PMU)
 * et le terrain actuel de la course (normalisé par le processor).
 * @param {object} participant - Le participant (avec terrain_prefere depuis DB)
 * @param {string} terrain - État normalisé du terrain (ex: BON, SOUPLE, LOURD, TRES_LOURD)
 * @returns {number} Bonus/malus entre -15 et +15
 */
export function analyserTerrain(participant, terrain) {
    if (!terrain) return 0;

    const terrainNorm = terrain.toUpperCase();
    const prefTerrain = (participant.terrain_prefere || '').toUpperCase();
    const musique = participant.musique || '';

    // Correspondance terrains similaires
    const famillesBon         = ['TRES_BON', 'BON', 'BON_SOUPLE'];
    const famillesSouple      = ['BON_SOUPLE', 'SOUPLE', 'TRES_SOUPLE'];
    const famillesLourd       = ['LOURD', 'TRES_LOURD', 'COLLANT'];
    const famillesSynthetique = ['SYNTHETIQUE', 'PSF', 'SABLE'];
    const isSameFamille  = (a, b, famille) => famille.some(f => a.includes(f)) && famille.some(f => b.includes(f));

    if (prefTerrain) {
        // Terrain idéal : même famille
        if (isSameFamille(terrainNorm, prefTerrain, famillesBon))         return 10;
        if (isSameFamille(terrainNorm, prefTerrain, famillesSouple))      return 10;
        if (isSameFamille(terrainNorm, prefTerrain, famillesLourd))       return 14;
        if (isSameFamille(terrainNorm, prefTerrain, famillesSynthetique)) return 12;

        // Incompatibilités claires
        if (famillesLourd.some(f => terrainNorm.includes(f)) &&
            famillesBon.some(f => prefTerrain.includes(f)))   return -14; // Lourd pour un spécialiste du Bon
        if (famillesBon.some(f => terrainNorm.includes(f)) &&
            famillesLourd.some(f => prefTerrain.includes(f))) return -6;  // Bon pour un spécialiste du Lourd
    }

    // Heuristique musique : fautes sur obstacle en terrain lourd
    // fix v48.1: Lookbehind négatif pour ne capturer T/A qu'en position autonome
    if (famillesLourd.some(f => terrainNorm.includes(f))) {
        const DISCIPLINE_LETTERS_DT = new Set(['a', 'p', 'm', 'h', 's', 'c']);
        const cleanMusicDT = musique.replace(/\(\d+\)/g, '');
        const fallTokensDT = cleanMusicDT.match(/(?<![0-9])[TA][a-zA-Z]*/g) || [];
        const falls = fallTokensDT.filter(tok => {
            if (tok.length === 1 && DISCIPLINE_LETTERS_DT.has(tok.toLowerCase())) return false;
            return true;
        }).length;
        if (falls >= 2) return -10;
        if (falls >= 1) return -5;
    }

    return 0;
}

/**
 * Score combiné Distance + Terrain
 * Utilise les données enrichies depuis DB (_terrain_course, _distance_course)
 * avec fallback sur les champs du contexte (pour les appels en temps réel).
 * @returns {number} Score combiné [-25, +25]
 */
export function calculerBonusDistanceTerrain(participant, contexte) {
    // Priorité : données enrichies depuis DB (_terrain_course, _distance_course)
    // Fallback : données du contexte (appels temps réel via processor)
    const terrain = participant._terrain_course || contexte.terrain || null;
    const distance = participant._distance_course || contexte.distance || contexte.distanceCourse || null;

    const distBonus = analyserDistance(participant, distance, contexte.discipline);
    const terrainBonus = analyserTerrain(participant, terrain);
    return Math.max(-25, Math.min(25, distBonus + terrainBonus));
}
