/**
 * ENGINE: OBSTACLE (HAIES/STEEPLE/CROSS) - V32
 */
import { checkShieldStatus } from './common.mjs';

const WEIGHTS = { FORME: 0.20, ENTOURAGE: 0.25, CONFIANCE: 0.05, CONFIGURATION: 0.30, APTITUDE: 0.15, EXPERT: 0.05 };

export async function processObstacle(participant, contexte, baseScores) {
    let expertise = 50;
    const discipline = (contexte.discipline || '').toUpperCase();

    // 1. ANALYSE DES FAUTES (Musique)
    // Au saut, une chute (T, A) est un signal de risque massif
    const musique = participant.musique || '';
    const falls = (musique.match(/Ts|As|Ts|Th|Ah/g) || []).length;
    if (falls > 0) expertise -= (falls * 15);

    // 2. FRAÎCHEUR (Absence de courses récentes)
    // Les chevaux d'obstacle courent moins souvent, la fraîcheur est capitale
    if (participant.nb_courses < 5) expertise += 15;

    // 3. SPÉCIALITÉ CROSS/STEEPLE
    if (discipline.includes('CROSS') || discipline.includes('STEEPLE')) {
        // Le Cross demande une expérience du parcours
        expertise += 10;
        // Malus si première fois (simulé par faible nb courses)
        if (participant.nb_courses <= 2) expertise -= 20;
    }

    // 4. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

    return {
        engine: 'PRO-OBSTACLE V32',
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
