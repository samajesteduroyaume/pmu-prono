/**
 * ENGINE: ATTELÉ ("LA CHARETTE") - V32
 */
import { getTopEntourage, getCracks, determinerChangementCategorie, calculerRegularite } from './common.mjs';

const WEIGHTS = { FORME: 0.20, ENTOURAGE: 0.25, CONFIANCE: 0.10, CONFIGURATION: 0.30, APTITUDE: 0.10, EXPERT: 0.05 };

export async function processAttelé(participant, contexte, baseScores) {
    let expertise = 50;
    const hippodrome = (contexte.hippodrome || '').toUpperCase();
    const isVincennes = hippodrome.includes('VINCENNES');

    // 1. FOCUS SHOEING (DÉFERRAGE) - CRITIQUE AU TROT
    const ferrage = (participant.ferrage || '').toUpperCase();
    if (ferrage.includes('D4')) expertise += 25;
    else if (ferrage.includes('DA') || ferrage.includes('DP')) expertise += 15;
    else if (isVincennes && (ferrage === 'FERRE' || !ferrage)) expertise -= 15;

    // 2. RÉGULARITÉ & CATÉGORIE
    const cat = determinerChangementCategorie(participant, contexte.prixCourse || 20000);
    if (cat === 'DESCENTE') expertise += 15;

    const reg = calculerRegularite(participant);
    if (reg > 50) expertise += 10;

    // 3. SYNERGIE CRACK DRIVER
    const cracks = getCracks();
    const isCrack = cracks.some(c => (participant.driver || '').toUpperCase().includes(c));
    if (isCrack && (contexte.prixCourse || 0) >= 40000) expertise += 10;

    return {
        engine: 'PRO-ATTELÉ V32',
        weights: WEIGHTS,
        expertiseBonus: expertise - 50,
        finalScore: Math.round(
            (baseScores.forme * WEIGHTS.FORME) +
            (baseScores.entourage * WEIGHTS.ENTOURAGE) +
            (baseScores.confiance * WEIGHTS.CONFIANCE) +
            (baseScores.config * WEIGHTS.CONFIGURATION) + // config already integrated ferrage in base logic
            (baseScores.aptitude * WEIGHTS.APTITUDE) +
            (expertise * WEIGHTS.EXPERT)
        )
    };
}
