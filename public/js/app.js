const API_URL = '/api/courses';

// State
let allCourses = [];
let currentView = 'dashboard';

// Init
document.addEventListener('DOMContentLoaded', async () => {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('current-date').textContent = 'ARCHITECT v27.1 | ' + new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

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

// Dashboard Data
let profitChart = null;

// Dashboard Data
async function renderDashboard(days = null) {
    try {
        const url = days ? `/api/performance?days=${days}` : '/api/performance';
        const res = await fetch(url);
        const perf = await res.json();
        const global = perf.global;

        document.getElementById('stat-total-courses').textContent = global.total_courses;
        document.getElementById('stat-win-rate').textContent = `${global.win_rate}%`;
        document.getElementById('stat-roi').textContent = `${global.roi}%`;

        const sideProfit = document.getElementById('stat-profit-sidebar');
        sideProfit.textContent = `${global.total_profit > 0 ? '+' : ''}${global.total_profit.toFixed(2)} €`;
        sideProfit.className = `bankroll-value ${global.total_profit >= 0 ? 'positive' : 'negative'}`;

        // Opportunity Alert
        await loadQuintePrediction();
        await loadOpportunities();

        // UPDATE CHART
        updateProfitChart(perf.history);

        // V28: CHARGER LES TENDANCES
        await loadTendances(days);

        // V29: GÉNÉRER ET CHARGER LES ALERTES
        await refreshAlerts();

    } catch (e) {
        console.error("Dashboard Render Error", e);
    }
}

// V28: CHARGEMENT DES TENDANCES
async function loadTendances(days = null) {
    try {
        const url = days ? `/api/tendances?days=${days}` : '/api/tendances';
        const res = await fetch(url);
        const tendances = await res.json();

        // V29: Charger également les Golden Patterns optimisés
        try {
            const resOpt = await fetch('/api/patterns/optimized');
            const optData = await resOpt.json();
            if (optData.goldenPatterns && optData.goldenPatterns.length > 0) {
                tendances.patterns.golden = optData.goldenPatterns;
            }
        } catch (e) {
            console.warn("Optimized patterns unavailable", e);
        }

        // Badge de tendance
        const tendanceLabel = document.getElementById('tendance-label');
        tendanceLabel.textContent = tendances.tendance.tendance;
        tendanceLabel.className = `tendance-badge ${tendances.tendance.tendance.toLowerCase()}`;

        // Momentum
        const momentumValue = document.getElementById('momentum-value');
        const momentumBar = document.getElementById('momentum-bar');
        momentumValue.textContent = tendances.momentum;
        momentumBar.style.width = `${tendances.momentum}%`;

        // Couleur selon momentum
        if (tendances.momentum >= 70) {
            momentumValue.style.color = '#00ff88';
        } else if (tendances.momentum >= 40) {
            momentumValue.style.color = '#ffaa00';
        } else {
            momentumValue.style.color = '#ff4444';
        }

        // Séquence
        const sequenceValue = document.getElementById('sequence-value');
        const sequenceDepuis = document.getElementById('sequence-depuis');

        if (tendances.sequence.count > 0) {
            const icon = tendances.sequence.type === 'WIN' ? '🔥' : '❄️';
            const label = tendances.sequence.type === 'WIN' ? 'Victoires' : 'Défaites';
            sequenceValue.textContent = `${icon} ${tendances.sequence.count} ${label}`;
            sequenceValue.className = `metric-value sequence-${tendances.sequence.type.toLowerCase()}`;
            sequenceDepuis.textContent = `Depuis le ${tendances.sequence.depuis}`;
        } else {
            sequenceValue.textContent = 'Aucune';
            sequenceDepuis.textContent = '';
        }

        // Drawdown
        const drawdownValue = document.getElementById('drawdown-value');
        const drawdownMax = document.getElementById('drawdown-max');
        drawdownValue.textContent = `${(tendances.drawdown.currentPercent * 100).toFixed(1)}%`;
        drawdownMax.textContent = `${(tendances.drawdown.maxPercent * 100).toFixed(1)}%`;

        // Couleur selon drawdown
        if (tendances.drawdown.currentPercent > 0.15) {
            drawdownValue.style.color = '#ff4444';
        } else if (tendances.drawdown.currentPercent > 0.05) {
            drawdownValue.style.color = '#ffaa00';
        } else {
            drawdownValue.style.color = '#00ff88';
        }

        // Sharpe
        const sharpeValue = document.getElementById('sharpe-value');
        sharpeValue.textContent = tendances.sharpe.toFixed(2);

        // Couleur selon Sharpe
        if (tendances.sharpe >= 1.5) {
            sharpeValue.style.color = '#00ff88';
        } else if (tendances.sharpe >= 0.5) {
            sharpeValue.style.color = '#ffaa00';
        } else {
            sharpeValue.style.color = '#ff4444';
        }

        // Patterns
        if (tendances.patterns && (tendances.patterns.meilleureDiscipline || tendances.patterns.hippodromesPerformants.length > 0)) {
            const patternsInfo = document.getElementById('patterns-info');
            const patternsContent = document.getElementById('patterns-content');

            let html = '';
            if (tendances.patterns.meilleureDiscipline) {
                html += `<div>✅ Meilleure discipline: <strong>${tendances.patterns.meilleureDiscipline}</strong></div>`;
            }
            if (tendances.patterns.meilleureHeure) {
                html += `<div>⏰ Meilleure plage horaire: <strong>${tendances.patterns.meilleureHeure}</strong></div>`;
            }
            if (tendances.patterns.hippodromesPerformants.length > 0) {
                html += `<div>🏇 Hippodromes performants: <strong>${tendances.patterns.hippodromesPerformants.join(', ')}</strong></div>`;
            }
            if (tendances.patterns.meilleursJours.length > 0) {
                html += `<div>📅 Meilleurs jours: <strong>${tendances.patterns.meilleursJours.join(', ')}</strong></div>`;
            }

            // V29: Affichage des Golden Patterns
            if (tendances.patterns.golden && tendances.patterns.golden.length > 0) {
                html += `<div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,215,0,0.1)">
                            <div style="color:var(--emerald); font-weight:900; margin-bottom:5px">🏆 GOLDEN PATTERNS (V29)</div>
                            ${tendances.patterns.golden.slice(0, 3).map(gp => `
                                <div style="font-size:0.75rem; margin-bottom:3px; display:flex; justify-content:space-between">
                                    <span>🌟 ${gp.pattern}</span>
                                    <span style="color:var(--gold)">ROI: ${gp.roi}%</span>
                                </div>
                            `).join('')}
                         </div>`;
            }

            patternsContent.innerHTML = html;
            patternsInfo.style.display = 'block';
        }

    } catch (e) {
        console.error("Erreur chargement tendances:", e);
    }
}


// V29: GESTION DES ALERTES
let alertsVisible = false;
let lastAlertCount = 0;

async function loadAlerts() {
    try {
        const res = await fetch('/api/alerts');
        const data = await res.json();

        const alerts = data.alerts;
        const stats = data.stats;

        // Mettre à jour le badge
        const badge = document.getElementById('alerts-badge');
        const count = document.getElementById('alerts-count');
        const toggleBtn = document.getElementById('alerts-toggle-btn');

        if (stats.total > 0) {
            badge.textContent = stats.total;
            count.textContent = stats.total;
            toggleBtn.style.display = 'flex';

            // Jouer un son si nouvelles alertes
            if (stats.total > lastAlertCount && lastAlertCount > 0) {
                playAlertSound();
            }
            lastAlertCount = stats.total;
        } else {
            toggleBtn.style.display = 'none';
            lastAlertCount = 0;
        }

        // Afficher les alertes
        const container = document.getElementById('alerts-container');

        if (alerts.length === 0) {
            container.innerHTML = `
                <div class="alerts-empty">
                    <div class="alerts-empty-icon">✓</div>
                    <div>Aucune alerte active</div>
                </div>
            `;
        } else {
            container.innerHTML = alerts.map(alert => renderAlert(alert)).join('');
        }

    } catch (e) {
        console.error("Erreur chargement alertes:", e);
    }
}

function renderAlert(alert) {
    const time = new Date(alert.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    let recommendationHtml = '';
    if (alert.data && alert.data.recommendation) {
        recommendationHtml = `
            <div class="alert-recommendation">
                💡 ${alert.data.recommendation}
            </div>
        `;
    }

    return `
        <div class="alert-item ${alert.type}" data-id="${alert.id}">
            <div class="alert-title">
                <span>${alert.title}</span>
                <button class="alert-dismiss" onclick="dismissAlert(${alert.id}, event)">✕</button>
            </div>
            <div class="alert-message">${alert.message}</div>
            ${recommendationHtml}
            <div class="alert-meta">
                <span>${time}</span>
                <span>Priorité: ${alert.priority === 3 ? 'HAUTE' : alert.priority === 2 ? 'MOYENNE' : 'BASSE'}</span>
            </div>
        </div>
    `;
}

function toggleAlertsPanel() {
    const panel = document.getElementById('alerts-panel');
    alertsVisible = !alertsVisible;
    panel.style.display = alertsVisible ? 'block' : 'none';
}

async function dismissAlert(alertId, event) {
    event.stopPropagation();

    try {
        const res = await fetch(`/api/alerts/dismiss/${alertId}`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            // Retirer visuellement l'alerte
            const alertElement = document.querySelector(`.alert-item[data-id="${alertId}"]`);
            if (alertElement) {
                alertElement.style.opacity = '0';
                alertElement.style.transform = 'translateX(100px)';
                setTimeout(() => {
                    loadAlerts(); // Recharger toutes les alertes
                }, 300);
            }
        }
    } catch (e) {
        console.error("Erreur dismiss alerte:", e);
    }
}

async function dismissAllAlerts() {
    try {
        const res = await fetch('/api/alerts/dismiss-all', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            loadAlerts();
            toggleAlertsPanel();
        }
    } catch (e) {
        console.error("Erreur dismiss all:", e);
    }
}

async function refreshAlerts() {
    // Générer de nouvelles alertes basées sur les tendances actuelles
    try {
        const res = await fetch('/api/alerts/generate');
        const data = await res.json();

        if (data.success) {
            console.log(`${data.generated} nouvelles alertes générées`);
            loadAlerts();
        }
    } catch (e) {
        console.error("Erreur refresh alertes:", e);
    }
}

function playAlertSound() {
    // Créer un son simple avec Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
        console.log("Son d'alerte non disponible");
    }
}

// Charger les alertes au démarrage et toutes les 30 secondes
window.addEventListener('load', () => {
    loadAlerts();
    setInterval(loadAlerts, 30000); // Refresh toutes les 30s
});

async function loadOpportunities() {
    console.log("🚀 [DEBUG] loadOpportunities() CALLED");
    const container = document.getElementById('latest-opportunities');
    if (!container) {
        console.error("❌ [DEBUG] Container #latest-opportunities NOT FOUND");
        return;
    }

    container.innerHTML = '<div class="loading-inline">Analyse des engagements...</div>';

    try {
        console.log("📡 [DEBUG] Fetching /api/opportunities/retard-de-gain...");
        const res = await fetch('/api/opportunities/retard-de-gain?days=3');
        const targets = await res.json();
        console.log("✅ [DEBUG] Opportunities received:", targets.length);

        if (targets.length === 0) {
            container.innerHTML = '<div style="color:var(--text-dim); padding:10px; text-align:center">🛡️ AUCUNE ANOMALIE DÉTECTÉE (R.A.S)</div>';
            return;
        }

        const html = targets.slice(0, 5).map(t => {
            return `
                <div class="opportunity-card" style="display:flex; justify-content:space-between; align-items:center; padding:12px; margin-bottom:8px; background:rgba(255, 215, 0, 0.05); border-left:3px solid var(--gold); border-radius:4px">
                    <div>
                        <div style="font-weight:bold; color:var(--text-primary)">
                            <span style="color:var(--gold)">${t.cheval}</span> 
                            <small style="color:var(--text-dim)">(${t.date})</small>
                        </div>
                        <div style="font-size:0.75rem; color:var(--text-dim)">
                            R${t.reunion} C${t.course} • ${t.hippodrome} 
                        </div>
                    </div>
                    <div style="text-align:right">
                        <div style="color:var(--emerald); font-weight:800; font-family:'JetBrains Mono'">
                            +${t.diff_percent}% VALUE
                        </div>
                        <div style="font-size:0.7rem; color:var(--text-dim)" title="Gains Moyens/Course vs Moyenne Course">
                            ${t.ratio_cheval} vs ${t.ratio_moyen_course}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        if (targets.length > 5) {
            container.innerHTML += `<div style="text-align:center; font-size:0.8rem; color:var(--gold); margin-top:5px">+ ${targets.length - 5} autres opportunités détectées</div>`;
        }

    } catch (e) {
        console.error("❌ [DEBUG] Error in loadOpportunities:", e);
        container.innerHTML = `<div style="color:var(--ruby)">Erreur chargement opportunités: ${e.message}</div>`;
    }
}

async function loadQuintePrediction() {
    const container = document.getElementById('quinte-prediction');
    const infoLabel = document.getElementById('quinte-info');

    try {
        const res = await fetch('/api/quinte/prediction');
        if (!res.ok) throw new Error("Pas de Quinté trouvé");
        const data = await res.json();

        const { course, selection, tocard } = data;

        infoLabel.textContent = `R${course.reunionNum} C${course.courseNum} • ${course.hippodrome}`;

        // Render Selection (Top 5)
        let html = '';
        selection.forEach((p, index) => {
            let rankClass = 'quinte-base';
            let rankLabel = 'BASE';
            let color = 'var(--gold)';

            if (index > 1) {
                rankClass = 'quinte-outsider';
                rankLabel = 'CHANCE';
                color = 'var(--emerald)';
            }
            if (index === 4 && tocard && p.rowid === tocard.rowid) { // Si le 5ème est le tocard
                rankClass = 'quinte-tocard';
                rankLabel = 'TOCARD';
                color = 'var(--ruby)';
            }

            html += `
                <div style="margin:5px; padding:10px; background:rgba(255,255,255,0.05); border-radius:8px; min-width:80px; text-align:center; border-bottom:2px solid ${color}">
                    <div style="font-size:1.5rem; font-weight:900; color:${color}">${p.numero}</div>
                    <div style="font-size:0.8rem; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100px">${p.nom}</div>
                    <div style="font-size:0.6rem; color:var(--text-dim); margin-top:4px">${rankLabel}</div>
                </div>
            `;
        });

        container.innerHTML = html;

    } catch (e) {
        container.innerHTML = `<div style="color:var(--text-dim); font-size:0.8rem">Pas de Quinté+ identifié aujourd'hui ou données insuffisantes.</div>`;
        if (infoLabel) infoLabel.textContent = "";
    }
}

// === CHART ENGINE ===
function updateProfitChart(history) {
    const ctx = document.getElementById('profitChart');
    if (!ctx) return;

    // Calcul Moyenne Mobile (7 jours)
    const maPeriod = 7;
    const movingAverage = history.map((entry, index, arr) => {
        if (index < maPeriod - 1) return null;
        const slice = arr.slice(index - maPeriod + 1, index + 1);
        const sum = slice.reduce((a, b) => a + b.cumulative, 0);
        return sum / maPeriod;
    });

    // Calcul Plages de Volatilité (Min/Max sur fenêtre glissante)
    const rangeMin = history.map((entry, index, arr) => {
        if (index < maPeriod - 1) return null;
        const slice = arr.slice(index - maPeriod + 1, index + 1);
        return Math.min(...slice.map(s => s.cumulative));
    });

    const rangeMax = history.map((entry, index, arr) => {
        if (index < maPeriod - 1) return null;
        const slice = arr.slice(index - maPeriod + 1, index + 1);
        return Math.max(...slice.map(s => s.cumulative));
    });

    const labels = history.map(h => h.date);
    const dataPoints = history.map(h => h.cumulative);

    // Initialisation ou Mise à jour
    if (profitChart) {
        profitChart.data.labels = labels;
        profitChart.data.datasets[0].data = dataPoints;
        profitChart.data.datasets[1].data = movingAverage;
        profitChart.data.datasets[2].data = rangeMin;
        profitChart.data.datasets[3].data = rangeMax;
        profitChart.update();
    } else {
        profitChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Profit Cumulé (€)',
                        data: dataPoints,
                        borderColor: '#ffd700',
                        backgroundColor: 'rgba(255, 215, 0, 0.1)',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 1,
                        fill: true
                    },
                    {
                        label: 'Moyenne Mobile (7j)',
                        data: movingAverage,
                        borderColor: '#00ccff',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        hidden: !document.getElementById('check-ma').checked
                    },
                    {
                        label: 'Plage Min',
                        data: rangeMin,
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        borderWidth: 0,
                        pointRadius: 0,
                        fill: '+1', // Fill to next dataset (Max)
                        hidden: !document.getElementById('check-range').checked
                    },
                    {
                        label: 'Plage Max',
                        data: rangeMax,
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 0,
                        pointRadius: 0,
                        hidden: !document.getElementById('check-range').checked
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index',
                },
                plugins: {
                    legend: {
                        labels: { color: '#aaa', font: { family: 'Montserrat' } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 20, 0, 0.9)',
                        titleColor: '#ffd700',
                        bodyColor: '#fff',
                        borderColor: '#333',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#666' }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#666' }
                    }
                }
            }
        });
    }
}

window.updateChartVisibility = function () {
    if (!profitChart) return;
    const showMA = document.getElementById('check-ma').checked;
    const showRange = document.getElementById('check-range').checked;

    profitChart.setDatasetVisibility(1, showMA);
    profitChart.setDatasetVisibility(2, showRange);
    profitChart.setDatasetVisibility(3, showRange);
    profitChart.update();
};

// Global scope for HTML onclick
window.updateStats = function (days) {
    // Update Active Button
    const buttons = document.querySelectorAll('.roi-filters button');
    buttons.forEach(btn => btn.classList.remove('active'));

    // Find clicked button based on text or onclick attribute logic if needed, 
    // but here we just style the clicked one if we had the event. 
    // Simpler: just reload dashboard.
    // Ideally we would pass 'this' or find the button by value.
    // Let's just re-render.

    // Visual update of buttons (approximate selection)
    buttons.forEach(btn => {
        if (days === null && btn.textContent === 'MAX') btn.classList.add('active');
        else if (btn.textContent.includes(days + 'J') || btn.textContent.includes(days + 'M') || btn.textContent.includes(days + 'AN')) {
            // This is a bit loose but works for the current text
            if (days === 1 && btn.textContent === '1JN') return; // conflict avoidance
            btn.classList.add('active');
        }
    });

    renderDashboard(days);
};

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

            // BLINKING RED FOR RETARD DE GAIN
            const nameClass = p.is_retard_gain ? 'blinking-red' : '';

            return `
                                <div class="horse-card ${p.prediction_score > 60 || p.cat_statut === 'DESCENTE' ? 'top-pick' : ''}">
                                    <div style="display:flex; justify-content:space-between; align-items:center">
                                        <strong class="performance-glow ${glowClass} ${nameClass}">${catArrow}#${p.numero} ${p.nom}</strong>
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
                    <h3 style="color:var(--gold); margin-bottom:15px; display:flex; align-items:center; gap:10px">
                        <span>🧠</span> IA STRATEGY (TOP 5)
                    </h3>
                    <div style="display:flex; flex-direction:column; gap:10px">
                        ${parts.slice(0, 5).map((p, idx) => {
            let rankColor = '#CD7F32'; // Default Bronze-ish
            let rankIcon = '🎖️';

            if (idx === 0) { rankColor = '#FFD700'; rankIcon = '🥇'; }
            else if (idx === 1) { rankColor = '#C0C0C0'; rankIcon = '🥈'; }
            else if (idx === 2) { rankColor = '#CD7F32'; rankIcon = '🥉'; }
            else if (idx === 3) { rankColor = '#50c878'; rankIcon = '4️⃣'; }
            else if (idx === 4) { rankColor = '#e0115f'; rankIcon = '5️⃣'; }

            return `
                            <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; border-left:3px solid ${rankColor}">
                                <div style="display:flex; justify-content:space-between; margin-bottom:5px">
                                    <span style="color:${rankColor}; font-weight:bold">${rankIcon} #${p.numero} ${p.nom}</span>
                                    <span style="font-family:'JetBrains Mono'; font-weight:800">${p.prediction_score} pts</span>
                                </div>
                                <div style="font-size:0.75rem; color:var(--text-dim); display:grid; grid-template-columns: 1fr 1fr; gap:5px">
                                    <div>🎵 ${p.musique || 'Inc.'}</div>
                                    <div style="text-align:right">⚙️ ${p.ferrage}</div>
                                    <div>👁️ ${p.oeilleres === 'SANS_OEILLERES' ? 'NON' : p.oeilleres}</div>
                                    <div style="text-align:right">
                                        ${p.kelly_suggestion?.mise > 0 ? `KELLY: ${p.kelly_suggestion.mise.toFixed(2)}€` : ''}
                                        ${p.is_money_time ? '<br><span class="live-badge" style="margin-top:2px">📉 MONEY DROP</span>' : ''}
                                        ${p.is_retard_gain ? '<br><span class="live-badge blinking-red" style="margin-top:2px; border-color:var(--ruby); color:var(--ruby)">🚨 RETARD GAIN (+15)</span>' : ''}
                                        ${p.is_track_specialist ? '<br><span class="live-badge" style="margin-top:2px; border-color:var(--gold); color:var(--gold)">🏆 TRACK LOVER</span>' : ''}
                                        ${p.is_specialist ? '<br><span class="live-badge" style="margin-top:2px; border-color:var(--emerald); color:var(--emerald)">🔍 HYPER-SPECIALIST</span>' : ''}
                                        ${p.active_engine ? `<br><span class="live-badge" style="margin-top:2px; border-color:var(--pmu-green-light); color:var(--pmu-green-light); font-size:0.55rem">⚙️ ${p.active_engine}</span>` : ''}
                                        ${p.is_shielded ? '<br><span class="live-badge" style="margin-top:2px; border-color:var(--ruby); color:var(--ruby)">🛡️ SHIELDED / FAIL RISK</span>' : ''}
                                        ${p.xai_details?.activePatterns?.length > 0 ? `
                                            <div style="margin-top:10px; padding:5px; background:rgba(0,255,136,0.1); border-radius:4px; font-size:0.6rem; color:var(--pmu-green-light); font-weight:bold">
                                                🎯 PATTERN DETECTÉ : ${p.xai_details.activePatterns[0].pattern}
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                            `;
        }).join('')}
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
