/**
 * ENGINE: PLAT - V32
 */
import { checkShieldStatus } from './common.mjs';

const WEIGHTS = { FORME: 0.25, ENTOURAGE: 0.15, CONFIANCE: 0.15, CONFIGURATION: 0.05, APTITUDE: 0.30, EXPERT: 0.10 };

export async function processPlat(participant, contexte, baseScores) {
    let expertise = 50;

    // 1. VALEUR HANDICAP & CLASSE BRUTE (Poids lourd dans l'Aptitude)
    // Au plat, la classe (aptitude) est le facteur n°1
    const gains = parseFloat(participant.gains) || 0;
    if (gains > 200000) expertise += 20;

    // 2. CORDE (Si disponible dans le contexte)
    const corde = parseInt(contexte.corde);
    if (corde && corde <= 5) expertise += 10; // Bonus petite corde
    else if (corde && corde >= 15) expertise -= 10; // Malus grosse corde

    // 3. APTITUDE AU TERRAIN (Simulé par hippodrome)
    const hippodrome = (contexte.hippodrome || '').toUpperCase();
    if (hippodrome.includes('LONGCHAMP') || hippodrome.includes('CHANTILLY') || hippodrome.includes('DEAUVILLE')) {
        // Grands hippodromes = avantage aux "grosses écuries"
        expertise += 5;
    }

    // 4. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

    return {
        engine: 'PRO-GALOP V32',
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
