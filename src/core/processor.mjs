import { calculerPredictionHybride, getMLMetadata } from './hybrid.mjs';
import { determinerChangementCategorie } from '../utils/engine_utils.mjs';
import { getHorseHistory } from './db.mjs';
import { formatDate, formatHeure } from '../utils/dateUtils.mjs';
import { isNonRunnerStatus } from './runner_status.mjs';

// ============================================================
// v43: HELPERS EXTRACTION DONNÉES PMU API — TERRAIN & DISTANCE
// ============================================================

/**
 * Normalise le déferrage brut de l'API PMU vers les codes standards (D4, DA, DP, PL, FERRE)
 */
function normaliserFerrage(deferre) {
    if (!deferre) return 'FERRE';
    const d = String(deferre).toUpperCase().trim();
    if (d.includes('DES_4') || d === 'D4' || d.includes('DEFERRE_4')) return 'D4';
    if (d.includes('ANTERIEUR') || d === 'DA' || d.includes('D_ANT')) return 'DA';
    if (d.includes('POSTERIEUR') || d === 'DP' || d.includes('D_POST')) return 'DP';
    if (d.includes('PLAQUE') || d.includes('PL')) return 'PL';
    if (d.includes('PROTEGE') || d.includes('STANDARD') || d.includes('FERRE')) return 'FERRE';
    return d;
}

function parseDistance(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
    const normalized = String(value ?? '').trim().replace(/[\s_]/g, '').replace(/m$/i, '');
    const distance = normalized ? Number(normalized) : NaN;
    return Number.isFinite(distance) && distance > 0 ? distance : 0;
}

function parseFinishRank(value) {
    const rank = Number(value);
    return Number.isInteger(rank) && rank > 0 ? rank : 0;
}

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
    if (t.includes('TRES_SOUPLE') || t.includes('TRES SOUPLE')) return 'TRES_SOUPLE';
    if (t.includes('TRES_LOURD') || t.includes('TRES LOURD')) return 'TRES_LOURD';
    if (t.includes('COLLANT')) return 'COLLANT';
    if (t.includes('LOURD'))  return 'LOURD';
    if (t.includes('SOUPLE')) return 'SOUPLE';
    if (t.includes('BON'))    return 'BON';
    if (t.includes('PSF') || t.includes('FIBRE') || t.includes('SYNTHETIC') || t.includes('ALL_WEATHER')) return 'SYNTHETIQUE';
    if (t.includes('HERBE') || t.includes('GAZON')) return 'HERBE';
    if (t.includes('SABLE') || t.includes('POUZZOLANE'))  return 'SABLE';

    return t; // Retourner tel quel si non reconnu
}

function selectionnerPerformances(p, dbHistory) {
    if (Array.isArray(p.performances) && p.performances.length) return p.performances;
    if (Array.isArray(p.dernieresCourses) && p.dernieresCourses.length) return p.dernieresCourses;
    return Array.isArray(dbHistory) ? dbHistory : [];
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
    const perfs = selectionnerPerformances(p, dbHistory);
    
    if (perfs && perfs.length >= 2) {
        const wins = perfs.filter(perf => parseFinishRank(perf.ordreArrivee || perf.classement) === 1);
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
    const perfs = selectionnerPerformances(p, dbHistory);
    if (!Array.isArray(perfs) || perfs.length === 0) return null;

    // v43.1: On stocke maintenant des objets {d, p, t} (distance, place, terrain)
    const structuredHistory = perfs
        .slice(0, 15)
        .map(perf => ({
            d: parseDistance(perf.distance || perf.distanceCourse),
            p: parseFinishRank(perf.ordreArrivee || perf.classement),
            t: normaliserTerrain(perf.terrain)
        }))
        .filter(h => h.d > 0 && h.p > 0);

    return structuredHistory.length > 0 ? JSON.stringify(structuredHistory) : null;
}


/**
 * Transforme les données brutes de l'API PMU en format compatible avec la base de données
 */
export async function processRaces(rawRaces, dayDate, reunionData = {}) {
    return Promise.all(rawRaces.map(async race => {
        const calendarDate = formatDate(dayDate);
        if (!calendarDate) {
            throw new Error(`Date de course invalide (R${race.numReunion ?? '?'} C${race.numOrdre ?? '?'}).`);
        }
        const fallbackDate = new Date(`${calendarDate}T12:00:00.000Z`);
        const requestedDate = race.heureDepart ? new Date(race.heureDepart) : null;
        const hasScheduledTime = Boolean(requestedDate && Number.isFinite(requestedDate.getTime()));
        const raceDate = hasScheduledTime ? requestedDate : fallbackDate;
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
        const distanceCourse = parseDistance(race.distance);

        // v43: Pré-extraction des cotes pour le rang ML (Feature de comparaison relative)
        const allParticipantsCotes = (race.participants || []).filter(p => !isNonRunnerStatus(p.statut)).map(p => ({
            nom: p.nom,
            cote_ref: p.dernierRapportDirect?.rapport || 0
        }));

        // v44: Identifier le favori du marché (cote la plus basse) pour le flag de convergence IA+Marché
        const validCotes = allParticipantsCotes.filter(p => p.cote_ref > 0);
        const marketFavoriteName = validCotes.length > 0
            ? validCotes.reduce((min, p) => p.cote_ref < min.cote_ref ? p : min, validCotes[0]).nom
            : null;

        // Extraction Participants
        const participants = await Promise.all((race.participants || []).map(async p => {
            // v43.1: Récupération de l'historique depuis la DB si l'API est muette
            let dbHistory = [];
            try {
                dbHistory = await getHorseHistory(p.nom, 15, {
                    date: calendarDate,
                    ...(hasScheduledTime ? { time: formatHeure(raceDate) } : {})
                });
            } catch (hErr) {
                dbHistory = [];
            }

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
                ferrage: normaliserFerrage(p.deferre),
                oeilleres: p.oeilleres || 'SANS_OEILLERES',
                nb_courses: p.nombreCourses || 0,
                nb_victoires: p.nombreVictoires || 0,
                nb_places: p.nombrePlaces || 0,
                statut: p.statut || 'PARTANT',
                classement: p.ordreArrivee || null,
                cote_ref: p.dernierRapportDirect?.rapport || 0,
                avis: p.avisEntraineur || null,
                // v43.2: Caractéristiques techniques réelles de l'API PMU
                corde: parseInt(p.placeCorde || p.place || 0), // Corde en PLAT; ne pas la déduire du numéro de cheval
                poids: (() => {
                    if (p.poidsConditionMonte) return p.poidsConditionMonte / 10; // ex: 580 -> 58.0 kg
                    if (p.handicapPoids) return p.handicapPoids / 10;
                    if (p.poids) return parseFloat(p.poids);
                    return 0;
                })(),
                recul: (parseDistance(p.distance) > distanceCourse && distanceCourse > 0)
                    ? (parseDistance(p.distance) - distanceCourse) : 0, // Handicap de distance réel en TROT (ex: 25m)
                // v43.1: Signaux Distance & Terrain (DB Backed)
                distance_course: distanceCourse,
                terrain_prefere: extraireTerrainPrefere(p, dbHistory),
                distances_history: extraireDistancesHistory(p, dbHistory),
                // v44: Flag convergence IA + Marché
                _isMarketFavorite: marketFavoriteName && p.nom === marketFavoriteName
            };

            // Calcul du changement de catégorie
            participantObj.cat_statut = determinerChangementCategorie(participantObj, race.montantPrix || 0);

            return participantObj;
        }));

        const predictionContext = {
            corde: race.corde,
            prixCourse: race.montantPrix || 0,
            discipline: race.discipline,
            distance: distanceCourse,
            terrain
        };
        await Promise.all(participants.map(async participantObj => {
            try {
                const result = await calculerPredictionHybride(participantObj, predictionContext, [], allParticipantsCotes);
                participantObj.prediction_score = result.score;
                participantObj.prediction_heuristic_score = Number.isFinite(result.heuristicScore) ? result.heuristicScore : null;
                participantObj.prediction_features = Array.isArray(result.features)
                    && result.features.length === 15
                    && result.features.every(Number.isFinite)
                    ? result.features : null;
            } catch (err) {
                console.error(`[PROCESSOR] Hybridation échouée pour ${participantObj.nom}:`, err.message);
                participantObj.prediction_score = 0;
                participantObj.prediction_heuristic_score = null;
                participantObj.prediction_features = null;
            }
        }));

        const paris = (race.paris || []).map(p => p.codePari).join(',');

        // AJOUT ORDRE ARRIVÉE GLOBAL
        let ordreArrivee = null;
        if (race.ordreArrivee && Array.isArray(race.ordreArrivee)) {
            // Aplatir le tableau, prendre les 5 premiers (format PMU classique) et joindre avec des tirets
            const officialNumbers = race.ordreArrivee.flat(Infinity)
                .map(value => Number.parseInt(value, 10))
                .filter(number => Number.isInteger(number) && number > 0);
            if (officialNumbers.length) ordreArrivee = officialNumbers.slice(0, 5).join('-');
        }
        // Some programme responses omit race.ordreArrivee while participant details
        // already carry the official classement. Recover the arrival from that source.
        if (!ordreArrivee) {
            const classified = (race.participants || [])
                .map(participant => ({
                    number: Number.parseInt(participant.numPmu, 10),
                    rank: Number.parseInt(participant.ordreArrivee, 10)
                }))
                .filter(participant => Number.isInteger(participant.number) && participant.number > 0
                    && Number.isInteger(participant.rank) && participant.rank > 0 && participant.rank <= 5)
                .sort((a, b) => a.rank - b.rank || a.number - b.number);
            if (classified.length) ordreArrivee = classified.map(participant => participant.number).join('-');
        }

        return {
            date: calendarDate,
            heure: hasScheduledTime ? formatHeure(raceDate) : null,
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
            prediction_model_version: getMLMetadata()?.version || 'heuristic-fallback',
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
