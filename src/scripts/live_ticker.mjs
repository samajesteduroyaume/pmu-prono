import logger from '../utils/logger.mjs';

const API_URL = 'http://localhost:3000/api/value-hunter';
const STATS_URL = 'http://localhost:3000/api/performance/shadow';

const COLORS = {
    GREEN: '\x1b[32m',
    CYAN: '\x1b[36m',
    GOLD: '\x1b[33m',
    RED: '\x1b[31m',
    RESET: '\x1b[0m',
    BOLD: '\x1b[1m',
    DIM: '\x1b[2m'
};

function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}

async function fetchValueBets() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(`API Value Hunter indisponible (${res.status})`);
        const data = await res.json();
        return Array.isArray(data) ? data : null;
    } catch (e) {
        logger.warn(`Lecture Value Hunter impossible : ${e.message}`);
        return null;
    }
}

async function fetchStats() {
    try {
        const res = await fetch(STATS_URL);
        if (!res.ok) throw new Error(`API statistiques indisponible (${res.status})`);
        const data = await res.json();
        return data && typeof data === 'object' && !data.error ? data : null;
    } catch (e) {
        logger.warn(`Lecture des statistiques impossible : ${e.message}`);
        return null;
    }
}

function clearConsole() {
    process.stdout.write('\x1Bc');
}

function drawLine() {
    console.log(COLORS.DIM + '─'.repeat(process.stdout.columns || 60) + COLORS.RESET);
}

let tickInProgress = false;

async function tick() {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
        const bets = await fetchValueBets();
        const stats = await fetchStats();

        clearConsole();
    
        // Header
        console.log(`${COLORS.BOLD}${COLORS.CYAN}ARCHITECT V40+ | VALUE HUNTER DOMINATOR${COLORS.RESET}`);
        console.log(`${COLORS.DIM}Monitoring actif... ${new Date().toLocaleTimeString()}${COLORS.RESET}`);
        drawLine();

        // Shadow Results
        if (stats) {
            const roi = finiteNumber(stats.roi);
            const totalGains = finiteNumber(stats.total_gains);
            const roiColor = Number.isFinite(roi) && roi >= 0 ? COLORS.GREEN : COLORS.RED;
            process.stdout.write(`${COLORS.BOLD}SHADOW ROI: ${roiColor}${Number.isFinite(roi) ? roi.toFixed(2) : 'N/A'}%${COLORS.RESET} | `);
            process.stdout.write(`${COLORS.BOLD}PROFIT: ${roiColor}${Number.isFinite(totalGains) ? totalGains.toFixed(2) : 'N/A'}€${COLORS.RESET} | `);
            process.stdout.write(`WIN RATE: ${COLORS.CYAN}${stats.wins || 0}/${stats.total || 0}${COLORS.RESET}\n`);
            drawLine();
        }

        // Opportunity List
        console.log(`${COLORS.GOLD}${COLORS.BOLD}Opportunités de Trading (Edge > 5%):${COLORS.RESET}\n`);

        if (!bets || bets.length === 0) {
            console.log(`${COLORS.DIM}  [0] Aucune pépite identifiée pour l'instant...${COLORS.RESET}`);
        } else {
            bets.sort((a, b) => Number(b.edge) - Number(a.edge)).forEach(b => {
                const edge = finiteNumber(b.edge);
                const probability = finiteNumber(b.proba);
                const edgePercent = Number.isFinite(edge) ? (edge > 1 ? edge : edge * 100).toFixed(1) : 'N/A';
                const probPercent = Number.isFinite(probability) ? (probability <= 1 ? probability * 100 : probability).toFixed(1) : 'N/A';
                const horseName = String(b.nom || 'Inconnu');
                const odds = finiteNumber(b.cote);

                console.log(
                    `${COLORS.CYAN}R${b.reunion}C${b.course}${COLORS.RESET} | ` +
                    `${COLORS.BOLD}${horseName.padEnd(14)}${COLORS.RESET} | ` +
                    `COTE: ${COLORS.GOLD}${Number.isFinite(odds) ? String(odds).padEnd(4) : 'N/A'}${COLORS.RESET} | ` +
                    `PROB: ${probPercent}% | ` +
                    `${COLORS.GREEN}${COLORS.BOLD}EDGE: +${edgePercent}%${COLORS.RESET} | ` +
                    `MISE: ${COLORS.BOLD}${b.mise ?? 'N/A'}€${COLORS.RESET}`
                );
            });
        }

        console.log('\n' + COLORS.DIM + 'Pressez Ctrl+C pour quitter. Actualisation: 30s' + COLORS.RESET);
    } catch (error) {
        logger.error(`Erreur d’actualisation du moniteur : ${error.message}`);
    } finally {
        tickInProgress = false;
    }
}

// Start
console.log('Initialisation du monitoring...');
setInterval(tick, 30000);
tick();
