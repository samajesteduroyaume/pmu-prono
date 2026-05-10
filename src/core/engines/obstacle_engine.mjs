import { CONFIG } from '../../config/settings.mjs';
import { checkShieldStatus } from '../../utils/engine_utils.mjs';
import { calculerBonusDistanceTerrain } from './distance_terrain.mjs';

const SETTINGS = CONFIG.engine_settings.obstacle;

// Poids dynamiques selon la discipline réelle
function getWeights(discipline) {
    const disc = (discipline || '').toUpperCase();
    if (disc.includes('HAIE'))  return CONFIG.weights.HAIE || CONFIG.weights.OBSTACLE;
    if (disc.includes('STEEPLE')) return CONFIG.weights.STEEPLECHASE || CONFIG.weights.OBSTACLE;
    if (disc.includes('CROSS'))  return CONFIG.weights.CROSS || CONFIG.weights.OBSTACLE;
    return CONFIG.weights.OBSTACLE;
}

export async function processObstacle(participant, contexte, baseScores) {
    let expertise = 50;
    const discipline = (contexte.discipline || '').toUpperCase();
    const WEIGHTS = getWeights(discipline);

    // 1. ANALYSE DES FAUTES (Musique)
    // fix v48.1: Lookbehind négatif (?<![0-9]) pour ne capter T/A qu'en position autonome,
    // pas comme suffixe de discipline après un chiffre (ex: "2a" → 'a' est la discipline, pas une faute).
    const musique = participant.musique || '';
    const cleanMusicObs = musique.replace(/\(\d+\)/g, '');
    const DISCIPLINE_LETTERS_OBS = new Set(['a', 'p', 'm', 'h', 's', 'c']);
    const fallTokens = cleanMusicObs.match(/(?<![0-9])[TA][a-zA-Z]*/g) || [];
    const falls = fallTokens.filter(tok => {
        if (tok.length === 1 && DISCIPLINE_LETTERS_OBS.has(tok.toLowerCase())) return false;
        return true;
    }).length;
    if (falls > 0) expertise -= (falls * SETTINGS.fall_malus);

    // 2. FRAîCHEUR
    if (participant.nb_courses < 5) expertise += SETTINGS.freshness_bonus;

    // 3. SPÉCIALITÉ CROSS/STEEPLE
    if (discipline.includes('CROSS') || discipline.includes('STEEPLE')) {
        expertise += SETTINGS.specialty_bonus;
        if (participant.nb_courses <= 2) expertise -= SETTINGS.inexperience_malus;
    }

    // 4. THE SHIELD (V33)
    const shieldMalus = checkShieldStatus(participant, contexte);
    expertise -= shieldMalus;

    // 5. DISTANCE & TERRAIN (v43)
    const dtBonus = calculerBonusDistanceTerrain(participant, contexte);
    expertise += dtBonus;

    return {
        engine: `ARCHITECT-OBSTACLE v27.1 (${discipline})`,
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
