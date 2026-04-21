import { format } from 'date-fns';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
];

function getRandomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const DEFAULT_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://www.pmu.fr/turf/'
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
 * Exécute une requête API directe avec résilience
 */
export async function fetchApi(url, config = {}, retries = 3) {
    const headers = {
        ...DEFAULT_HEADERS,
        'User-Agent': getRandomUA(),
        ...config.headers
    };

    for (let i = 0; i < retries; i++) {
        try {
            // Délai aléatoire entre 500ms et 1500ms pour imiter un humain
            await sleep(500 + Math.random() * 1000);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

            const response = await fetch(url, {
                ...config,
                headers,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.status === 429 || response.status === 403) {
                const waitTime = (i + 1) * 2000;
                console.warn(`[API FETCH RATE-LIMIT] Status ${response.status}. Retry ${i+1}/${retries} after ${waitTime}ms...`);
                await sleep(waitTime);
                continue;
            }

            if (!response.ok) {
                if (response.status === 404 || response.status === 400) return null;
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            if (i === retries - 1) {
                console.error(`[API FETCH ERROR] Final try failed for ${url}:`, error.message);
                return null;
            }
            await sleep(1000 * (i + 1));
        }
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
        console.log(`[API FETCH] Syncing chunk ${Math.floor(i/10)+1}...`);
        await Promise.all(chunk.map(async ({ reunion, course }) => {
            const details = await fetchCourseParticipants(formattedDate, reunion.numOfficiel, course.numOrdre);
            if (details && details.participants) {
                course.participants = details.participants;
            }
            if (course.statut === 'ARRIVEE_DEFINITIVE_COMPLETE' || course.statut === 'ARRIVE_DEFINITIVE') {
                const rapports = await fetchCourseRapports(formattedDate, reunion.numOfficiel, course.numOrdre);
                if (rapports) course.rapportsDefinitifs = rapports;
            }
        }));
        console.log(`[API FETCH] ${Math.min(i + 10, allCoursesToFetch.length)}/${allCoursesToFetch.length} courses traitées.`);
    }

    return programmeData;
}
