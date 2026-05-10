import { CONFIG } from '../../config/settings.mjs';
import { checkShieldStatus } from '../../utils/engine_utils.mjs';
import { calculerBonusDistanceTerrain } from './distance_terrain.mjs';

const WEIGHTS = CONFIG.weights.MONTE;
const SETTINGS = CONFIG.engine_settings.monte;

export async function processMonté(participant, contexte, baseScores) {
    let expertise = 50;

    // 1. SYNERGIE JOCKEY
    const isTopJockey = SETTINGS.top_jockeys.some(j => (participant.driver || '').toUpperCase().includes(j));
    if (isTopJockey) expertise += 20;

    // 2. APTITUDE DISCIPLINE (m)
    const musique = participant.musique || '';
    const hasMonteWins = (musique.match(/[123]m/gi) || []).length > 0; // v47.1: Correction regex (insensible casse pour attraper 1M, 2M, 3M)
    if (hasMonteWins) expertise += SETTINGS.win_bonus;

    // 3. AGE & RÉSISTANCE
    const age = parseInt(participant.age);
    if (age >= 4 && age <= 6) expertise += SETTINGS.age_bonus;

    // 4. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

    // 5. DISTANCE & TERRAIN (v43)
    const dtBonus = calculerBonusDistanceTerrain(participant, contexte);
    expertise += dtBonus;

    return {
        engine: 'ARCHITECT-MONTÉ v27.1',
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
