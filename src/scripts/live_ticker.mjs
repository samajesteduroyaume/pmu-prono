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

async function fetchValueBets() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error('Serveur injoignable (Lancer: npm start)');
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function fetchStats() {
    try {
        const res = await fetch(STATS_URL);
        return await res.json();
    } catch (e) {
        return null;
    }
}

function clearConsole() {
    process.stdout.write('\x1Bc');
}

function drawLine() {
    console.log(COLORS.DIM + '─'.repeat(process.stdout.columns || 60) + COLORS.RESET);
}

async function tick() {
    const bets = await fetchValueBets();
    const stats = await fetchStats();

    clearConsole();
    
    // Header
    console.log(`${COLORS.BOLD}${COLORS.CYAN}ARCHITECT V40+ | VALUE HUNTER DOMINATOR${COLORS.RESET}`);
    console.log(`${COLORS.DIM}Monitoring actif... ${new Date().toLocaleTimeString()}${COLORS.RESET}`);
    drawLine();

    // Shadow Results
    if (stats) {
        const roiColor = stats.roi >= 0 ? COLORS.GREEN : COLORS.RED;
        process.stdout.write(`${COLORS.BOLD}SHADOW ROI: ${roiColor}${stats.roi?.toFixed(2) || 0}%${COLORS.RESET} | `);
        process.stdout.write(`${COLORS.BOLD}PROFIT: ${roiColor}${stats.total_gains?.toFixed(2) || 0}€${COLORS.RESET} | `);
        process.stdout.write(`WIN RATE: ${COLORS.CYAN}${stats.wins || 0}/${stats.total || 0}${COLORS.RESET}\n`);
        drawLine();
    }

    // Opportunity List
    console.log(`${COLORS.GOLD}${COLORS.BOLD}Opportunités de Trading (Edge > 5%):${COLORS.RESET}\n`);

    if (!bets || bets.length === 0) {
        console.log(`${COLORS.DIM}  [0] Aucune pépite identifiée pour l'instant...${COLORS.RESET}`);
    } else {
        bets.sort((a, b) => b.edge - a.edge).forEach(b => {
            const edgePercent = (b.edge * 100).toFixed(1);
            const probPercent = (b.proba * 100).toFixed(1);
            
            console.log(
                `${COLORS.CYAN}R${b.reunion}C${b.course}${COLORS.RESET} | ` +
                `${COLORS.BOLD}${b.nom.padEnd(14)}${COLORS.RESET} | ` +
                `COTE: ${COLORS.GOLD}${b.cote.toString().padEnd(4)}${COLORS.RESET} | ` +
                `PROB: ${probPercent}% | ` +
                `${COLORS.GREEN}${COLORS.BOLD}EDGE: +${edgePercent}%${COLORS.RESET} | ` +
                `MISE: ${COLORS.BOLD}${b.mise}€${COLORS.RESET}`
            );
        });
    }

    console.log('\n' + COLORS.DIM + 'Pressez Ctrl+C pour quitter. Actualisation: 30s' + COLORS.RESET);
}

// Start
console.log('Initialisation du monitoring...');
setInterval(tick, 30000);
tick();
