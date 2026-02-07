const API_URL = '/api/courses';

// State
let allCourses = [];
let currentView = 'dashboard';

// Init
document.addEventListener('DOMContentLoaded', async () => {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('current-date').textContent = 'PMU PRONO V22 | ' + new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

    const filterDateInput = document.getElementById('filter-date');
    if (filterDateInput) filterDateInput.value = today;

    refreshData();

    // LIVE POLLING ENGINE (Every 60s)
    setInterval(() => {
        const isCurrentDay = document.getElementById('filter-date').value === new Date().toISOString().split('T')[0];
        if (isCurrentDay && currentView === 'courses') {
            triggerLiveSync();
        }
    }, 60000);
});

async function triggerLiveSync() {
    const indicator = document.getElementById('live-indicator');
    if (indicator) indicator.style.borderColor = 'var(--pmu-green-light)';

    try {
        const res = await fetch('/api/sync/live');
        const data = await res.json();
        if (data.success) {
            console.log(`Live Sync OK: ${data.count} courses updated.`);
            await refreshData();
        }
    } catch (e) {
        console.error("Live Sync Error", e);
    } finally {
        if (indicator) indicator.style.borderColor = 'var(--pmu-green)';
    }
}

async function refreshData() {
    await loadData();
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'courses') renderScanner();
}

// Navigation
window.showPage = (pageId) => {
    currentView = pageId;
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.terminal-nav a').forEach(el => el.classList.remove('active'));

    const targetView = document.getElementById(`view-${pageId}`);
    const targetNav = document.getElementById(`nav-${pageId}`);

    if (targetView) targetView.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    if (pageId === 'courses') renderScanner();
    if (pageId === 'dashboard') renderDashboard();
};

async function loadData(page = 1, filters = {}) {
    try {
        console.log("Loading data for page:", page, "with filters:", filters);
        const params = new URLSearchParams({ page, limit: 50, ...filters });
        const res = await fetch(`${API_URL}?${params}`);
        const response = await res.json();
        console.log("API Response received:", response);
        allCourses = response.data || [];
        window.currentPage = page;
        window.totalPages = response.pagination?.totalPages || 1;
        console.log("allCourses updated, count:", allCourses.length);
    } catch (e) {
        console.error("Terminal Load Error:", e);
    }
}

async function renderDashboard() {
    try {
        const res = await fetch('/api/performance');
        const perf = await res.json();
        const global = perf.global;

        document.getElementById('stat-total-courses').textContent = global.total_courses;
        document.getElementById('stat-win-rate').textContent = `${global.win_rate}%`;
        document.getElementById('stat-roi').textContent = `${global.roi}%`;

        const sideProfit = document.getElementById('stat-profit-sidebar');
        sideProfit.textContent = `${global.total_profit > 0 ? '+' : ''}${global.total_profit.toFixed(2)} €`;
        sideProfit.className = `bankroll-value ${global.total_profit >= 0 ? 'positive' : 'negative'}`;

        // Opportunity Alert (Simulation simple pour l'instant)
        const oppList = document.getElementById('latest-opportunities');
        oppList.innerHTML = '<div style="color:var(--text-dim)">SCAN COMPLET : AUCUNE VALUE ALERTE IMMÉDIATE</div>';

    } catch (e) { console.error("Dashboard Render Error", e); }
}

function renderScanner() {
    const tbody = document.querySelector('#courses-table tbody');
    tbody.innerHTML = '';

    // Tri : Date puis Heure
    const sorted = [...allCourses].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.heure.localeCompare(b.heure);
    });

    sorted.forEach(c => {
        const tr = document.createElement('tr');

        let meteoIcon = '❓';
        if (c.meteo) {
            const lib = (c.meteo.nebulositeLibelleCourt || '').toLowerCase();
            if (lib.includes('beau') || lib.includes('soleil')) meteoIcon = '☀️';
            else if (lib.includes('couvert') || lib.includes('nuage')) meteoIcon = '☁️';
            else if (lib.includes('pluie')) meteoIcon = '🌧️';
        }

        const iaScore = c.ia_score || (c.nb_participants_stockes > 0 ? 'CALCUL...' : '--');
        const iaColor = c.ia_score > 70 ? 'var(--gold)' : (c.ia_score > 40 ? 'var(--text-primary)' : 'var(--text-dim)');

        // Calcul de la classe de lueur
        let glowClass = '';
        let catArrow = '';

        if (c.cat_statut === 'DESCENTE') {
            glowClass = 'glow-descente';
            catArrow = '<span class="cat-arrow cat-down">↓</span>';
        } else {
            if (c.ia_score >= 85) glowClass = 'glow-extreme';
            else if (c.ia_score >= 70) glowClass = 'glow-high';
            else if (c.ia_score >= 55) glowClass = 'glow-med';
            else if (c.ia_score >= 40) glowClass = 'glow-low';
            if (c.cat_statut === 'MONTEE') catArrow = '<span class="cat-arrow cat-up">↑</span>';
        }

        if (glowClass) console.log(`[DEBUG UI] R${c.reunionNum}C${c.courseNum} - Glow: ${glowClass}, Cat: ${c.cat_statut}`);

        tr.innerHTML = `
            <td><strong style="color:var(--gold)">${c.heure}</strong></td>
            <td><small style="color:var(--text-dim)">R${c.reunionNum} C${c.courseNum}</small></td>
            <td style="font-weight:700">${c.hippodrome}</td>
            <td>${catArrow}<span class="performance-glow ${glowClass}">${c.ia_nom || '--'}</span></td>
            <td style="font-family:'JetBrains Mono'; color:${iaColor}">${iaScore}</td>
            <td style="color:var(--text-dim); font-size:0.8rem">${c.fav_nom || '--'}</td>
            <td style="font-weight:800; color:var(--emerald)">${c.fav_cote || '--'}</td>
            <td style="font-size:0.75rem">${c.distance}m</td>
            <td title="${c.meteo?.nebulositeLibelleLong || 'Stable'}" style="font-size:1.2rem">${meteoIcon}</td>
            <td style="font-family:'JetBrains Mono'; color:var(--gold); font-weight:800; font-size:0.85rem">${c.ordre_arrivee || '--'}</td>
            <td>
                <button onclick="showDetails(${c.id})" class="terminal-btn-gold" style="padding:5px 10px; font-size:0.7rem">DÉTAILS</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.syncMarket = async function () {
    const fDate = document.getElementById('filter-date').value;
    await performSync({ date: fDate, days: 1 });
};

window.syncHistory = async function (days) {
    const fDate = document.getElementById('filter-date').value;
    let warning = `Confirmer la synchronisation de ${days} jours à partir du ${fDate} ?`;

    if (days >= 30) {
        warning = `⚠️ ATTENTION : Synchronisation massive de ${days} jours détectée.\nCela peut prendre plusieurs minutes et ralentir le terminal.\n\nConfirmer l'exécution ?`;
    }

    if (!confirm(warning)) return;
    await performSync({ date: fDate, days });
};

async function performSync(payload) {
    const btn = document.getElementById('btn-sync');
    const status = document.getElementById('sync-status');
    const icon = document.getElementById('sync-icon');

    btn.disabled = true;
    if (icon) icon.classList.add('terminal-spin');
    status.style.display = 'block';

    const periodDesc = payload.days >= 30 ? (payload.days >= 365 ? "1 AN" : Math.floor(payload.days / 30) + " MOIS") : payload.days + " JOURS";
    status.innerHTML = `<span class="terminal-loader"></span> SYNCHRONISATION MASTER EN COURS : ${periodDesc}...`;
    status.className = 'terminal-alert';

    try {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            status.innerHTML = `SUCCESS: ${data.count} COURSES RÉCUPÉRÉES SUR ${payload.days} JOURS.`;
            status.className = 'terminal-alert success';
            setTimeout(() => { if (status) status.style.display = 'none'; }, 5000);
            await refreshData();
        } else {
            throw new Error(data.error || 'Err');
        }
    } catch (e) {
        status.innerHTML = `ERROR: ${e.message}`;
        status.className = 'terminal-alert danger';
        console.error("Sync Error:", e);
    } finally {
        btn.disabled = false;
        if (icon) icon.classList.remove('terminal-spin');
    }
}

window.filterTable = async function () {
    const fDate = document.getElementById('filter-date').value;
    const fDisc = document.getElementById('filter-discipline').value;
    await loadData(1, { date: fDate, discipline: fDisc });
    renderScanner();
};

window.showDetails = async (id) => {
    const modal = document.getElementById('modal-details');
    const body = document.getElementById('modal-body');
    modal.style.display = 'block';

    body.innerHTML = '<div style="text-align:center;padding:100px;font-size:1.5rem">DECODING IA VECTORS...</div>';

    try {
        const res = await fetch(`/api/courses/${id}/participants`);
        const parts = await res.json();

        if (!parts.length) {
            body.innerHTML = '<div style="text-align:center;padding:100px">AUCUNE DONNÉE TROUVÉE</div>';
            return;
        }

        body.innerHTML = `
            <div style="display:grid; grid-template-columns: 2fr 1fr; gap:30px">
                <div>
                    <h2 style="font-family:Montserrat; font-size:2rem; margin-bottom:20px">${parts[0].hippodrome || 'COURSE'}</h2>
                    <div class="horse-grid">
                        ${parts.map(p => {
            let glowClass = '';
            let catArrow = '';

            if (p.cat_statut === 'DESCENTE') {
                glowClass = 'glow-descente';
                catArrow = '<span class="cat-arrow cat-down">↓</span>';
            } else {
                if (p.prediction_score >= 85) glowClass = 'glow-extreme';
                else if (p.prediction_score >= 70) glowClass = 'glow-high';
                else if (p.prediction_score >= 55) glowClass = 'glow-med';
                else if (p.prediction_score >= 40) glowClass = 'glow-low';
                if (p.cat_statut === 'MONTEE') catArrow = '<span class="cat-arrow cat-up">↑</span>';
            }

            return `
                                <div class="horse-card ${p.prediction_score > 60 || p.cat_statut === 'DESCENTE' ? 'top-pick' : ''}">
                                    <div style="display:flex; justify-content:space-between; align-items:center">
                                        <strong class="performance-glow ${glowClass}">${catArrow}#${p.numero} ${p.nom}</strong>
                                        <span style="color:var(--pmu-green); font-weight:800">${p.prediction_score} pts</span>
                                    </div>
                                    <div style="font-size:0.75rem; color:var(--text-dim); margin-top:8px; display:flex; flex-direction:column; gap:4px">
                                        <div style="display:flex; justify-content:space-between">
                                            <span>${p.driver}</span>
                                            <span style="color:var(--gold); font-weight:700">${p.musique || '--'}</span>
                                        </div>
                                        <div style="display:flex; gap:10px; font-size:0.65rem; text-transform:uppercase">
                                            <span>⚙️ ${p.ferrage}</span>
                                            <span>👁️ ${p.oeilleres === 'SANS_OEILLERES' ? 'SANS' : p.oeilleres}</span>
                                            <span style="color:${p.cat_statut === 'DESCENTE' ? 'var(--purple)' : (p.cat_statut === 'MONTEE' ? 'var(--ruby)' : 'inherit')}">
                                                📊 ${p.cat_statut === 'STABLE' ? 'NIVEAU OK' : p.cat_statut}
                                            </span>
                                        </div>
                                    </div>
                                    <div style="margin-top:12px; display:flex; justify-content:space-between; align-items:center">
                                        <span style="font-weight:800; font-size:1.2rem; font-family:'JetBrains Mono'">${p.cote_ref || '--'}</span>
                                        ${p.kelly_suggestion?.mise > 0 ? `<span class="kelly-tag">KELLY: ${p.kelly_suggestion.mise}€</span>` : ''}
                                    </div>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>
                <div class="glass-card" style="border-left: 2px solid var(--gold)">
                    <h3 style="color:var(--gold); margin-bottom:20px">IA STRATEGY</h3>
                    <div style="background:rgba(255,255,255,0.05); padding:15px; border-radius:10px">
                        <div style="font-size:0.7rem; color:var(--text-dim)">BEST PROBABILITY</div>
                        <div style="font-size:1.5rem; font-weight:800">${parts[0].nom}</div>
                        <hr style="margin:15px 0; border:0; border-top:1px solid #333">
                        <div style="font-size:0.7rem; color:var(--text-dim)">KELLY ADVICE</div>
                        <div style="font-size:1.1rem; color:var(--emerald)">${parts[0].kelly_suggestion?.advice || 'WAIT'}</div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        body.innerHTML = `<div style="color:var(--ruby)">ERROR: ${e.message}</div>`;
    }
};

window.closeModal = () => { document.getElementById('modal-details').style.display = 'none'; };

window.runBacktestUI = async function () {
    const s = document.getElementById('backtest-start').value;
    const e = document.getElementById('backtest-end').value;
    if (!s || !e) return alert("SELECT DATES");

    document.getElementById('backtest-results').style.display = 'none';
    document.getElementById('backtest-loader').style.display = 'block';

    try {
        const res = await fetch('/api/backtest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startDate: s, endDate: e })
        });
        const data = await res.json();

        document.getElementById('bt-roi').textContent = `${data.summary.roi}%`;
        document.getElementById('bt-profit').textContent = `${data.summary.profit} €`;

        const tbody = document.querySelector('#backtest-history-table tbody');
        tbody.innerHTML = data.history.slice(-10).map(h => `
            <tr>
                <td>${h.date}</td>
                <td>${h.course}</td>
                <td>${h.selection}</td>
                <td style="color:${h.resultat === 'WIN' ? 'var(--emerald)' : 'var(--ruby)'}">${h.resultat}</td>
            </tr>
        `).join('');

        document.getElementById('backtest-loader').style.display = 'none';
        document.getElementById('backtest-results').style.display = 'block';
    } catch (err) { alert(err.message); }
};
