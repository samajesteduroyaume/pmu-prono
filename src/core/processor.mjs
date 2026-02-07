import { calculerPrediction } from './intelligence.mjs';

/**
 * Transforme les données brutes de l'API PMU en format compatible avec la base de données
 */
export function processRaces(rawRaces, dayDate, reunionData = {}) {
    return rawRaces.map(race => {
        const raceDate = race.heureDepart ? new Date(race.heureDepart) : dayDate;
        const meteo = reunionData.meteo || {};

        // Extraction Participants
        const participants = (race.participants || []).map(p => {
            const participantObj = {
                nom: p.nom || '?',
                numero: p.numPmu || 0,
                sexe: p.sexe || '?',
                age: p.age || 0,
                musique: p.musique || '',
                gains: p.gainsParticipant ? (p.gainsParticipant.gainsCarriere / 100) : 0,
                driver: p.driver || p.jockey || '?',
                entraineur: p.entraineur || '?',
                proprietaire: p.proprietaire || '?',
                ferrage: p.deferre || 'STANDARD',
                oeilleres: p.oeilleres || 'SANS_OEILLERES', // NOUVEAU
                nb_courses: p.nombreCourses || 0, // NOUVEAU
                nb_victoires: p.nombreVictoires || 0, // NOUVEAU
                nb_places: p.nombrePlaces || 0, // NOUVEAU
                cote_ref: p.dernierRapportDirect?.rapport || 0,
                statut: p.statut || 'PARTANT',
                classement: p.ordreArrivee || null
            };

            participantObj.prediction_score = calculerPrediction(participantObj, {
                corde: race.corde,
                prixCourse: race.montantPrix || 0
            });

            return participantObj;
        });

        const paris = (race.paris || []).map(p => p.codePari).join(',');

        // AJOUT ORDRE ARRIVÉE GLOBAL
        let ordreArrivee = null;
        if (race.ordreArrivee && Array.isArray(race.ordreArrivee)) {
            ordreArrivee = race.ordreArrivee.map(o => o.join('-')).join(',');
        }

        return {
            date: raceDate.toISOString().split('T')[0],
            heure: raceDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            reunionNum: race.numReunion,
            courseNum: race.numOrdre,
            hippodrome: race.hippodrome?.libelleLong || 'Inconnu',
            corde: race.corde || '?',
            discipline: race.discipline || 'Inconnue',
            distance: race.distance ? `${race.distance}` : '0',
            categorie: race.categorieParticularite || '',
            conditions: race.conditions || '',
            statut: race.statut || 'Inconnu',
            partants: race.nombreDeclaresPartants || 0,
            prix: race.montantPrix || 0,
            meteo: meteo,
            type_pari: paris,
            ordre_arrivee: ordreArrivee,
            rapports: race.rapportsDefinitifs || null,
            participants: participants
        };
    });
}

export function processDayRaces(rawData, dayDate, filterOptions = {}) {
    let allRaces = [];
    if (rawData?.programme?.reunions) {
        rawData.programme.reunions.forEach(reunion => {
            if (reunion.courses) {
                const racesFromReunion = processRaces(reunion.courses, dayDate, reunion);
                allRaces = allRaces.concat(racesFromReunion);
            }
        });
    }
    if (filterOptions.disciplines) {
        const allowed = Array.isArray(filterOptions.disciplines) ? filterOptions.disciplines : [filterOptions.disciplines];
        return allRaces.filter(race => allowed.includes(race.discipline));
    }
    return allRaces;
}