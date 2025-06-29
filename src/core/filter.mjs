/**
 * Filtre les courses selon une fonction de prédicat personnalisée.
 * @param {Array<object>} races - Liste des objets course
 * @param {Function} predicate - Fonction (course) => boolean
 * @returns {Array<object>} - Liste filtrée
 */
export function filterRaces(races, predicate) {
    return races.filter(predicate);
}

/**
 * Filtre les courses par discipline (ex: 'TROT', 'PLAT', 'OBSTACLE').
 * @param {Array<object>} races
 * @param {string|Array<string>} disciplines
 * @returns {Array<object>}
 */
export function filterByDiscipline(races, disciplines) {
    const allowed = Array.isArray(disciplines) ? disciplines : [disciplines];
    return races.filter(race => allowed.includes(race.discipline));
}

/**
 * Filtre les courses par hippodrome.
 * @param {Array<object>} races
 * @param {string|Array<string>} hippodromes
 * @returns {Array<object>}
 */
export function filterByHippodrome(races, hippodromes) {
    const allowed = Array.isArray(hippodromes) ? hippodromes : [hippodromes];
    return races.filter(race => allowed.includes(race.hippodrome));
}

/**
 * Filtre les courses ayant tous les champs essentiels renseignés.
 * @param {Array<object>} races
 * @param {Array<string>} requiredFields - Champs obligatoires (ex: ['date', 'heure', 'hippodrome', ...])
 * @returns {Array<object>}
 */
export function filterCompleteRaces(races, requiredFields = ['date', 'heure', 'hippodrome', 'discipline', 'distance', 'statut', 'partants']) {
    return races.filter(race => requiredFields.every(field => race[field] !== undefined && race[field] !== null && race[field] !== ''));
}

/**
 * Exemple de composition de filtres : discipline + complétude
 * @param {Array<object>} races
 * @param {object} options - { disciplines, requiredFields }
 * @returns {Array<object>}
 */
export function filterValidRaces(races, options = {}) {
    let filtered = races;
    if (options.disciplines) filtered = filterByDiscipline(filtered, options.disciplines);
    filtered = filterCompleteRaces(filtered, options.requiredFields);
    return filtered;
} 