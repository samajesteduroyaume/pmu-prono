import { format } from 'date-fns';

const DEFAULT_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://www.pmu.fr/turf/',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Initialise (Stub pour compatibilité avec le reste du code)
 */
export async function initBrowser() {
    return Promise.resolve();
}

/**
 * Ferme (Stub pour compatibilité)
 */
export async function closeBrowser() {
    return Promise.resolve();
}

/**
 * Exécute une requête API directe
 */
export async function fetchApi(url, config = {}) {
    try {
        const response = await fetch(url, {
            headers: DEFAULT_HEADERS,
            ...config
        });

        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`[API FETCH ERROR] ${url}:`, error.message);
        return null;
    }
}

/**
 * Récupère les détails (participants) d'une course spécifique
 */
export async function fetchCourseParticipants(dateStr, r, c) {
    const url = `https://online.turfinfo.api.pmu.fr/rest/client/61/programme/${dateStr}/R${r}/C${c}/participants?specialisation=INTERNET`;
    return await fetchApi(url);
}

/**
 * Récupère les rapports d'une course spécifique
 */
export async function fetchCourseRapports(dateStr, r, c) {
    const url = `https://online.turfinfo.api.pmu.fr/rest/client/61/programme/${dateStr}/R${r}/C${c}/rapports?specialisation=INTERNET`;
    return await fetchApi(url);
}

/**
 * Récupère les données complètes pour un jour
 */
export async function fetchDay(day, config = {}) {
    const formattedDate = format(new Date(day), 'ddMMyyyy');

    // 1. Programme global
    const programmeUrl = `https://online.turfinfo.api.pmu.fr/rest/client/61/programme/${formattedDate}?meteo=true&specialisation=INTERNET`;
    const programmeData = await fetchApi(programmeUrl);

    if (!programmeData || !programmeData.programme || !programmeData.programme.reunions) {
        return programmeData;
    }

    const reunions = programmeData.programme.reunions;
    const allCoursesToFetch = [];

    for (const reunion of reunions) {
        if (!reunion.courses) continue;
        reunion.courses.forEach(course => {
            allCoursesToFetch.push({ reunion, course });
        });
    }

    // Exécution parallèle par groupe de 10 pour éviter le rate-limit
    for (let i = 0; i < allCoursesToFetch.length; i += 10) {
        const chunk = allCoursesToFetch.slice(i, i + 10);
        await Promise.all(chunk.map(async ({ reunion, course }) => {
            const details = await fetchCourseParticipants(formattedDate, reunion.numOfficiel, course.numOrdre);
            if (details && details.participants) {
                course.participants = details.participants;
            }
            if (course.statut === 'ARRIVEE_DEFINITIVE_COMPLETE' || course.statut === 'ARRIVEE') {
                const rapports = await fetchCourseRapports(formattedDate, reunion.numOfficiel, course.numOrdre);
                if (rapports) course.rapportsDefinitifs = rapports;
            }
        }));
    }

    return programmeData;
}
