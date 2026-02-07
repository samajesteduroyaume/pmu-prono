const API_URL = '/api/courses';

// State
let allCourses = [];
let currentView = 'dashboard';

// --- FONCTIONS EXPERTES (Client-side) ---
function getCatBadge(p) {
    if (!p.nb_courses || p.nb_courses < 3) return { txt: 'STABLE', class: 'cat-stable' };
    const gainMoyen = p.gains / p.nb_courses;
    const prix = p.prix_course || 20000;

    if (gainMoyen > prix * 0.8) return { txt: '📉 DESCENTE', class: 'cat-down' };
    if (gainMoyen < (prix / 10)) return { txt: '📈 MONTÉE', class: 'cat-up' };
    return { txt: 'STABLE', class: 'cat-stable' };
}

function getRegScore(p) {
    if (!p.nb_courses) return 0;
    return Math.round(((p.nb_victoires + p.nb_places) / p.nb_courses) * 100);
}
// ----------------------------------------

// Init
document.addEventListener('DOMContentLoaded', async () => {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const filterDateInput = document.getElementById('filter-date');
    if (filterDateInput) filterDateInput.value = today;

    // Chargement asynchrone sans bloquer l'UI
    loadData().then(() => {
        if (currentView === 'dashboard') renderPerformanceDashboard();
        if (currentView === 'courses') renderCoursesTable();
    });
});

// Navigation
window.showPage = (pageId) => {
    currentView = pageId;
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar nav a').forEach(el => el.classList.remove('active'));

    const targetView = document.getElementById(`view-${pageId}`);
    const targetNav = document.getElementById(`nav-${pageId}`);

    if (targetView) targetView.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    if (pageId === 'courses') renderCoursesTable();
    if (pageId === 'dashboard') renderPerformanceDashboard();
};

async function loadData(page = 1, filters = {}) {
    try {
        const params = new URLSearchParams({
            page,
            limit: 50,
            ...filters
        });

        const res = await fetch(`${API_URL}?${params}`);
        const response = await res.json();

        allCourses = response.data || [];
        window.currentPage = page;
        window.totalPages = response.pagination?.totalPages || 1;

        console.log(`Elite Data Loaded : ${allCourses.length} courses (Page ${page}/${window.totalPages})`);
    } catch (e) {
        console.error("Critical Load Error:", e);
    }
}

function updatePaginationControls() {
    const paginationDiv = document.getElementById('pagination-controls');
    if (!paginationDiv) return;

    const currentPage = window.currentPage || 1;
    const totalPages = window.totalPages || 1;

    paginationDiv.innerHTML = `
        <button onclick="loadPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} class="btn-pagination" style="padding:10px 20px; background:var(--bg-card); border:1px solid var(--border); border-radius:10px; color:white; cursor:pointer;">← Précédent</button>
        <span class="page-info" style="color:var(--text-dim); font-weight:600;">Page ${currentPage} / ${totalPages}</span>
        <button onclick="loadPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''} class="btn-pagination" style="padding:10px 20px; background:var(--bg-card); border:1px solid var(--border); border-radius:10px; color:white; cursor:pointer;">Suivant →</button>
    `;
}

window.loadPage = async function (page) {
    const totalPages = window.totalPages || 1;
    if (page < 1 || page > totalPages) return;

    const filterDate = document.getElementById('filter-date')?.value;
    const filterDisc = document.getElementById('filter-discipline')?.value;

    await loadData(page, { date: filterDate, discipline: filterDisc });
    renderCoursesTable();
    updatePaginationControls();
};

async function renderPerformanceDashboard() {
    try {
        const res = await fetch('/api/performance');
        const perf = await res.json();
        const global = perf.global;

        // Mise à jour des KPI réels
        document.getElementById('stat-total-courses').textContent = global.total_courses;
        document.getElementById('stat-win-rate').textContent = `${global.win_rate}%`;
        document.getElementById('stat-roi').textContent = `${global.roi > 0 ? '+' : ''}${global.roi}%`;
        document.getElementById('stat-profit').textContent = `${global.total_profit > 0 ? '+' : ''}${global.total_profit} €`;

        // Couleur dynamique ROI
        const roiEl = document.getElementById('stat-roi');
        const profitEl = document.getElementById('stat-profit');
        if (global.roi > 0) {
            roiEl.style.color = '#00f2ad';
            profitEl.style.color = '#00f2ad';
        } else if (global.roi < 0) {
            roiEl.style.color = '#ff4d6d';
            profitEl.style.color = '#ff4d6d';
        }

        // Chart ROI / Profit Cumulative
        const ctxA = document.getElementById('chartActivity').getContext('2d');
        if (window.myChartA) window.myChartA.destroy();
        window.myChartA = new Chart(ctxA, {
            type: 'line',
            data: {
                labels: perf.history.map(h => new Date(h.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })),
                datasets: [{
                    label: 'Capital Cumulé (Mise 1€)',
                    data: perf.history.map(h => h.cumulative),
                    borderColor: global.total_profit >= 0 ? '#00f2ad' : '#ff4d6d',
                    backgroundColor: global.total_profit >= 0 ? 'rgba(0, 242, 173, 0.1)' : 'rgba(255, 77, 109, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 6,
                    pointBackgroundColor: '#d4af37',
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#94a3b8' } }
                },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                }
            }
        });

        // Chart Distribution Win/Loss
        const ctxD = document.getElementById('chartDisciplines').getContext('2d');
        if (window.myChartD) window.myChartD.destroy();
        window.myChartD = new Chart(ctxD, {
            type: 'doughnut',
            data: {
                labels: ['Favoris IA Gagnants', 'Échecs'],
                datasets: [{
                    data: [global.wins, global.total_courses - global.wins],
                    backgroundColor: ['#00f2ad', '#ff4d6d'],
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '80%',
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 20 } }
                }
            }
        });

        // Charger statistiques avancées
        const resAdv = await fetch('/api/performance/advanced');
        const advanced = await resAdv.json();

        // Afficher nouveaux KPI
        document.getElementById('stat-top3').textContent = `${advanced.top3_rate}%`;
        document.getElementById('stat-confidence').textContent = advanced.avg_confidence.toFixed(1);

        // Meilleur rapport
        if (advanced.best_rapport) {
            document.getElementById('stat-best-cote').textContent = `${advanced.best_rapport.cote_ref.toFixed(2)}`;
            document.getElementById('stat-best-details').textContent = `${advanced.best_rapport.nom} - ${new Date(advanced.best_rapport.date).toLocaleDateString('fr-FR')}`;
        }

        // Insights
        if (advanced.insights.best_hippodrome) {
            document.getElementById('insight-hippodrome').textContent = advanced.insights.best_hippodrome.name;
            document.getElementById('insight-hippodrome-rate').textContent = `${advanced.insights.best_hippodrome.win_rate}% (${advanced.insights.best_hippodrome.total} courses)`;
        }

        if (advanced.insights.best_driver) {
            document.getElementById('insight-driver').textContent = advanced.insights.best_driver.name;
            document.getElementById('insight-driver-rate').textContent = `${advanced.insights.best_driver.win_rate}% (${advanced.insights.best_driver.total} courses)`;
        }

        // Meilleure discipline
        const disciplines = advanced.by_discipline;
        let bestDisc = null;
        let bestRate = 0;
        Object.keys(disciplines).forEach(disc => {
            const rate = parseFloat(disciplines[disc].win_rate);
            if (rate > bestRate) {
                bestRate = rate;
                bestDisc = disc;
            }
        });
        if (bestDisc) {
            document.getElementById('insight-discipline').textContent = bestDisc;
            document.getElementById('insight-discipline-rate').textContent = `${bestRate}% (${disciplines[bestDisc].total} courses)`;
        }

    } catch (e) {
        console.error("Perf Render Error:", e);
    }
}

function renderCoursesTable() {
    const tbody = document.querySelector('#courses-table tbody');
    tbody.innerHTML = '';

    const filterTxt = document.getElementById('search-input').value.toLowerCase();
    const filterDisc = document.getElementById('filter-discipline').value;
    const filterDate = document.getElementById('filter-date')?.value;

    const filtered = allCourses.filter(c => {
        const matchesTxt = c.hippodrome.toLowerCase().includes(filterTxt);
        const matchesDisc = !filterDisc || c.discipline === filterDisc;
        const matchesDate = !filterDate || c.date === filterDate;
        return matchesTxt && matchesDisc && matchesDate;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:100px; color:var(--text-dim)">
            <div style="font-size:2rem; margin-bottom:10px">🤷‍♂️</div>
            Aucune course trouvée pour ces critères.<br>
            <small>Vérifiez la date ou lancez une synchronisation.</small>
        </td></tr>`;
        return;
    }

    // Tri : Date décroissante puis Heure croissante
    filtered.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return a.heure.localeCompare(b.heure);
    });

    filtered.slice(0, 50).forEach(c => {
        const tr = document.createElement('tr');

        let meteoIcon = '❓';
        if (c.meteo) {
            const lib = (c.meteo.nebulositeLibelleCourt || '').toLowerCase();
            if (lib.includes('beau') || lib.includes('soleil')) meteoIcon = '☀️';
            else if (lib.includes('couvert') || lib.includes('nuage')) meteoIcon = '☁️';
            else if (lib.includes('pluie')) meteoIcon = '🌧️';
        }

        const isTerminee = !!c.ordre_arrivee;
        const statusHtml = isTerminee ? `<span class="status-pill win">TERMINÉE</span>` : `<span class="status-pill pending">PROGRAMMÉE</span>`;

        tr.innerHTML = `
            <td>
                <div style="font-weight:800; color:var(--accent)">${c.heure}</div>
                <div style="font-size:0.75rem; color:var(--text-dim)">${c.date}</div>
            </td>
            <td><strong style="font-family:'JetBrains Mono'">R${c.reunionNum} C${c.courseNum}</strong></td>
            <td><span style="font-weight:600">${c.hippodrome}</span></td>
            <td><span class="tag-discipline" style="color:var(--secondary)">${c.discipline}</span></td>
            <td>${c.distance}m</td>
            <td>${statusHtml}</td>
            <td>${meteoIcon} ${c.meteo?.temperature ? c.meteo.temperature + '°' : ''}</td>
            <td>
                <button onclick="showDetails(${c.id})" class="btn-action">ANALYSER</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.filterTable = async function () {
    const filterDate = document.getElementById('filter-date')?.value;
    const filterDisc = document.getElementById('filter-discipline')?.value;

    await loadData(1, { date: filterDate, discipline: filterDisc });
    renderCoursesTable();
    updatePaginationControls();
};

function formatMusiquePro(musique) {
    if (!musique) return '--';
    return musique.replace(/([0-9])([a-zA-Z])/g, '<span class="m-val">$1</span><span class="m-type">$2</span>')
        .replace(/D/g, '<span style="color:var(--danger);font-weight:800">D</span>');
}

window.showDetails = async (id) => {
    const course = allCourses.find(c => c.id === id);
    if (!course) return;

    const modal = document.getElementById('modal-details');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');

    title.textContent = `${course.hippodrome} | ELITE ANALYSIS`;

    body.innerHTML = '<div style="text-align:center;padding:100px"><span class="loader"></span> DÉCODAGE DES VECTEURS IA EN COURS...</div>';
    modal.style.display = 'block';

    try {
        const res = await fetch(`/api/courses/${id}/participants`);
        const participants = await res.json();

        // Suggestion IA
        const favorites = participants.slice(0, 3);
        const outsider = participants.find(p => p.prediction_score > 40 && p.cote_ref > 15) || participants[4] || participants[0];

        let participantsHtml = `
            <div class="horse-grid">
                ${participants.map((p, i) => {
            const cat = getCatBadge(p);
            const reg = getRegScore(p);
            const oeill = p.oeilleres && p.oeilleres !== 'SANS_OEILLERES' ? '👁️' : '';

            return `
                    <div class="horse-card ${i === 0 ? 'top-ia' : ''} ${p.classement === 1 ? 'real-winner' : ''}">
                        <div class="horse-num">${p.numero}</div>
                        <div class="horse-header">
                            <div class="horse-name">${p.nom} ${oeill}</div>
                            <div class="horse-ia-score" title="Cœur de l'algorithme V14 Discipline-Aware">${Math.round(p.prediction_score)} <span style="font-size:0.6rem; vertical-align:middle; opacity:0.6">pts</span></div>
                        </div>
                        <div class="horse-expert-row" style="display:flex; gap:5px; margin-bottom:10px;">
                            <span class="badge ${cat.class}" style="font-size:0.65rem; margin:0">${cat.txt}</span>
                            <span class="badge" style="background:#4cc9f0; color:#000; font-size:0.65rem; margin:0">REG: ${reg}%</span>
                        </div>
                        <div class="horse-meta" style="font-size:0.8rem;color:var(--text-dim)">
                            <div>${p.driver} | ${p.entraineur}</div>
                            <div style="margin-top:5px; color:var(--accent)">Ferrage: <strong>${p.ferrage}</strong></div>
                        </div>
                        <div class="horse-musique">
                            ${formatMusiquePro(p.musique)}
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div class="cate" style="font-weight:800;font-size:1.1rem">${p.cote_ref || '--'}</div>
                            ${p.classement ? `<div class="rank-badge">${p.classement}${p.classement === 1 ? 'er' : 'e'}</div>` : ''}
                        </div>
                    </div>
                `;
        }).join('')}
            </div>
        `;

        const ticketHtml = `
            <div class="ticket-suggestion">
                <h3 style="color:var(--accent); margin-bottom:15px; font-weight:800">💡 SUGGESTION TICKET ELITE</h3>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:20px">
                    <div class="glass-card">
                        <strong>LE BANQUIER</strong>
                        <div style="font-size:1.5rem; color:var(--success); margin:10px 0">${favorites[0].nom} (#${favorites[0].numero})</div>
                        <p style="font-size:0.8rem; color:var(--text-dim)">Probabilité IA : ${Math.round(favorites[0].prediction_score)}%</p>
                    </div>
                    <div class="glass-card">
                        <strong>L'OUTSIDER</strong>
                        <div style="font-size:1.5rem; color:var(--warning); margin:10px 0">${outsider.nom} (#${outsider.numero})</div>
                        <p style="font-size:0.8rem; color:var(--text-dim)">Cote : ${outsider.cote_ref}</p>
                    </div>
                    <div class="glass-card">
                        <strong>COUP DE POKER</strong>
                        <div style="font-size:1.5rem; color:var(--danger); margin:10px 0">${favorites[1].nom} + ${favorites[2].nom}</div>
                        <p style="font-size:0.8rem; color:var(--text-dim)">Couplé Placé Gagnant</p>
                    </div>
                </div>
            </div>
        `;

        const arriveeTxt = course.ordre_arrivee ? course.ordre_arrivee.split(',').join(' - ') : 'Attente arrivée...';

        let rapportsHtml = '';
        if (course.rapports) {
            try {
                const raps = JSON.parse(course.rapports);
                if (raps && raps.paysParieur && raps.paysParieur[0].rapports) {
                    const list = raps.paysParieur[0].rapports;
                    rapportsHtml = `
                        <div class="glass-card" style="margin-top:20px; border: 1px solid var(--accent)">
                            <h4 style="color:var(--accent); margin-bottom:15px">💰 RAPPORTS OFFICIELS (pour 1€)</h4>
                            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:10px">
                                ${list.map(r => `
                                    <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center">
                                        <span style="font-size:0.7rem; color:var(--text-dim); text-transform:uppercase">${r.libellePari.replace('E_', '')}</span>
                                        <span style="font-weight:800; color:var(--accent)">${(r.dividende / 100).toFixed(2)}€</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }
            } catch (e) { console.error("Rapport parse error", e); }
        }

        body.innerHTML = `
            <div class="course-header-details">
                <div class="glass-card">
                    <h4 style="color:var(--accent)">PARAMÈTRES DE COURSE</h4>
                    <p style="font-size:0.9rem; margin-top:10px; line-height:1.5">${course.conditions || '-'}</p>
                    <div style="display:flex; gap:10px; margin-top:20px">
                        <span class="tag-discipline">${course.discipline}</span>
                        <span class="tag-discipline" style="color:var(--secondary)">${course.distance}m</span>
                        <span class="tag-discipline" style="color:var(--warning)">${course.prix.toLocaleString()} €</span>
                    </div>
                </div>
                <div class="glass-card" style="border-left: 5px solid var(--accent)">
                    <h4 style="color:var(--accent)">RÉSULTATS OFFICIELS</h4>
                    <div style="font-size:2rem; font-weight:800; margin:15px 0" id="official-arrival">${arriveeTxt}</div>
                    <p style="color:var(--text-dim)">Météo : ${course.meteo?.nebulositeLibelleLong || 'Stable'}</p>
                </div>
            </div>
            
            ${rapportsHtml}

            <div class="ia-branding">
                <span style="font-weight:800; font-size:1.2rem">AI ARCHITECT ELITE V14</span>
                <span style="font-size:0.8rem; opacity:0.8">Calcul probabiliste par Discipline (Trot, Plat, Obstacle)</span>
            </div>
            ${participantsHtml}
            ${ticketHtml}
        `;
    } catch (e) {
        body.innerHTML = `<p style="color:var(--danger); text-align:center; padding:50px">CRITICAL DATA ERROR: ${e.message}</p>`;
    }
};

window.closeModal = () => {
    document.getElementById('modal-details').style.display = 'none';
};

window.onclick = function (event) {
    const modal = document.getElementById('modal-details');
    if (event.target == modal) {
        modal.style.display = "none";
    }
}
