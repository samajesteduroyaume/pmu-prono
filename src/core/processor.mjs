/**
 * Transforme les données brutes de l'API PMU en format compatible avec la base de données
 * @param {Array<object>} rawRaces - Courses brutes de l'API
 * @param {Date} dayDate - Date du jour traité
 * @returns {Array<object>} - Courses transformées
 */
export function processRaces(rawRaces, dayDate) {
    return rawRaces.map(race => {
        // Calculer la date à partir de heureDepart ou utiliser la date du jour
        const raceDate = race.heureDepart ? new Date(race.heureDepart) : dayDate;
        
        return {
            date: raceDate.toISOString().split('T')[0],
            dateLisible: raceDate.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            }),
            heure: race.heureDepart ? new Date(race.heureDepart).toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
            }) : 'Inconnue',
            hippodrome: race.hippodrome?.libelleLong || 'Inconnu',
            codeHippodrome: race.hippodrome?.code || '?',
            nom: race.libelle || 'Sans nom',
            discipline: race.discipline || 'Inconnue',
            distance: race.distance ? `${race.distance}m` : '?',
            statut: race.statut || 'Inconnu',
            partants: race.nombreDeclaresPartants || 0,
            prix: race.montantPrix || 0,
            reunionNum: race.numReunion || '?',
            courseNum: race.numOrdre || '?',
            // Champs supplémentaires utiles
            specialite: race.specialite || '',
            categorieParticularite: race.categorieParticularite || '',
            conditionAge: race.conditionAge || '',
            conditionSexe: race.conditionSexe || '',
            typePiste: race.typePiste || '',
            dureeCourse: race.dureeCourse || 0,
            // Données brutes pour référence
            rawData: race
        };
    });
}

/**
 * Filtre et transforme les courses d'une journée
 * @param {object} rawData - Données brutes de l'API
 * @param {Date} dayDate - Date du jour
 * @param {object} filterOptions - Options de filtrage
 * @returns {Array<object>} - Courses filtrées et transformées
 */
export function processDayRaces(rawData, dayDate, filterOptions = {}) {
    // Extraire toutes les courses des réunions
    const allRaces = (rawData?.programme?.reunions || []).flatMap(r => r.courses || []);
    
    // Transformer les courses
    const processedRaces = processRaces(allRaces, dayDate);
    
    // Appliquer les filtres si spécifiés
    if (filterOptions.disciplines) {
        const allowed = Array.isArray(filterOptions.disciplines) ? filterOptions.disciplines : [filterOptions.disciplines];
        return processedRaces.filter(race => allowed.includes(race.discipline));
    }
    
    return processedRaces;
} 