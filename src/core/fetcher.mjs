import { chromium } from 'playwright';
import { format } from 'date-fns';

let browser = null;
let page = null;

const DEFAULT_CONFIG = {
    headless: true,
    timeout: 30000,
    maxRetries: 3,
    delayBetweenRequests: 1000
};

/**
 * Initialise le navigateur Playwright et la page.
 * @param {object} config - Options Playwright (headless, timeout...)
 */
export async function initBrowser(config = {}) {
    const conf = { ...DEFAULT_CONFIG, ...config };
    browser = await chromium.launch({ headless: conf.headless, timeout: 60000 });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris'
    });
    await context.addInitScript(() => {
        delete navigator.__proto__.webdriver;
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4] });
        Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
    });
    page = await context.newPage();
    await page.goto('https://www.pmu.fr', { waitUntil: 'networkidle', timeout: conf.timeout });
    await page.waitForTimeout(2000);
}

/**
 * Ferme le navigateur Playwright.
 */
export async function closeBrowser() {
    if (page) await page.close();
    if (browser) await browser.close();
    page = null;
    browser = null;
}

/**
 * Récupère les données de courses pour un jour donné (objet Date ou string ISO).
 * @param {Date|string} day - Date du jour à récupérer
 * @param {object} config - Options (maxRetries, timeout...)
 * @returns {Promise<object|null>} - Données JSON ou null en cas d'échec
 */
export async function fetchDay(day, config = {}) {
    if (!page) throw new Error('Browser not initialized. Call initBrowser() first.');
    const conf = { ...DEFAULT_CONFIG, ...config };
    const formattedDate = format(new Date(day), 'ddMMyyyy');
    const apiUrl = `https://online.turfinfo.api.pmu.fr/rest/client/61/programme/${formattedDate}?meteo=true&specialisation=INTERNET`;

    for (let attempt = 1; attempt <= conf.maxRetries; attempt++) {
        try {
            const response = await page.evaluate(async (url) => {
                const res = await fetch(url, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Referer': 'https://www.pmu.fr/'
                    },
                    credentials: 'include'
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            }, apiUrl);
            return response;
        } catch (error) {
            if (attempt < conf.maxRetries) {
                await page.waitForTimeout(attempt * 2000);
                if (attempt % 2 === 0) {
                    await page.goto('https://www.pmu.fr', { waitUntil: 'networkidle' });
                    await page.waitForTimeout(1000);
                }
            } else {
                return null;
            }
        }
    }
    return null;
} 