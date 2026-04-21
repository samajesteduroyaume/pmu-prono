import { CONFIG } from '../../config/settings.mjs';
import { checkShieldStatus } from '../../utils/engine_utils.mjs';

const WEIGHTS = CONFIG.weights.PLAT;
const SETTINGS = CONFIG.engine_settings.plat;

export async function processPlat(participant, contexte, baseScores) {
    let expertise = 50;

    // 1. VALEUR HANDICAP & CLASSE BRUTE
    const gains = parseFloat(participant.gains) || 0;
    if (gains > SETTINGS.elite_gains_threshold) expertise += 20;

    // 2. CORDE
    const corde = parseInt(contexte.corde);
    if (corde && corde <= 5) expertise += SETTINGS.corde_bonus; 
    else if (corde && corde >= 15) expertise -= SETTINGS.corde_bonus;

    // 3. APTITUDE AU TERRAIN
    const hippodrome = (contexte.hippodrome || '').toUpperCase();
    if (hippodrome.includes('LONGCHAMP') || hippodrome.includes('CHANTILLY') || hippodrome.includes('DEAUVILLE')) {
        expertise += SETTINGS.hippo_bonus;
    }

    // 4. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

    return {
        engine: 'ARCHITECT-GALOP v27.1',
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
