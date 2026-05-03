import { calculerPredictionHybride } from './hybrid.mjs';
import { determinerChangementCategorie } from '../utils/engine_utils.mjs';
import { getHorseHistory } from './db.mjs';

// ============================================================
// v43: HELPERS EXTRACTION DONNÉES PMU API — TERRAIN & DISTANCE
// ============================================================

/**
 * Normalise le code terrain brut de l'API PMU vers une valeur standard.
 * L'API PMU peut retourner différentes formes : "BON", "TRES_BON", "SOUPLE",
 * "LOURD", "TRES_LOURD", ou des codes numériques 0-5.
 */
function normaliserTerrain(terrainBrut) {
    if (!terrainBrut) return null;
    const t = String(terrainBrut).toUpperCase().trim();

    // Codes numériques API PMU (0=Très bon, 5=Très lourd)
    const CODES_NUMERIQUES = {
        '0': 'TRES_BON', '1': 'BON', '2': 'BON_SOUPLE',
        '3': 'SOUPLE', '4': 'LOURD', '5': 'TRES_LOURD'
    };
    if (CODES_NUMERIQUES[t]) return CODES_NUMERIQUES[t];

    // Libellés texte
    if (t.includes('TRES_BON') || t.includes('TRES BON'))   return 'TRES_BON';
    if (t.includes('BON_SOUPLE') || t.includes('BON SOUPLE')) return 'BON_SOUPLE';
    if (t.includes('TRES_LOURD') || t.includes('TRES LOURD')) return 'TRES_LOURD';
    if (t.includes('LOURD'))  return 'LOURD';
    if (t.includes('SOUPLE')) return 'SOUPLE';
    if (t.includes('BON'))    return 'BON';
    if (t.includes('SABLE'))  return 'SABLE';
    if (t.includes('SYNTHETIC') || t.includes('ALL_WEATHER')) return 'SYNTHETIQUE';

    return t; // Retourner tel quel si non reconnu
}

/**
 * Extrait la préférence de terrain du participant depuis les données API PMU.
 * L'API retourne parfois `participant.preferencesTerrain` ou dans les perfs historiques.
 */
function extraireTerrainPrefere(p, dbHistory = []) {
    // Champ direct (PMU le fournit parfois)
    if (p.preferencesTerrain) return normaliserTerrain(p.preferencesTerrain);
    if (p.terrainPrefere)     return normaliserTerrain(p.terrainPrefere);
    if (p.typeTerrain)        return normaliserTerrain(p.typeTerrain);

    // Analyse des performances historiques si disponibles (p.performances[])
    const perfs = (p.performances && Array.isArray(p.performances)) ? p.performances : dbHistory;
    
    if (perfs && perfs.length >= 2) {
        const wins = perfs.filter(perf => parseInt(perf.ordreArrivee || perf.classement) === 1);
        if (wins.length > 0) {
            // Prendre le terrain le plus fréquent parmi les victoires
            const terrainCount = {};
            wins.forEach(perf => {
                const t = normaliserTerrain(perf.terrain);
                if (t) terrainCount[t] = (terrainCount[t] || 0) + 1;
            });
            const best = Object.entries(terrainCount).sort((a, b) => b[1] - a[1])[0];
            if (best) return best[0];
        }
    }

    return null;
}

/**
 * Extrait l'historique des distances depuis les performances API PMU.
 * L'API retourne `participant.performances[]` avec `distance` par course.
 * On retourne un tableau JSON des distances (en mètres) pour les N dernières courses.
 */
function extraireDistancesHistory(p, dbHistory = []) {
    const perfs = (p.performances || p.dernieresCourses || (Array.isArray(dbHistory) && dbHistory.length > 0 ? dbHistory : []));
    if (!Array.isArray(perfs) || perfs.length === 0) return null;

    // v43.1: On stocke maintenant des objets {d, p, t} (distance, place, terrain)
    const structuredHistory = perfs
        .slice(0, 15)
        .map(perf => ({
            d: parseInt(perf.distance || perf.distanceCourse || 0),
            p: parseInt(perf.ordreArrivee || perf.classement || 0),
            t: normaliserTerrain(perf.terrain)
        }))
        .filter(h => h.d > 0);

    return structuredHistory.length > 0 ? JSON.stringify(structuredHistory) : null;
}


/**
 * Transforme les données brutes de l'API PMU en format compatible avec la base de données
 */
export async function processRaces(rawRaces, dayDate, reunionData = {}) {
    return Promise.all(rawRaces.map(async race => {
        const raceDate = race.heureDepart ? new Date(race.heureDepart) : dayDate;
        const meteo = reunionData.meteo || {};

        // v43: Extraction du terrain depuis les données météo de l'API PMU
        // L'API retourne : meteo.nebulositeCode, meteo.temperature, et au niveau piste :
        // race.terrain (directement) ou reunion.terrain
        const terrainBrut = race.terrain
            || race.typePiste
            || reunionData.terrain
            || meteo.etatPiste
            || null;
        const terrain = normaliserTerrain(terrainBrut);

        // Distance de la course (en mètres, entier)
        const distanceCourse = parseInt(race.distance) || 0;

        // v43: Pré-extraction des cotes pour le rang ML (Feature de comparaison relative)
        const allParticipantsCotes = (race.participants || []).map(p => ({
            nom: p.nom,
            cote_ref: p.dernierRapportDirect?.rapport || 0
        }));

        // Extraction Participants
        const participants = await Promise.all((race.participants || []).map(async p => {
            // v43.1: Récupération de l'historique depuis la DB si l'API est muette
            const dbHistory = await getHorseHistory(p.nom);

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
                avis: p.avisEntraineur || null,
                // v43.2: Nouvelles caractéristiques techniques
                corde: p.place || 0,        // Corde en PLAT
                poids: p.poids || 0,        // Poids en PLAT/OBSTACLE
                recul: p.distance || 0,     // Distance réelle en TROT (recul)
                // v43.1: Signaux Distance & Terrain (DB Backed)
                distance_course: distanceCourse,
                terrain_prefere: extraireTerrainPrefere(p, dbHistory),
                distances_history: extraireDistancesHistory(p, dbHistory)
            };

            // Calcul du changement de catégorie
            participantObj.cat_statut = determinerChangementCategorie(participantObj, race.montantPrix || 0);

            // HYBRIDATION ML (v27.1 - Sécurisée)
            try {
                const result = await calculerPredictionHybride(participantObj, {
                    corde: race.corde,
                    prixCourse: race.montantPrix || 0,
                    discipline: race.discipline,
                    distance: distanceCourse,   // v43
                    terrain: terrain             // v43
                }, [], allParticipantsCotes);
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
            // Aplatir le tableau, prendre les 5 premiers (format PMU classique) et joindre avec des tirets
            ordreArrivee = race.ordreArrivee.flat().slice(0, 5).join('-');
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
            terrain: terrain,   // v43: État normalisé de la piste
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