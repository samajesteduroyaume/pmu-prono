// src/core/engines/distance_terrain.mjs
// ARCHITECT v43 — Module Distance & Terrain (données réelles API PMU)

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
    const dist = parseInt(distanceCourse);
    if (isNaN(dist) || dist <= 0) return 0;

    const isTrot = discipline && (discipline.includes('TROT') || discipline.includes('ATTELE') || discipline.includes('MONTE'));
    const tolerance = isTrot ? 300 : 600;

    // Priorité 1 : Historique réel depuis API PMU (distances_history JSON stocké en DB)
    if (participant.distances_history) {
        try {
            const historique = typeof participant.distances_history === 'string'
                ? JSON.parse(participant.distances_history)
                : participant.distances_history;

            if (Array.isArray(historique) && historique.length > 0) {
                const refs = historique.filter(d => Math.abs(d - dist) <= tolerance);
                if (refs.length >= 4) return 15;  // Spécialiste confirmé de la distance
                if (refs.length >= 2) return 8;   // Références solides
                if (refs.length >= 1) return 4;   // Quelques refs
                // Historique existant mais aucune référence à cette distance
                if (historique.length >= 3) return -12;
            }
        } catch (e) {
            // JSON invalide, continuer avec fallback
        }
    }

    // Priorité 2 : distance_course stockée en DB (distance de la dernière course)
    const distRef = parseInt(participant.distance_course || 0);
    if (distRef > 0) {
        const ecart = Math.abs(distRef - dist);
        if (ecart <= tolerance) return 8;
        if (ecart <= tolerance * 2) return 0;
        return -8;
    }

    return 0; // Pas d'information = neutre
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
    const famillesBon    = ['TRES_BON', 'BON', 'BON_SOUPLE'];
    const famillesSouple = ['BON_SOUPLE', 'SOUPLE'];
    const famillesLourd  = ['LOURD', 'TRES_LOURD'];
    const isSameFamille  = (a, b, famille) => famille.some(f => a.includes(f)) && famille.some(f => b.includes(f));

    if (prefTerrain) {
        // Terrain idéal : même famille
        if (isSameFamille(terrainNorm, prefTerrain, famillesBon))    return 10;
        if (isSameFamille(terrainNorm, prefTerrain, famillesSouple)) return 10;
        if (isSameFamille(terrainNorm, prefTerrain, famillesLourd))  return 14;

        // Incompatibilités claires
        if (famillesLourd.some(f => terrainNorm.includes(f)) &&
            famillesBon.some(f => prefTerrain.includes(f)))   return -14; // Lourd pour un spécialiste du Bon
        if (famillesBon.some(f => terrainNorm.includes(f)) &&
            famillesLourd.some(f => prefTerrain.includes(f))) return -6;  // Bon pour un spécialiste du Lourd
    }

    // Heuristique musique : fautes sur obstacle en terrain lourd
    if (famillesLourd.some(f => terrainNorm.includes(f))) {
        const falls = (musique.match(/Ts|As|Th|Ah/g) || []).length;
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
