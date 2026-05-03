import { CONFIG } from '../../config/settings.mjs';
import { checkShieldStatus } from '../../utils/engine_utils.mjs';
import { calculerBonusDistanceTerrain } from './distance_terrain.mjs';

const SETTINGS = CONFIG.engine_settings.obstacle;

// Poids dynamiques selon la discipline réelle
function getWeights(discipline) {
    const disc = (discipline || '').toUpperCase();
    if (disc.includes('HAIE'))  return CONFIG.weights.HAIE || CONFIG.weights.OBSTACLE;
    if (disc.includes('STEEPLE')) return CONFIG.weights.STEEPLECHASE || CONFIG.weights.OBSTACLE;
    if (disc.includes('CROSS'))  return CONFIG.weights.CROSS || CONFIG.weights.OBSTACLE;
    return CONFIG.weights.OBSTACLE;
}

export async function processObstacle(participant, contexte, baseScores) {
    let expertise = 50;
    const discipline = (contexte.discipline || '').toUpperCase();
    const WEIGHTS = getWeights(discipline);

    // 1. ANALYSE DES FAUTES (Musique)
    const musique = participant.musique || '';
    const falls = (musique.match(/Ts|As|Ts|Th|Ah/g) || []).length;
    if (falls > 0) expertise -= (falls * SETTINGS.fall_malus);

    // 2. FRAîCHEUR
    if (participant.nb_courses < 5) expertise += SETTINGS.freshness_bonus;

    // 3. SPÉCIALITÉ CROSS/STEEPLE
    if (discipline.includes('CROSS') || discipline.includes('STEEPLE')) {
        expertise += SETTINGS.specialty_bonus;
        if (participant.nb_courses <= 2) expertise -= SETTINGS.inexperience_malus;
    }

    // 4. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

    // 5. DISTANCE & TERRAIN (v43)
    const dtBonus = calculerBonusDistanceTerrain(participant, contexte);
    expertise += dtBonus;

    return {
        engine: `ARCHITECT-OBSTACLE v27.1 (${discipline})`,
        weights: WEIGHTS,
        expertiseBonus: expertise - 50,
        finalScore: Math.round(
            (baseScores.forme * WEIGHTS.FORME) +
            (baseScores.entourage * WEIGHTS.ENTOURAGE) +
            (baseScores.confiance * WEIGHTS.CONFIANCE) +
            (baseScores.config * WEIGHTS.CONFIGURATION) +
            (baseScores.aptitude * WEIGHTS.APTITUDE) +
            (expertise * WEIGHTS.EXPERT)
        )
    };
}
