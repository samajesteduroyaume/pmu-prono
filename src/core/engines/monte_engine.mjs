import { CONFIG } from '../../config/settings.mjs';
import { checkShieldStatus } from '../../utils/engine_utils.mjs';

const WEIGHTS = CONFIG.weights.MONTE;
const SETTINGS = CONFIG.engine_settings.monte;

export async function processMonté(participant, contexte, baseScores) {
    let expertise = 50;

    // 1. SYNERGIE JOCKEY
    const isTopJockey = SETTINGS.top_jockeys.some(j => (participant.driver || '').toUpperCase().includes(j));
    if (isTopJockey) expertise += 20;

    // 2. APTITUDE DISCIPLINE (m)
    const musique = participant.musique || '';
    const hasMonteWins = (musique.match(/1m|2m|3m/g) || []).length > 0;
    if (hasMonteWins) expertise += SETTINGS.win_bonus;

    // 3. AGE & RÉSISTANCE
    const age = parseInt(participant.age);
    if (age >= 4 && age <= 6) expertise += SETTINGS.age_bonus;

    // 4. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

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
