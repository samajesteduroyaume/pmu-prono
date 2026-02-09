/**
 * ENGINE: MONTÉ - V32
 */
import { calculerRegularite } from './common.mjs';

const WEIGHTS = { FORME: 0.20, ENTOURAGE: 0.25, CONFIANCE: 0.05, CONFIGURATION: 0.35, APTITUDE: 0.10, EXPERT: 0.05 };

export async function processMonté(participant, contexte, baseScores) {
    let expertise = 50;

    // 1. SYNERGIE JOCKEY (Poids porté / Expérience)
    // Dans le monté, le jockey est encore plus vital qu'à l'attelé
    const topJockeysMonte = ['MOTTIER', 'RAFFIN', 'ABRIVARD', 'LAGADEUC', 'ROCHARD'];
    const isTopJockey = topJockeysMonte.some(j => (participant.driver || '').toUpperCase().includes(j));
    if (isTopJockey) expertise += 20;

    // 2. APTITUDE DISCIPLINE (m) dans la musique
    const musique = participant.musique || '';
    const hasMonteWins = (musique.match(/1m|2m|3m/g) || []).length > 0;
    if (hasMonteWins) expertise += 15;

    // 3. AGE & RÉSISTANCE
    // Les jeunes chevaux (4-6 ans) sont souvent plus véloces au monté
    const age = parseInt(participant.age);
    if (age >= 4 && age <= 6) expertise += 10;

    return {
        engine: 'PRO-MONTÉ V32',
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
