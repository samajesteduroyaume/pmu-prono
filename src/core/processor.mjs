import { calculerPredictionHybride } from './hybrid.mjs';
import { determinerChangementCategorie } from '../utils/engine_utils.mjs';

/**
 * Transforme les données brutes de l'API PMU en format compatible avec la base de données
 */
export async function processRaces(rawRaces, dayDate, reunionData = {}) {
    return Promise.all(rawRaces.map(async race => {
        const raceDate = race.heureDepart ? new Date(race.heureDepart) : dayDate;
        const meteo = reunionData.meteo || {};

        // Extraction Participants
        const participants = await Promise.all((race.participants || []).map(async p => {
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
                oeilleres: p.oeilleres || 'SANS_OEILLERES',
                nb_courses: p.nombreCourses || 0,
                nb_victoires: p.nombreVictoires || 0,
                nb_places: p.nombrePlaces || 0,
                statut: p.statut || 'PARTANT',
                classement: p.ordreArrivee || null,
                cote_ref: p.dernierRapportDirect?.rapport || 0,
                avis: p.avisEntraineur || null
            };

            // Calcul du changement de catégorie
            participantObj.cat_statut = determinerChangementCategorie(participantObj, race.montantPrix || 0);

            // HYBRIDATION ML (v27.1 - Sécurisée)
            try {
                const result = await calculerPredictionHybride(participantObj, {
                    corde: race.corde,
                    prixCourse: race.montantPrix || 0,
                    discipline: race.discipline
                });
                participantObj.prediction_score = result.score;
            } catch (err) {
                console.error(`[PROCESSOR] Hybridation échouée pour ${participantObj.nom}:`, err.message);
                participantObj.prediction_score = 0; // Fallback neutre sécurisé
            }

            return participantObj;
        }));

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
    }));
}

export async function processDayRaces(rawData, dayDate, filterOptions = {}) {
    let allRaces = [];
    if (rawData?.programme?.reunions) {
        for (const reunion of rawData.programme.reunions) {
            if (reunion.courses) {
                const racesFromReunion = await processRaces(reunion.courses, dayDate, reunion);
                allRaces = allRaces.concat(racesFromReunion);
            }
        }
    }
    if (filterOptions.disciplines) {
        const allowed = Array.isArray(filterOptions.disciplines) ? filterOptions.disciplines : [filterOptions.disciplines];
        return allRaces.filter(race => allowed.includes(race.discipline));
    }
    return allRaces;
}