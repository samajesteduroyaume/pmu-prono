import { CONFIG } from '../../config/settings.mjs';
import { checkShieldStatus, determinerChangementCategorie } from '../../utils/engine_utils.mjs';
import { calculerBonusDistanceTerrain } from './distance_terrain.mjs';

const WEIGHTS = CONFIG.weights.PLAT;
const SETTINGS = CONFIG.engine_settings.plat;

export async function processPlat(participant, contexte, baseScores) {
    let expertise = 50;

    // 1. VALEUR HANDICAP & CLASSE BRUTE (Plus granulaire v43.1)
    const gains = parseFloat(participant.gains) || 0;
    if (gains > SETTINGS.elite_gains_threshold) expertise += 20;
    else if (gains > SETTINGS.elite_gains_threshold / 2) expertise += 10;
    else if (gains < 10000 && participant.age >= 4) expertise -= 10;

    // 2. CORDE (Impact renforcé v48.2)
    const corde = parseInt(participant.corde);
    if (corde) {
        if (corde <= 4) expertise += 15;
        else if (corde >= 14) {
            expertise -= 25; // Malus expert
            participant.is_bad_draw = true;
        } else if (corde >= 11) {
            expertise -= 10;
        }
    }

    // 3. RÉGULARITÉ & CATÉGORIE (v48.2)
    const cat = determinerChangementCategorie(participant, contexte.prixCourse || 20000);
    if (cat === 'MONTEE') expertise -= 15;
    else if (cat === 'DESCENTE') expertise += 10;

    // 4. APTITUDE AU TERRAIN & HIPPO
    const hippodrome = (contexte.hippodrome || '').toUpperCase();
    if (hippodrome.includes('LONGCHAMP') || hippodrome.includes('CHANTILLY') || hippodrome.includes('DEAUVILLE')) {
        expertise += SETTINGS.hippo_bonus;
    }

    // 4. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

    // 5. DISTANCE & TERRAIN (v43)
    const dtBonus = calculerBonusDistanceTerrain(participant, contexte);
    expertise += dtBonus;

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
