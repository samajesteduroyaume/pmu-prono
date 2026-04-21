import { CONFIG } from '../../config/settings.mjs';
import { checkShieldStatus } from '../../utils/engine_utils.mjs';

const WEIGHTS = CONFIG.weights.OBSTACLE;
const SETTINGS = CONFIG.engine_settings.obstacle;

export async function processObstacle(participant, contexte, baseScores) {
    let expertise = 50;
    const discipline = (contexte.discipline || '').toUpperCase();

    // 1. ANALYSE DES FAUTES (Musique)
    const musique = participant.musique || '';
    const falls = (musique.match(/Ts|As|Ts|Th|Ah/g) || []).length;
    if (falls > 0) expertise -= (falls * SETTINGS.fall_malus);

    // 2. FRAÎCHEUR
    if (participant.nb_courses < 5) expertise += SETTINGS.freshness_bonus;

    // 3. SPÉCIALITÉ CROSS/STEEPLE
    if (discipline.includes('CROSS') || discipline.includes('STEEPLE')) {
        expertise += SETTINGS.specialty_bonus;
        if (participant.nb_courses <= 2) expertise -= SETTINGS.inexperience_malus;
    }

    // 4. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

    return {
        engine: 'ARCHITECT-OBSTACLE v27.1',
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
