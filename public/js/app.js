const API_URL = '/api/courses';

// State Management
let allCourses = [];
let currentView = 'dashboard';

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    if (!document.getElementById('view-dashboard')) return;

    initUI();
    refreshData();

    // Live Sync Polling (Every 60s)
    setInterval(() => {
        if (currentView === 'courses') syncMarket(true);
    }, 60000);
});

function initUI() {
    const today = new Date();
    const dateStr = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    document.getElementById('current-date').innerHTML = `<span class="live-indicator"></span> TERMINAL LIVE • ${dateStr}`;
}

async function refreshData() {
    // Show skeletons
    if (currentView === 'dashboard') {
        const container = document.getElementById('quinte-container');
        if (container) container.innerHTML = renderQuinteSkeleton();
    } else if (currentView === 'courses') {
        const tbody = document.getElementById('courses-table-body');
        if (tbody) tbody.innerHTML = renderTableSkeleton(8, 8);
    }

    await loadData();
    updateUI();
}

async function loadData(page = 1, filters = {}) {
    try {
        const params = new URLSearchParams({ page, limit: 100, ...filters });
        const res = await fetch(`${API_URL}?${params}`);
        const response = await res.json();
        allCourses = response.data || [];
        window.currentPage = page;
        window.totalPages = response.pagination?.totalPages || 1;
    } catch (e) {
        console.error("Data Load Error:", e);
    }
}

function updateUI() {
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'courses') renderScanner();
}

// Navigation Logic
window.showPage = (pageId) => {
    if (currentView === pageId) return;
    
    currentView = pageId;
    
    // Update Nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const targetNav = document.getElementById(`nav-${pageId}`);
    if (targetNav) targetNav.classList.add('active');

    // Transition Animation
    const stage = document.querySelector('.main-stage');
    stage.style.opacity = '0';
    stage.style.transform = 'translateY(10px)';
    
    setTimeout(() => {
        // Update View
        document.querySelectorAll('.view').forEach(el => el.style.display = 'none');
        const targetView = document.getElementById(`view-${pageId}`);
        if (targetView) targetView.style.display = 'block';

        // Update Title
        const titleMap = {
            'dashboard': 'Analyse Spéciale Quinté+',
            'courses': 'Scanner de Marché Exhaustif'
        };
        document.getElementById('stage-title').textContent = titleMap[pageId] || 'Architect v43.3';

        refreshData();
        
        stage.style.transition = 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
        stage.style.opacity = '1';
        stage.style.transform = 'translateY(0)';
    }, 200);
};

// Skeleton Generators
function renderQuinteSkeleton() {
    return `
        <div class="stat-card skeleton-card">
            <div class="skeleton skeleton-title" style="width: 200px;"></div>
            <div class="skeleton skeleton-text" style="width: 300px;"></div>
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 32px; margin-top: 32px;">
                <div class="skeleton" style="height: 300px;"></div>
                <div class="skeleton" style="height: 300px;"></div>
            </div>
        </div>
    `;
}

function renderTableSkeleton(rows, cols) {
    let html = '';
    for (let i = 0; i < rows; i++) {
        html += '<tr>';
        for (let j = 0; j < cols; j++) {
            html += `<td><div class="skeleton skeleton-text" style="width: ${Math.random() * 50 + 50}%"></div></td>`;
        }
        html += '</tr>';
    }
    return html;
}

// Dashboard Renderer
async function renderDashboard(days = 30) {
    try {
        const url = days ? `/api/performance?days=${days}` : '/api/performance';
        const res = await fetch(url);
        const perf = await res.json();
        const global = perf.global;

        const bankrollEl = document.getElementById('stat-bankroll-display');
        if (bankrollEl) animateValue('stat-bankroll-display', global.total_profit.toFixed(2) + ' €');

        renderQuinte();
    } catch (e) {
        console.error("Dashboard Render Error:", e);
    }
}

async function renderQuinte() {
    const container = document.getElementById('quinte-container');
    if (!container) return;

    try {
        const res = await fetch('/api/courses/quinte/prediction');
        if (res.status === 404) {
            container.innerHTML = '<div class="stat-card" style="text-align: center; color: var(--text-med); padding: 60px;">Aucun Quinté+ détecté pour aujourd\'hui.</div>';
            return;
        }
        const data = await res.json();
        const { course, selection, tocard } = data;

        container.innerHTML = `
            <div class="stat-card" style="border-left: 4px solid var(--accent-gold); margin-bottom: 32px; animation: fadeIn 0.8s ease-out;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <div>
                        <span class="badge badge-warning" style="margin-bottom: 12px;">ÉVÉNEMENT QUINTÉ+</span>
                        <h2 style="font-size: 32px; color: var(--text-pure); letter-spacing: -1px;">${course.hippodrome}</h2>
                        <div style="color: var(--text-med); font-size: 14px; font-weight: 600;">R${course.reunionNum} C${course.courseNum} • ${course.heure} • ${course.discipline} • ${course.distance}m</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 11px; color: var(--text-low); font-weight: 800; letter-spacing: 1px;">PRIX TOTAL</div>
                        <div style="font-size: 24px; font-weight: 800; color: var(--accent-gold); font-family: 'JetBrains Mono';">${course.prix.toLocaleString()} €</div>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 40px;">
                    <div>
                        <h3 style="font-size: 12px; color: var(--accent-indigo); text-transform: uppercase; margin-bottom: 20px; font-weight: 800; letter-spacing: 2px;">Sélection de l'Intelligence</h3>
                        <div class="data-table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Nom du Cheval</th>
                                        <th>Cote</th>
                                        <th>Score IA</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${selection.map((p, i) => `
                                        <tr style="${i === 0 ? 'background: hsla(var(--h-indigo), 84%, 67%, 0.05);' : ''}">
                                            <td style="font-weight: 800; color: var(--accent-indigo); font-family: 'JetBrains Mono'">${p.numero}</td>
                                            <td>
                                                <div style="font-weight: 700; color: var(--text-pure); display: flex; align-items: center; gap: 8px; font-size: 16px;">
                                                    ${p.nom}
                                                    ${p.is_smart_money ? '<i class="fas fa-bolt" style="color: var(--accent-gold); font-size: 12px;" title="Smart Money"></i>' : ''}
                                                </div>
                                                <div style="font-size: 11px; color: var(--text-low); font-style: italic; margin-top: 4px;">${p.musique || '--'}</div>
                                            </td>
                                            <td style="font-weight: 800; color: var(--accent-gold); font-family: 'JetBrains Mono'">${p.cote_ref || '--'}</td>
                                            <td>
                                                <div class="badge ${p.score > 75 ? 'badge-success' : 'badge-warning'}">${p.score}%</div>
                                                <div class="progress-container" style="width: 60px;">
                                                    <div class="progress-bar" style="width: ${p.score}%; background: ${p.score > 75 ? 'var(--accent-emerald)' : 'var(--accent-gold)'}"></div>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 24px;">
                        <div class="stat-card" style="background: hsla(var(--h-gold), 96%, 60%, 0.02); border-color: hsla(var(--h-gold), 96%, 60%, 0.2); padding: 24px;">
                            <label style="color: var(--accent-gold)">Le Tocard de l'IA</label>
                            ${tocard ? `
                                <div style="font-size: 24px; font-weight: 800; color: var(--text-pure);">${tocard.numero}. ${tocard.nom}</div>
                                <div style="font-size: 14px; color: var(--text-med); margin-top: 8px;">Cote: <span style="color: var(--accent-gold); font-weight: 800;">${tocard.cote_ref}</span></div>
                                <div style="margin-top: 16px; font-size: 11px; color: var(--accent-emerald); font-weight: 800; letter-spacing: 1px;">ALERTE SPÉCULATION +${tocard.score}%</div>
                            ` : '<div style="color: var(--text-low);">Aucun tocard détecté.</div>'}
                        </div>

                        <div class="stat-card" style="background: hsla(var(--h-indigo), 84%, 67%, 0.02); border-color: hsla(var(--h-indigo), 84%, 67%, 0.2); padding: 24px;">
                            <label style="color: var(--accent-indigo)">Conseil de Jeu</label>
                            <div style="font-size: 16px; font-weight: 800; margin-bottom: 12px;">STRATÉGIE ÉLITE</div>
                            <div style="font-size: 13px; color: var(--text-med); margin-bottom: 8px;">Base: <span style="color: var(--text-pure); font-weight: 800; font-family: 'JetBrains Mono'">${selection[0].numero}-${selection[1].numero}</span></div>
                            <div style="font-size: 13px; color: var(--text-med);">Champ: <span style="color: var(--text-pure); font-weight: 600; font-family: 'JetBrains Mono'">${selection.slice(2, 6).map(p => p.numero).join(', ')}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error("Quinté Render Error:", e);
    }
}

function renderScanner() {
    const tbody = document.getElementById('courses-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    const sorted = [...allCourses].sort((a, b) => a.heure.localeCompare(b.heure));

    sorted.forEach((c, index) => {
        const row = document.createElement('tr');
        row.style.animation = `fadeIn 0.5s ease-out ${index * 0.05}s both`;
        const edge = parseFloat((c.ia_score / 100 - (1 / (c.fav_cote || 1))).toFixed(4));
        const edgeColor = edge > 0.05 ? 'var(--accent-emerald)' : 'var(--text-low)';

        row.innerHTML = `
            <td style="font-family: 'JetBrains Mono'; font-weight: 800; color: var(--accent-indigo)">${c.heure}</td>
            <td>
                <div style="font-weight: 700; color: var(--text-pure)">${c.hippodrome}</div>
                <div style="font-size: 11px; color: var(--text-low); font-weight: 600;">R${c.reunionNum} C${c.courseNum} • ${c.discipline}</div>
            </td>
            <td>
                <div style="font-weight: 800; color: var(--text-high); display: flex; align-items: center; gap: 10px;">
                    ${c.top_horse || '---'}
                    ${c.cat_trend === 'DOWN' ? '<span class="badge badge-success" style="font-size: 8px; padding: 4px 8px;">DÉCLASSÉ</span>' : ''}
                </div>
            </td>
            <td>
                <div class="badge ${c.ia_score > 75 ? 'badge-success' : 'badge-warning'}">${c.ia_score || 0}%</div>
            </td>
            <td style="font-weight: 800; color: var(--accent-gold); font-family: 'JetBrains Mono'">${c.fav_cote || '--'}</td>
            <td style="color: ${edgeColor}; font-weight: 800; font-family: 'JetBrains Mono'">+${(edge * 100).toFixed(1)}%</td>
            <td style="font-family: 'JetBrains Mono'; font-weight: 800; color: var(--accent-emerald)">${c.ordre_arrivee || 'À VENIR'}</td>
            <td>
                <button onclick="showDetails(${c.id})" class="nav-item" style="padding: 10px 20px; font-size: 11px; border: 1px solid var(--glass-border); border-radius: 8px;">
                    DETAILS
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function animateValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.transition = 'all 0.3s ease';
    el.style.transform = 'scale(1.1)';
    el.textContent = value;
    setTimeout(() => el.style.transform = 'scale(1)', 300);
}

// Sync Utilities
window.syncHistoryPrompt = async () => {
    const days = prompt("Profondeur de synchronisation (jours, max 30) :", "7");
    if (!days || isNaN(days)) return;

    const btn = event.currentTarget;
    const icon = btn.querySelector('i');
    icon.className = 'fas fa-spinner fa-spin';
    
    try {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: parseInt(days) })
        });
        const data = await res.json();
        if (data.success) {
            refreshData();
        }
    } catch (e) {
        console.error("Sync Error:", e);
    } finally {
        icon.className = 'fas fa-history';
    }
};

window.syncMarket = async (silent = false) => {
    const btn = document.querySelector('.fa-sync-alt')?.parentElement;
    const icon = document.querySelector('.fa-sync-alt');
    if (!silent && icon) icon.className = 'fas fa-spinner fa-spin';
    
    try {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: 1 })
        });
        const data = await res.json();
        if (data.success) {
            refreshData();
        }
    } catch (e) {
        console.error("Sync Error:", e);
    } finally {
        if (!silent && icon) icon.className = 'fas fa-sync-alt';
    }
};

window.closeModal = () => {
    const modal = document.getElementById('modal-details');
    modal.style.opacity = '0';
    setTimeout(() => modal.style.display = 'none', 300);
};

window.showDetails = async (id) => {
    const modal = document.getElementById('modal-details');
    const body = document.getElementById('modal-body');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => modal.style.opacity = '1', 10);
    
    body.innerHTML = `
        <div style="padding: 40px; text-align: center;">
            <div class="skeleton skeleton-title" style="margin: 0 auto 20px;"></div>
            <div class="skeleton skeleton-text" style="margin: 0 auto 10px;"></div>
            <div class="skeleton skeleton-text" style="margin: 0 auto 10px; width: 60%;"></div>
        </div>
    `;

    try {
        const res = await fetch(`/api/courses/${id}/details`);
        const data = await res.json();
        
        body.innerHTML = `
            <div style="margin-bottom: 32px; animation: fadeIn 0.5s ease-out;">
                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px;">
                    <div>
                        <h3 style="font-size: 12px; color: var(--accent-indigo); text-transform: uppercase; font-weight: 800; letter-spacing: 2px;">Contexte de Course</h3>
                        <div style="font-size: 24px; font-weight: 800; color: var(--text-pure); margin-top: 8px;">${data.course.hippodrome} • ${data.course.discipline}</div>
                        <div style="font-size: 13px; color: var(--text-med); margin-top: 4px; font-weight: 600;">${data.course.distance}m • ${data.course.terrain || 'Standard'} • ${data.course.prix.toLocaleString()} €</div>
                    </div>
                    <div style="text-align: right;">
                        <span class="badge badge-warning">ALGORITHME V43.3</span>
                    </div>
                </div>

                <div class="data-table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Cheval</th>
                                <th>Score IA</th>
                                <th>Cote</th>
                                <th>Classe</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.participants.map(p => `
                                <tr>
                                    <td style="font-weight: 800; color: var(--accent-indigo); font-family: 'JetBrains Mono'">${p.numero}</td>
                                    <td>
                                        <div style="font-weight: 700; color: var(--text-pure); font-size: 16px;">${p.nom}</div>
                                        <div style="font-size: 10px; color: var(--text-low); font-family: 'JetBrains Mono'; margin-top: 4px;">${p.musique}</div>
                                    </td>
                                    <td>
                                        <div class="badge ${p.prediction_score > 75 ? 'badge-success' : 'badge-warning'}">${p.prediction_score}%</div>
                                    </td>
                                    <td style="font-weight: 800; color: var(--accent-gold); font-family: 'JetBrains Mono'">${p.cote_ref || '--'}</td>
                                    <td>
                                        ${p.cat_trend === 'DOWN' ? '<span style="color: var(--accent-emerald); font-weight: 800; font-size: 11px;"><i class="fas fa-arrow-down"></i> DOWN</span>' : '<span style="color: var(--text-low); font-size: 11px;">STABLE</span>'}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (e) {
        body.innerHTML = `<div style="color: var(--accent-crimson); padding: 40px; text-align: center;">Erreur de chargement des vecteurs.</div>`;
    }
};
