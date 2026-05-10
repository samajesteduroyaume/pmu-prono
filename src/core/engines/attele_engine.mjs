import { CONFIG } from '../../config/settings.mjs';
import { determinerChangementCategorie, calculerRegularite, checkShieldStatus, getCracks } from '../../utils/engine_utils.mjs';
import { calculerBonusDistanceTerrain } from './distance_terrain.mjs';

const WEIGHTS = CONFIG.weights.ATTELE;
const SETTINGS = CONFIG.engine_settings.attele;

export async function processAttelé(participant, contexte, baseScores) {
    let expertise = 50;
    const hippodrome = (contexte.hippodrome || '').toUpperCase();
    const isVincennes = hippodrome.includes('VINCENNES');

    // 1. FOCUS VINCENNES (DÉFERRAGE)
    const ferrage = (participant.ferrage || '').toUpperCase();
    if (isVincennes && (ferrage === 'FERRE' || !ferrage)) {
        expertise -= SETTINGS.vincennes_ferrage_malus;
    }

    // 2. RÉGULARITÉ & CATÉGORIE (v48.2)
    const cat = determinerChangementCategorie(participant, contexte.prixCourse || 20000);
    if (cat === 'DESCENTE') expertise += SETTINGS.desc_bonus;
    else if (cat === 'MONTEE') expertise -= 10;

    const reg = calculerRegularite(participant);
    if (reg > 50) expertise += SETTINGS.reg_bonus;

    // 2.bis: RECUL (Handicap distance v48.2)
    const recul = parseInt(participant.recul || 0);
    const dist = parseInt(contexte.distance || 0);
    if (recul > 0 && dist > 0 && dist < 2850) {
        expertise -= 20;
        participant.is_bad_draw = true;
    }

    // 3. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

    // 4. SYNERGIE CRACK DRIVER
    const cracks = getCracks();
    const isCrack = cracks.some(c => (participant.driver || '').toUpperCase().includes(c));
    if (isCrack && (contexte.prixCourse || 0) >= SETTINGS.crack_price_threshold) expertise += 10;

    // 5. DISTANCE & TERRAIN (v43)
    const dtBonus = calculerBonusDistanceTerrain(participant, contexte);
    expertise += dtBonus;

    return {
        engine: 'ARCHITECT-ATTELÉ v27.1',
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
