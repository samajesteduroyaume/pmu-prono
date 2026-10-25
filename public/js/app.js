const API_URL = '/api/courses';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function getParisDateString(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

// State Management
let allCourses = [];
let currentView = 'dashboard';
let visibleScannerCourses = [];
let activeDetailCourseId = null;
let detailRequestToken = 0;
let scannerPagination = { page: 1, totalPages: 1, total: 0 };
let coursesLoadError = null;

// Mobile Navigation Toggle
window.toggleNavRail = () => {
    const nav = document.getElementById('nav-rail-sidebar');
    const overlay = document.querySelector('.nav-overlay');
    if (!nav) return;
    const shouldOpen = !nav.classList.contains('open');
    nav.classList.toggle('open', shouldOpen);
    if (overlay) overlay.classList.toggle('open', shouldOpen);
    document.querySelectorAll('.mobile-nav-toggle').forEach(button => {
        button.setAttribute('aria-expanded', String(shouldOpen));
    });
};

window.closeNavRail = () => {
    const nav = document.getElementById('nav-rail-sidebar');
    const overlay = document.querySelector('.nav-overlay');
    if (nav) nav.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.querySelectorAll('.mobile-nav-toggle').forEach(button => {
        button.setAttribute('aria-expanded', 'false');
    });
};

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.closeNavRail();
});

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    if (!document.getElementById('view-dashboard')) return;

    initUI();
    refreshMLStatus();

    // Check URL parameters for view navigation (e.g. ?view=courses)
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    if (viewParam && ['dashboard', 'courses'].includes(viewParam)) {
        showPage(viewParam);
    } else {
        refreshData();
    }

    renderNavStats();
    
    // WebSockets Setup
    if (typeof io !== 'undefined') {
        const socket = io();
        socket.on('value_opportunity_alert', (data) => {
            console.log("VALUE OPPORTUNITY ALERT RECEIVED", data);
            showValueOpportunityNotification(data);
        });

        socket.on('sync_update', (data) => {
            console.log("AUTO-SYNC UPDATE RECEIVED", data);
            refreshData(); // Refresh current view
            showNotification(`Auto-Sync : ${data.count} courses actualisées`, 'success');
        });

        socket.on('sync_progress', (data) => {
            console.log("SYNC PROGRESS", data);
            showSyncProgressBar(data);
        });

        socket.on('sync_completed', (data) => {
            console.log("SYNC COMPLETED", data);
            showNotification(`Synchronisation terminée : ${data.totalCourses} courses sur ${data.successfulDays} jours !`, 'success');
            removeSyncProgressBar();
            refreshData();
        });
    }

    // Escape Key Listener to unblur and close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const modal = document.getElementById('modal-details');
            const target = e.target;
            const isTyping = target instanceof HTMLElement
                && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
            if (modal?.style.display === 'flex' && !isTyping) {
                e.preventDefault();
                window.navigateScannerCourse(e.key === 'ArrowRight' ? 1 : -1);
            }
        }
    });

    // Live Sync Polling (Configurable)
    setupLiveSync(60000);
});

async function refreshMLStatus() {
    const banner = document.getElementById('ml-status-banner');
    if (!banner) return;
    try {
        const response = await fetch('/api/ml/status');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const status = await response.json();
        const readiness = status.trainingReadiness;
        const capture = status.captureHealth;
        const lastCapture = capture?.lastCaptureAt
            ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(capture.lastCaptureAt))
            : 'aucune';
        const readinessText = readiness
            ? ` Collecte : ${capture?.capturedCourses || 0} courses capturées, ${capture?.fullySettledCourses || 0} réglées, ${capture?.awaitingResultsCourses || 0} en attente, ${capture?.nonRunnerSnapshots || 0} non-partants exclus, ${capture?.coursesWithInvalidFeatures || 0} avec variables incomplètes, ${capture?.coursesWithIncompatibleFeatureSchema || 0} avec un ancien schéma de variables. Dernière capture : ${lastCapture}. ML : ${readiness.eligibleCourses}/${readiness.requiredCourses} courses admissibles, ${readiness.eligibleDates}/${readiness.requiredDates} dates, test chronologique ${readiness.chronologicalSplit?.test || 0} courses dont ${readiness.comparableTestCourses || 0}/${readiness.requiredTestCourses} comparables pour la promotion.`
            : '';
        banner.hidden = false;
        if (status.active) {
            banner.style.borderColor = 'var(--accent-emerald)';
            banner.style.background = 'hsla(150, 70%, 35%, 0.10)';
            const hybridMetric = Number.isFinite(status.testDeployedHybridTop1HitRate)
                ? ` Top 1 hybride déployé sur le test de promotion : ${(status.testDeployedHybridTop1HitRate * 100).toFixed(1)}% (${status.testComparableCourseCount} courses).`
                : '';
            const mlMetric = Number.isFinite(status.testMlOnlyTop1HitRate)
                ? ` Top 1 ML seul : ${(status.testMlOnlyTop1HitRate * 100).toFixed(1)}%.`
                : '';
            banner.textContent = `Modèle ML actif : ${status.version || 'version inconnue'}.${hybridMetric}${mlMetric} Le score affiché reste un score de classement, pas une probabilité.${readinessText}`;
            return;
        }
        banner.textContent = status.reason === 'unverified-training-provenance'
            ? `Modèle ML inactif : provenance d’entraînement non vérifiée. Les pronostics utilisent le moteur heuristique; le score sur 100 n’est pas une probabilité.${readinessText}`
            : status.reason === 'unsupported-feature-schema'
                ? `Modèle ML inactif : les variables du modèle sont incompatibles avec la version de l’application. Les pronostics utilisent le moteur heuristique.${readinessText}`
            : `Modèle ML inactif. Les pronostics utilisent le moteur heuristique; le score sur 100 n’est pas une probabilité.${readinessText}`;
    } catch (error) {
        banner.hidden = false;
        banner.textContent = 'État du modèle ML indisponible. Ne considérez pas les scores comme des probabilités.';
    }
}

let liveSyncInterval = null;

function setupLiveSync(ms = 60000) {
    if (liveSyncInterval) clearInterval(liveSyncInterval);
    if (ms > 0) {
        liveSyncInterval = setInterval(() => {
            if (currentView === 'courses') syncMarket(true);
        }, ms);
    }
}

function showNotification(message, type = 'info') {
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = 'position: fixed; bottom: 20px; left: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'glass-panel';
    const bgColor = type === 'success' ? 'rgba(0, 255, 150, 0.1)' : 'rgba(0, 200, 255, 0.1)';
    const borderColor = type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-blue)';
    
    toast.style.cssText = `padding: 12px 20px; border-left: 4px solid ${borderColor}; background: ${bgColor}; backdrop-filter: blur(10px); color: var(--text-pure); font-size: 13px; font-weight: 600; min-width: 250px; animation: slideIn 0.3s ease-out;`;
    const icon = document.createElement('i');
    icon.className = `fas ${type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}`;
    icon.style.cssText = `margin-right: 10px; color: ${borderColor}`;
    toast.append(icon, document.createTextNode(` ${message}`));
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = '0.5s';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

function showSyncProgressBar(data) {
    const currentDay = Number.isFinite(Number(data?.currentDay)) ? Math.max(0, Math.trunc(Number(data.currentDay))) : 0;
    const totalDays = Number.isFinite(Number(data?.totalDays)) ? Math.max(0, Math.trunc(Number(data.totalDays))) : 0;
    const totalCourses = Number.isFinite(Number(data?.totalCourses)) ? Math.max(0, Math.trunc(Number(data.totalCourses))) : 0;
    const percent = Number.isFinite(Number(data?.percent)) ? Math.max(0, Math.min(100, Number(data.percent))) : 0;
    const date = escapeHtml(data?.date ?? '');
    let bar = document.getElementById('sync-progress-banner');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'sync-progress-banner';
        bar.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; height: 38px; background: rgba(10, 20, 35, 0.95); border-bottom: 2px solid var(--accent-blue); z-index: 10000; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; color: var(--text-pure); font-size: 13px; font-weight: 600; backdrop-filter: blur(10px); box-shadow: 0 4px 15px rgba(0, 150, 255, 0.2);';
        document.body.appendChild(bar);
    }
    bar.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-sync fa-spin" style="color: var(--accent-blue);"></i>
            <span>Synchronisation PMU : <strong>${currentDay}/${totalDays} jours</strong> (${date})</span>
        </div>
        <div style="display: flex; align-items: center; gap: 15px;">
            <span style="color: var(--accent-gold); font-size: 12px;">+${totalCourses} courses</span>
            <div style="width: 140px; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; position: relative;">
                <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, var(--accent-blue), var(--accent-emerald)); transition: width 0.3s ease;"></div>
            </div>
            <span style="font-weight: 700; color: var(--accent-emerald); width: 35px; text-align: right;">${percent}%</span>
        </div>
    `;
}

function removeSyncProgressBar() {
    const bar = document.getElementById('sync-progress-banner');
    if (bar) {
        bar.style.opacity = '0';
        bar.style.transition = '0.5s';
        setTimeout(() => bar.remove(), 500);
    }
}

function showValueOpportunityNotification(data) {
    if (!data || data.length === 0) return;
    
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;';
        document.body.appendChild(toastContainer);
    }
    
    data.forEach(horse => {
        const toast = document.createElement('div');
        toast.className = 'opportunity-card';
        toast.style.cssText = 'width: 320px; padding: 16px; background: rgba(20, 10, 40, 0.95); border-color: var(--accent-emerald); box-shadow: 0 10px 30px rgba(50, 200, 130, 0.25); border-left: 4px solid var(--accent-emerald); cursor: pointer;';
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                <i class="fas fa-chart-line" style="color: var(--accent-emerald); font-size: 20px;"></i>
                <div>
                    <div style="font-weight: 800; color: var(--text-pure); font-size: 14px;">OPPORTUNITÉ DE VALEUR</div>
                    <div style="font-size: 11px; color: var(--text-low);">Écart estimé avec le marché</div>
                </div>
            </div>
            <div style="font-size: 16px; font-weight: 700; color: var(--text-pure);">${escapeHtml(horse.nom)}</div>
            <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px;">
                <span style="color: var(--text-med);">Cote: <strong style="color: var(--accent-gold);">${escapeHtml(horse.cote || '--')}</strong></span>
                <span style="color: var(--text-med);">Avantage: <strong style="color: var(--accent-emerald);">+${escapeHtml(horse.edge)} pts</strong></span>
            </div>
        `;
        
        toast.onclick = () => {
            const courseId = horse.course_id || horse.courseId || horse.participant_id;
            if (courseId) showDetails(courseId);
            toast.remove();
        };
        
        toastContainer.appendChild(toast);
        
        // Play notification sound
        try {
            const audio = new Audio('https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg');
            audio.volume = 0.5;
            audio.play();
        } catch(e) {}
        
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 15000);
    });
}

function initUI() {
    const today = new Date();
    const todayStr = getParisDateString(today);
    
    const cal = document.getElementById('calendar-filter');
    if (cal) cal.value = todayStr;

    updateDateDisplay(todayStr);
}

function updateDateDisplay(date) {
    const display = document.getElementById('current-date');
    if (!date) {
        if (display) display.innerHTML = '<span class="live-indicator" style="background: var(--text-low); animation: none;"></span> ARCHIVES • TOUTES LES DATES';
        return;
    }
    const d = date ? new Date(`${date}T12:00:00Z`) : new Date();
    const isToday = date === getParisDateString();
    const dateStr = d.toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris'
    }).toUpperCase();
    
    if (display) {
        display.innerHTML = `
            <span class="live-indicator" style="${isToday ? '' : 'background: var(--text-low); animation: none;'}"></span> 
            ${isToday ? 'TERMINAL LIVE' : 'ARCHIVES'} • ${dateStr}
        `;
    }
}

window.shiftScannerDate = (days) => {
    const calendar = document.getElementById('calendar-filter');
    if (!calendar) return;
    if (days === 0) {
        calendar.value = getParisDateString();
    } else {
        const base = calendar.value || getParisDateString();
        const date = new Date(`${base}T12:00:00Z`);
        if (Number.isNaN(date.getTime())) return;
        date.setUTCDate(date.getUTCDate() + days);
        calendar.value = date.toISOString().slice(0, 10);
    }
    refreshData();
};

async function refreshData(page = 1) {
    const cal = document.getElementById('calendar-filter');
    const date = cal ? cal.value : null;

    updateDateDisplay(date);

    // Show skeletons
    if (currentView === 'dashboard') {
        const container = document.getElementById('quinte-container');
        if (container) container.innerHTML = renderQuinteSkeleton();
    } else if (currentView === 'courses') {
        const tbody = document.getElementById('courses-table-body');
        if (tbody) tbody.innerHTML = renderTableSkeleton(8, 9);
    }

    await loadData(page, { date });
    updateUI();
    renderNavStats();
}

async function renderNavStats() {
    try {
        const res = await fetch('/api/performance/winrate?days=7');
        const data = await res.json();
        
        const winrateEl = document.getElementById('stat-winrate-display');
        if (winrateEl && data.windows && data.windows['7j']) {
            const winPct = data.windows['7j'].win_pct;
            if (winPct == null) {
                winrateEl.textContent = '--';
                winrateEl.title = 'Pas encore assez de résultats réglés parmi les snapshots enregistrés.';
                return;
            }
            animateValue('stat-winrate-display', Number(winPct).toFixed(1) + '%');
            
            // Color based on performance
            if (winPct >= 30) winrateEl.style.color = 'var(--accent-emerald)';
            else if (winPct >= 25) winrateEl.style.color = 'var(--accent-gold)';
            else winrateEl.style.color = 'var(--accent-crimson)';
        }
    } catch (e) {
        console.error("Nav Stats Render Error:", e);
    }
}

async function loadData(page = 1, filters = {}) {
    coursesLoadError = null;
    try {
        const cleanFilters = {};
        for (const [key, val] of Object.entries(filters)) {
            if (val !== null && val !== undefined && val !== '' && val !== 'null') {
                cleanFilters[key] = val;
            }
        }
        const params = new URLSearchParams({ page, limit: 100, ...cleanFilters });
        const res = await fetch(`${API_URL}?${params}`);
        if (!res.ok) {
            console.error("Data Load HTTP Error:", res.status);
            allCourses = [];
            scannerPagination = { page: 1, totalPages: 1, total: 0 };
            coursesLoadError = `HTTP ${res.status}`;
            return false;
        }
        const response = await res.json();
        allCourses = response.data || [];
        window.currentPage = page;
        window.totalPages = response.pagination?.totalPages || 1;
        scannerPagination = {
            page: Number(response.pagination?.page) || page,
            totalPages: Number(response.pagination?.totalPages) || 1,
            total: Number(response.pagination?.total) || 0
        };
        return true;
    } catch (e) {
        console.error("Data Load Error:", e);
        allCourses = [];
        scannerPagination = { page: 1, totalPages: 1, total: 0 };
        coursesLoadError = e.message || 'Erreur réseau';
        return false;
    }
}

function updateUI() {
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'courses') renderScanner();
}

// Navigation Logic
window.showPage = (pageId) => {
    window.closeNavRail();
    closeModal();
    if (currentView === pageId) {
        refreshData();
        return;
    }
    
    currentView = pageId;
    
    // Update Nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const targetNav = document.getElementById(`nav-${pageId}`);
    document.querySelectorAll('.nav-item[aria-current="page"]').forEach(el => el.removeAttribute('aria-current'));
    if (targetNav) {
        targetNav.classList.add('active');
        targetNav.setAttribute('aria-current', 'page');
    }

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
            'courses': 'Scanner de Marché Exhaustif',
            'todo': 'Feuille de Route & Suivi des Améliorations (TODO)'
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
async function renderDashboard() {
    try {
        const res = await fetch('/api/finance');
        if (!res.ok) throw new Error(`Finance API: HTTP ${res.status}`);
        const portfolio = await res.json();

        const bankrollEl = document.getElementById('stat-bankroll-display');
        if (bankrollEl) {
            const balance = Number(portfolio.shadow);
            bankrollEl.textContent = Number.isFinite(balance) ? `${balance.toFixed(2)} €` : '--';
            bankrollEl.title = 'Capital du portefeuille simulé (shadow).';
        }

        renderQuinte();
    } catch (e) {
        console.error("Dashboard Render Error:", e);
    }
}

function getMeteoIcon(meteo) {
    const rawCode = meteo && typeof meteo === 'object'
        ? [meteo.nebulositeCode, meteo.nebulositeLibelleCourt, meteo.nebulositeLibelleLong].filter(value => typeof value === 'string').join(' ')
        : null;
    if (typeof rawCode !== 'string' || !rawCode.trim()) return '<i class="fas fa-question-circle" style="color: var(--text-med)" aria-label="Météo indisponible"></i>';
    const code = rawCode.toUpperCase();
    if (code.includes('SOLEIL') || code.includes('BEAU')) return '<i class="fas fa-sun" style="color: var(--accent-gold)"></i>';
    if (code.includes('NUAGE') || code.includes('COUVERT')) return '<i class="fas fa-cloud" style="color: var(--text-med)"></i>';
    if (code.includes('PLUIE')) return '<i class="fas fa-cloud-showers-heavy" style="color: var(--accent-blue)"></i>';
    return '<i class="fas fa-cloud-sun" style="color: var(--text-med)"></i>';
}

function getMeteoText(meteo) {
    if (!meteo || typeof meteo !== 'object') return 'Météo indisponible';
    const temperature = meteo.temperature;
    const temperatureText = temperature !== null && temperature !== undefined && temperature !== '' && Number.isFinite(Number(temperature))
        ? `${escapeHtml(temperature)}°C` : '';
    const cloudText = [meteo.nebulositeLibelleCourt, meteo.nebulositeCode]
        .find(value => typeof value === 'string' && value.trim());
    const cloud = cloudText ? escapeHtml(cloudText.replaceAll('_', ' ')) : '';
    const track = typeof meteo.etatPiste === 'string' ? `Piste : ${escapeHtml(meteo.etatPiste)}` : '';
    const windValue = meteo.forceVent !== null && meteo.forceVent !== undefined && Number.isFinite(Number(meteo.forceVent))
        ? `Vent ${escapeHtml(meteo.forceVent)}${meteo.directionVent ? ` ${escapeHtml(meteo.directionVent)}` : ''}` : '';
    const forecastDate = typeof meteo.datePrevision === 'string' && Number.isFinite(Date.parse(meteo.datePrevision))
        ? `Prévision ${new Date(meteo.datePrevision).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '';
    const age = typeof meteo.capturedAt === 'string' && Number.isFinite(Date.parse(meteo.capturedAt))
        ? `relevé ${new Date(meteo.capturedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : 'fraîcheur inconnue';
    return [[cloud, temperatureText, windValue, track, forecastDate].filter(Boolean).join(' · '), age].filter(Boolean).join(' — ') || 'Météo indisponible';
}

function getMeteoTooltip(meteo) {
    const details = typeof meteo?.nebulositeLibelleLong === 'string' ? escapeHtml(meteo.nebulositeLibelleLong) : '';
    const summary = getMeteoText(meteo);
    return details && details !== summary ? `${summary} — ${details}` : summary;
}

function getScannerStatus(course) {
    if (course.ordre_arrivee) return `ARRIVÉE · ${course.ordre_arrivee}`;
    const status = String(course.statut || '').toUpperCase();
    if (status.includes('ANNUL')) return 'ANNULÉE';
    if (status.includes('EN_COURS') || status.includes('PARTI') || status.includes('DEPART')) return 'EN COURS';
    if (status.includes('ARRIV') || status.includes('TERMINE') || status.includes('FIN_COURSE')) return 'RÉSULTAT EN ATTENTE';
    return 'À VENIR';
}

function getScannerStatusColor(course) {
    const status = String(course.statut || '').toUpperCase();
    if (course.ordre_arrivee) return 'var(--accent-gold)';
    if (status.includes('ANNUL')) return 'var(--accent-crimson)';
    if (status.includes('EN_COURS') || status.includes('PARTI') || status.includes('DEPART')
        || status.includes('ARRIV') || status.includes('TERMINE') || status.includes('FIN_COURSE')) {
        return 'var(--accent-gold)';
    }
    return 'var(--accent-emerald-bright)';
}

async function renderQuinte() {
    const container = document.getElementById('quinte-container');
    if (!container) return;

    const cal = document.getElementById('calendar-filter');
    const date = cal ? cal.value : null;

    try {
        const url = date ? `/api/courses/quinte/prediction?date=${encodeURIComponent(date)}` : '/api/courses/quinte/prediction';
        const res = await fetch(url);
        if (res.status === 404) {
            container.innerHTML = `<div class="stat-card" style="text-align: center; color: var(--text-med); padding: 60px;">Aucun Quinté+ détecté pour le ${escapeHtml(date || "aujourd'hui")}.</div>`;
            return;
        }
        const data = await res.json();
        if (!res.ok || !data?.course || !Array.isArray(data.selection)) {
            throw new Error(data?.error || 'Réponse Quinté+ invalide');
        }
        const { course, selection, tocard } = data;

        const meteoIcon = getMeteoIcon(course.meteo);
        const terrainBadge = course.terrain ? `<span class="badge badge-warning" style="margin-left: 10px; font-size: 9px; vertical-align: middle;">${escapeHtml(course.terrain.replace('_', ' '))}</span>` : '';

        container.innerHTML = `
            <div class="stat-card" style="border-left: 4px solid var(--accent-gold); margin-bottom: 32px; animation: fadeIn 0.8s ease-out;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <div>
                        <span class="badge badge-warning" style="margin-bottom: 12px;">ÉVÉNEMENT QUINTÉ+</span>
                        <h2 style="font-size: 32px; color: var(--text-pure); letter-spacing: -1px;">${escapeHtml(course.hippodrome)} ${terrainBadge}</h2>
                        <div style="color: var(--text-med); font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 12px;">
                            <span>R${escapeHtml(course.reunionNum)} C${escapeHtml(course.courseNum)} • ${escapeHtml(course.heure)}</span>
                            <span style="width: 1px; height: 12px; background: var(--glass-border);"></span>
                            <span>${escapeHtml(course.discipline)} • ${escapeHtml(course.distance)}m</span>
                            <span style="width: 1px; height: 12px; background: var(--glass-border);"></span>
                            <span>${escapeHtml(course.partants)} PARTANTS</span>
                            <span style="width: 1px; height: 12px; background: var(--glass-border);"></span>
                            <span title="${getMeteoTooltip(course.meteo)}">${meteoIcon} ${getMeteoText(course.meteo)}</span>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 11px; color: var(--text-low); font-weight: 800; letter-spacing: 1px;">PRIX TOTAL</div>
                        <div style="font-size: 24px; font-weight: 800; color: var(--accent-gold); font-family: 'JetBrains Mono';">${Number(course.prix || 0).toLocaleString()} €</div>
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
                                            <td style="font-weight: 800; color: var(--accent-indigo); font-family: 'JetBrains Mono'">${escapeHtml(p.numero)}</td>
                                            <td>
                                                <div style="font-weight: 700; color: var(--text-pure); display: flex; align-items: center; gap: 8px; font-size: 16px;">
                                                    ${escapeHtml(p.numero)}. ${escapeHtml(p.nom)}
                                                    ${p.is_smart_money_alert || p.is_smart_money ? '<i class="fas fa-rocket" style="color: var(--accent-purple); font-size: 12px;" title="Vélocité Smart Money"></i>' : ''}
                                                    ${p.is_swimmer ? '<i class="fas fa-water" style="color: var(--accent-blue); font-size: 12px;" title="Spécialiste Terrain Lourd"></i>' : ''}
                                                    ${p.is_hot_trainer ? '<i class="fas fa-fire" style="color: var(--accent-crimson); font-size: 12px;" title="Écurie en Pleine Forme"></i>' : ''}
                                                    ${p.is_trap ? '<i class="fas fa-skull-crossbones" style="color: var(--accent-crimson); font-size: 12px;" title="Faux Favori (Piège)"></i>' : ''}
                                                    ${p.is_bad_draw ? '<i class="fas fa-exclamation-triangle" style="color: var(--accent-gold); font-size: 12px;" title="Mauvais Tirage/Recul"></i>' : ''}
                                                </div>
                                                <div style="font-size: 11px; color: var(--text-low); font-style: italic; margin-top: 4px;">${escapeHtml(p.musique || '--')}</div>
                                            </td>
                                            <td style="font-weight: 800; color: var(--accent-gold); font-family: 'JetBrains Mono'">${escapeHtml(p.cote_ref || '--')}</td>
                                            <td>
                                                <div class="badge ${p.score == null ? 'badge-warning' : Number(p.score) > 75 ? 'badge-success' : 'badge-warning'}">${p.score == null ? '--' : escapeHtml(p.score) + '/100 pts'}</div>
                                                <div class="progress-container" style="width: 60px;">
                                                    <div class="progress-bar" style="width: ${Math.max(0, Math.min(100, Number(p.score) || 0))}%; background: ${Number(p.score) > 75 ? 'var(--accent-emerald)' : 'var(--accent-gold)'}"></div>
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
                                <div style="font-size: 24px; font-weight: 800; color: var(--text-pure);">${escapeHtml(tocard.numero)}. ${escapeHtml(tocard.nom)}</div>
                                <div style="font-size: 14px; color: var(--text-med); margin-top: 8px;">Cote: <span style="color: var(--accent-gold); font-weight: 800;">${escapeHtml(tocard.cote_ref)}</span></div>
                                <div style="margin-top: 16px; font-size: 11px; color: var(--accent-emerald); font-weight: 800; letter-spacing: 1px;">ALERTE SPÉCULATION • SCORE ${escapeHtml(tocard.score)}/100</div>
                            ` : '<div style="color: var(--text-low);">Aucun tocard détecté.</div>'}
                        </div>

                        <div class="stat-card" style="background: hsla(var(--h-indigo), 84%, 67%, 0.02); border-color: hsla(var(--h-indigo), 84%, 67%, 0.2); padding: 24px;">
                            <label style="color: var(--accent-indigo)">Conseil de Jeu</label>
                            <div style="font-size: 16px; font-weight: 800; margin-bottom: 12px;">STRATÉGIE ÉLITE</div>
                            <div style="font-size: 13px; color: var(--text-med); margin-bottom: 8px;">Base: <span style="color: var(--text-pure); font-weight: 800; font-family: 'JetBrains Mono'">${selection.length > 1 ? selection[0].numero + '-' + selection[1].numero : 'N/A'}</span></div>
                            <div style="font-size: 13px; color: var(--text-med);">Champ: <span style="color: var(--text-pure); font-weight: 600; font-family: 'JetBrains Mono'">${selection.length > 2 ? selection.slice(2, 6).map(p => p.numero).join(', ') : 'N/A'}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error("Quinté Render Error:", e);
        container.textContent = 'Impossible de charger les pronostics Quinté+ pour le moment.';
    }
}

window.updateRefreshRate = () => {
    const select = document.getElementById('refresh-rate-select');
    const ms = select ? parseInt(select.value) : 60000;
    setupLiveSync(ms);
    if (ms > 0) {
        showNotification(`Fréquence de synchro réglée sur ${ms / 1000}s`, 'success');
    } else {
        showNotification(`Auto-synchro désactivée`, 'info');
    }
};

window.resetScannerFilters = () => {
    const searchInput = document.getElementById('scanner-search');
    const discSelect = document.getElementById('filter-discipline');
    const scoreSelect = document.getElementById('filter-min-score');
    if (searchInput) searchInput.value = '';
    if (discSelect) discSelect.value = 'ALL';
    if (scoreSelect) scoreSelect.value = '0';
    renderScanner();
};

window.filterScanner = () => {
    renderScanner();
};

function renderScanner() {
    const tbody = document.getElementById('courses-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const search = (document.getElementById('scanner-search')?.value || '').toLowerCase().trim();
    const discipline = document.getElementById('filter-discipline')?.value || 'ALL';
    const minScore = parseInt(document.getElementById('filter-min-score')?.value || '0');

    let filtered = allCourses.filter(c => {
        // Search filter
        if (search) {
            const searchText = [c.top_horse, c.hippodrome, c.discipline, c.reunionNum, c.courseNum,
                `R${c.reunionNum} C${c.courseNum}`].map(value => String(value ?? '').toLowerCase());
            if (!searchText.some(value => value.includes(search))) return false;
        }

        // Discipline filter
        if (discipline !== 'ALL') {
            const discUpper = (c.discipline || '').toUpperCase();
            if (discipline === 'ATTELE' && !discUpper.includes('ATTELE')) return false;
            if (discipline === 'MONTE' && !discUpper.includes('MONTE')) return false;
            if (discipline === 'PLAT' && !discUpper.includes('PLAT') && !discUpper.includes('GALOP')) return false;
            if (discipline === 'OBSTACLE' && !discUpper.includes('HAIE') && !discUpper.includes('OBSTACLE') && !discUpper.includes('STEEPLE')) return false;
        }

        // Min Score filter
        const score = c.ia_score || 0;
        if (score < minScore) return false;

        return true;
    });

    const sorted = [...filtered].sort((a, b) =>
        String(b.date || '').localeCompare(String(a.date || ''))
        || (a.heure || '').localeCompare(b.heure || '')
        || String(a.reunionNum || '').localeCompare(String(b.reunionNum || ''), 'fr', { numeric: true })
        || String(a.courseNum || '').localeCompare(String(b.courseNum || ''), 'fr', { numeric: true })
    );
    visibleScannerCourses = sorted;
    const count = document.getElementById('scanner-course-count');
    if (count) {
        const tracks = new Set(sorted.map(course => `${course.reunionNum ?? ''}`)).size;
        const pageLabel = scannerPagination.totalPages > 1
            ? ` • page ${scannerPagination.page}/${scannerPagination.totalPages} (${scannerPagination.total} au total)`
            : '';
        count.textContent = `${sorted.length} course${sorted.length === 1 ? '' : 's'} affichée${sorted.length === 1 ? '' : 's'}${tracks ? ` • ${tracks} réunion${tracks === 1 ? '' : 's'}` : ''}${pageLabel}`;
    }
    renderScannerCourseStrip(sorted);
    renderScannerPagination();

    if (sorted.length === 0) {
        if (allCourses.length > 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; color: var(--text-med); padding: 40px; font-weight: 600;">
                        <div style="font-size: 14px; margin-bottom: 8px; color: var(--text-high);">Aucune course ne correspond à vos filtres actuels (${allCourses.length} courses chargées sur cette page${scannerPagination.totalPages > 1 ? `, ${scannerPagination.total} au total` : ''}).</div>
                        <button onclick="resetScannerFilters()" class="nav-item" style="margin-top: 10px; padding: 6px 16px; font-size: 12px; border: 1px solid var(--accent-gold); color: var(--accent-gold); background: hsla(var(--h-gold), 100%, 50%, 0.1);">
                            <i class="fas fa-undo" style="margin-right: 6px;"></i> Réinitialiser les filtres
                        </button>
                    </td>
                </tr>`;
        } else {
            if (coursesLoadError) {
                tbody.innerHTML = `
                    <tr><td colspan="9" style="text-align: center; color: var(--text-med); padding: 40px;">
                        <div style="font-size: 15px; margin-bottom: 8px; color: var(--accent-crimson);">Impossible de charger le programme.</div>
                        <div style="font-size: 12px; margin-bottom: 16px;">Vérifiez le serveur et la connexion, puis réessayez.</div>
                        <button onclick="refreshData()" class="scanner-retry-button"><i class="fas fa-redo"></i> Réessayer</button>
                    </td></tr>`;
                return;
            }
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; color: var(--text-med); padding: 40px; font-weight: 600;">
                        <div style="font-size: 15px; margin-bottom: 8px; color: var(--text-pure);">Aucune course trouvée pour cette date.</div>
                        <div style="font-size: 12px; margin-bottom: 16px;">La synchronisation PMU en direct permet de récupérer le programme complet.</div>
                        <button onclick="syncMarket()" class="nav-item" style="padding: 8px 20px; font-size: 12px; border: 1px solid var(--accent-emerald-bright); color: var(--accent-emerald-bright); background: rgba(16, 185, 129, 0.15); font-weight: 700;">
                            <i class="fas fa-sync-alt" style="margin-right: 6px;"></i> Synchroniser les courses PMU en direct
                        </button>
                    </td>
                </tr>`;
        }
        return;
    }

    sorted.forEach((c, index) => {
        const row = document.createElement('tr');
        row.style.animation = `fadeIn 0.5s ease-out ${index * 0.04}s both`;
        row.classList.add('scanner-course-row');
        row.tabIndex = 0;
        row.setAttribute('aria-label', `Ouvrir l’analyse de ${c.hippodrome}, réunion ${c.reunionNum}, course ${c.courseNum}`);
        row.addEventListener('click', event => {
            if (!event.target.closest('button, a')) window.showDetails(c.id);
        });
        row.addEventListener('keydown', event => {
            if (event.target !== row) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                window.showDetails(c.id);
            }
        });
        
        const iaScore = Number(c.ia_score);
        const meteoIcon = getMeteoIcon(c.meteo);
        const terrainText = c.terrain ? c.terrain.replace('_', ' ') : 'Standard';

        row.innerHTML = `
            <td>
                <button onclick="showDetails(${c.id})" class="nav-item" style="padding: 8px 16px; font-size: 11px; border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 8px; background: rgba(16, 185, 129, 0.12); color: var(--accent-emerald-bright); font-weight: 700;">
                    <i class="fas fa-search-plus" style="margin-right: 4px;"></i> DÉTAILS
                </button>
            </td>
            <td style="font-family: 'JetBrains Mono'; font-weight: 800; color: var(--accent-emerald-bright)">${escapeHtml(c.heure)}</td>
            <td>
                <div style="font-weight: 700; color: var(--text-pure); font-size: 15px;">${escapeHtml(c.hippodrome)}</div>
                <div style="font-size: 11px; color: var(--text-med); font-weight: 600;">R${escapeHtml(c.reunionNum)} C${escapeHtml(c.courseNum)} • ${escapeHtml(c.discipline)}</div>
            </td>
            <td>
                <div style="font-size: 12px; font-weight: 700; color: var(--text-high); display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-ruler-horizontal" style="font-size: 10px; color: var(--text-med);"></i> ${escapeHtml(c.distance)}m
                </div>
                <div style="font-size: 11px; color: var(--text-med); margin-top: 4px; display: flex; align-items: center; gap: 6px;">
                    ${meteoIcon} <span style="text-transform: capitalize;" title="${getMeteoTooltip(c.meteo)}">${escapeHtml(terrainText.toLowerCase())} · ${getMeteoText(c.meteo)}</span>
                </div>
            </td>
            <td>
                <div style="font-weight: 800; color: var(--text-pure); display: flex; align-items: center; gap: 10px; font-size: 15px;">
                    ${escapeHtml(c.top_horse || '---')}
                    ${c.cat_trend === 'DOWN' ? '<span class="badge badge-success" style="font-size: 8px; padding: 4px 8px;">DÉCLASSÉ</span>' : ''}
                </div>
            </td>
            <td>
                <div class="badge ${!Number.isFinite(iaScore) ? 'badge-warning' : iaScore >= 75 ? 'badge-success' : 'badge-warning'}">${Number.isFinite(iaScore) ? escapeHtml(iaScore) + '/100 pts' : '--'}</div>
            </td>
            <td style="font-weight: 800; color: var(--accent-gold); font-family: 'JetBrains Mono'; font-size: 15px;">${escapeHtml(c.fav_cote || '--')}</td>
            <td>
                <div style="font-weight: 700; color: var(--text-high); font-family: 'JetBrains Mono'; font-size: 13px;">${Number.isFinite(Number(c.prix)) && Number(c.prix) !== 0 ? Number(c.prix).toLocaleString() + ' €' : '--'}</div>
                <div style="font-size: 10px; color: var(--text-med); font-weight: 600;">${escapeHtml(c.partants)} PARTANTS</div>
            </td>
            <td style="font-family: 'JetBrains Mono'; font-weight: 800; color: ${getScannerStatusColor(c)}">${escapeHtml(getScannerStatus(c))}</td>
        `;
        tbody.appendChild(row);
    });
}

function renderScannerPagination() {
    const container = document.getElementById('scanner-pagination');
    if (!container) return;
    const hasMultiplePages = scannerPagination.totalPages > 1;
    container.hidden = !hasMultiplePages;
    if (!hasMultiplePages) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `
        <button type="button" onclick="changeScannerPage(-1)" ${scannerPagination.page <= 1 ? 'disabled' : ''} aria-label="Page précédente">
            <i class="fas fa-chevron-left"></i><span>Précédent</span>
        </button>
        <span>Page <strong>${scannerPagination.page}</strong> sur ${scannerPagination.totalPages} · ${scannerPagination.total} courses</span>
        <button type="button" onclick="changeScannerPage(1)" ${scannerPagination.page >= scannerPagination.totalPages ? 'disabled' : ''} aria-label="Page suivante">
            <span>Suivant</span><i class="fas fa-chevron-right"></i>
        </button>`;
}

window.changeScannerPage = (offset) => {
    const nextPage = scannerPagination.page + offset;
    if (nextPage < 1 || nextPage > scannerPagination.totalPages) return;
    refreshData(nextPage);
};

function renderScannerCourseStrip(courses) {
    const strip = document.getElementById('scanner-course-strip');
    if (!strip) return;
    if (!courses.length) {
        strip.innerHTML = '<span class="scanner-course-strip-empty">Aucune course selon les filtres actuels.</span>';
        return;
    }
    const showDate = document.getElementById('calendar-filter')?.value === '';
    strip.innerHTML = courses.map((course, index) => `
        <button class="scanner-course-chip${String(course.id) === String(activeDetailCourseId) ? ' is-active' : ''}"
            data-course-id="${escapeHtml(course.id)}" onclick="showDetails(${Number(course.id)})"
            aria-label="Course ${index + 1} : ${escapeHtml(course.hippodrome)}, réunion ${escapeHtml(course.reunionNum)}, course ${escapeHtml(course.courseNum)} à ${escapeHtml(course.heure || 'heure inconnue')}">
            <span class="scanner-course-chip-time">${showDate ? `${escapeHtml(String(course.date || '').slice(5).split('-').reverse().join('/'))} · ` : ''}${escapeHtml(course.heure || '--:--')}</span>
            <strong>R${escapeHtml(course.reunionNum)} · C${escapeHtml(course.courseNum)}</strong>
            <span class="scanner-course-chip-venue">${escapeHtml(course.hippodrome || 'Hippodrome')}</span>
        </button>`).join('');
}

window.exportScannerCSV = () => {
    if (!visibleScannerCourses || visibleScannerCourses.length === 0) {
        showNotification("Aucune donnée à exporter", "info");
        return;
    }
    
    const csvCell = value => {
        let text = String(value ?? '');
        if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    const headers = ["Heure", "Hippodrome", "Reunion", "Course", "Discipline", "Distance", "Top Cheval", "Score IA", "Cote Fav", "Prix", "Statut"];
    const rows = visibleScannerCourses.map(c => [
        c.heure, c.hippodrome, c.reunionNum, c.courseNum, c.discipline,
        c.distance, c.top_horse, c.ia_score, c.fav_cote, c.prix, getScannerStatus(c)
    ].map(csvCell));

    const csvContent = [headers.map(csvCell).join(","), ...rows.map(row => row.join(","))].join("\n");
    const encodedUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `PMU_Scanner_Export_${getParisDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    showNotification("Export CSV des pronostics généré !", "success");
};

function animateValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.transition = 'all 0.3s ease';
    el.style.transform = 'scale(1.1)';
    el.textContent = value;
    setTimeout(() => el.style.transform = 'scale(1)', 300);
}

// Sync Utilities
window.syncHistoryPrompt = async (event) => {
    const daysStr = prompt("Profondeur de synchronisation (en jours, jusqu'à 180 jours / 6 mois) :", "30");
    if (!daysStr || isNaN(daysStr)) return;

    const days = parseInt(daysStr, 10);
    if (days < 1 || days > 365) {
        alert("Veuillez saisir un nombre de jours entre 1 et 365 (ex: 180 pour 6 mois).");
        return;
    }

    const btn = event?.currentTarget;
    const icon = btn?.querySelector('i');
    if (icon) icon.className = 'fas fa-spinner fa-spin';
    
    showNotification(`Synchronisation de ${days} jours lancée (cela peut prendre quelques minutes)...`, 'info');

    try {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days })
        });
        const data = await res.json();
        if (data.success && data.async) {
            showNotification(data.message || `Synchronisation de ${data.days} jours démarrée en arrière-plan.`, 'info');
        } else if (data.success) {
            showNotification(`Synchronisation réussie : ${data.count} courses traitées sur ${data.daysProcessed} jours.`, 'success');
            refreshData();
        } else {
            showNotification(`Erreur synchro : ${data.error || 'Erreur inconnue'}`, 'error');
        }
    } catch (e) {
        console.error("Sync Error:", e);
        showNotification(`Erreur lors de la synchronisation : ${e.message}`, 'error');
    } finally {
        if (icon) icon.className = 'fas fa-history';
    }
};

window.syncMarket = async (silent = false) => {
    const icon = document.querySelector('.fa-sync-alt');
    if (!silent && icon) icon.className = 'fas fa-spinner fa-spin';
    
    const cal = document.getElementById('calendar-filter');
    const selectedDate = cal ? cal.value : null;

    try {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: selectedDate || undefined, days: 1 })
        });
        const data = await res.json();
        if (data.success) {
            if (!silent) showNotification(`Actualisation réussie : ${data.count} courses actualisées`, 'success');
            refreshData();
        } else {
            if (!silent) showNotification(`Erreur d'actualisation : ${data.error || 'Erreur inconnue'}`, 'error');
        }
    } catch (e) {
        console.error("Sync Error:", e);
        if (!silent) showNotification(`Erreur de connexion lors de l'actualisation`, 'error');
    } finally {
        if (!silent && icon) icon.className = 'fas fa-sync-alt';
    }
};

function renderScannerDetailNavigation(id) {
    const index = visibleScannerCourses.findIndex(course => String(course.id) === String(id));
    if (index < 0) return '';
    const course = visibleScannerCourses[index];
    const canGoPrevious = index > 0 || scannerPagination.page > 1;
    const canGoNext = index < visibleScannerCourses.length - 1 || scannerPagination.page < scannerPagination.totalPages;
    return `
        <nav class="scanner-detail-navigation" aria-label="Navigation entre les courses">
            <button type="button" onclick="navigateScannerCourse(-1)" ${canGoPrevious ? '' : 'disabled'}>
                <i class="fas fa-arrow-left"></i><span>Précédente</span>
            </button>
            <div class="scanner-detail-position">
                <strong>Course ${index + 1} <span>/ ${visibleScannerCourses.length}</span></strong>
                <span>${escapeHtml(String(course.date || '').split('-').reverse().join('/'))} · ${escapeHtml(course.heure || '--:--')} · R${escapeHtml(course.reunionNum)} C${escapeHtml(course.courseNum)} · ${escapeHtml(course.hippodrome)}</span>
                <small>Utilisez ← et → pour parcourir les courses</small>
            </div>
            <button type="button" onclick="navigateScannerCourse(1)" ${canGoNext ? '' : 'disabled'}>
                <span>Suivante</span><i class="fas fa-arrow-right"></i>
            </button>
        </nav>`;
}

let isNavigatingScannerCourse = false;

window.navigateScannerCourse = async (offset) => {
    const index = visibleScannerCourses.findIndex(course => String(course.id) === String(activeDetailCourseId));
    if (index < 0 || isNavigatingScannerCourse) return;
    const next = visibleScannerCourses[index + offset];
    if (next) {
        await window.showDetails(next.id);
        return;
    }

    const nextPage = scannerPagination.page + offset;
    if (nextPage < 1 || nextPage > scannerPagination.totalPages) return;
    isNavigatingScannerCourse = true;
    const originalPage = scannerPagination.page;
    const totalPages = scannerPagination.totalPages;
    const originalCourseId = activeDetailCourseId;
    const calendar = document.getElementById('calendar-filter');
    try {
        let page = nextPage;
        while (page >= 1 && page <= totalPages) {
            const loaded = await loadData(page, { date: calendar?.value });
            if (!loaded) break;
            updateUI();
            const pageCourses = visibleScannerCourses;
            const boundaryCourse = offset > 0 ? pageCourses[0] : pageCourses.at(-1);
            if (boundaryCourse) {
                await window.showDetails(boundaryCourse.id);
                return;
            }
            page += offset;
        }

        await loadData(originalPage, { date: calendar?.value });
        updateUI();
        if (originalCourseId != null) await window.showDetails(originalCourseId);
    } finally {
        isNavigatingScannerCourse = false;
    }
};

window.closeModal = () => {
    const closeToken = ++detailRequestToken;
    activeDetailCourseId = null;
    document.querySelectorAll('.scanner-course-chip.is-active').forEach(chip => chip.classList.remove('is-active'));
    const modal = document.getElementById('modal-details');
    modal.style.opacity = '0';
    modal.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
        if (detailRequestToken === closeToken) modal.style.display = 'none';
    }, 300);
};

window.showDetails = async (id) => {
    const modal = document.getElementById('modal-details');
    const body = document.getElementById('modal-body');
    const requestToken = ++detailRequestToken;
    activeDetailCourseId = id;
    document.querySelectorAll('.scanner-course-chip').forEach(chip => {
        chip.classList.toggle('is-active', String(chip.dataset.courseId) === String(id));
    });
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.style.opacity = '0';
    setTimeout(() => {
        if (requestToken === detailRequestToken) modal.style.opacity = '1';
    }, 10);
    const modalCard = modal.querySelector('.stat-card');
    if (modalCard) modalCard.scrollTop = 0;
    
    body.innerHTML = `${renderScannerDetailNavigation(id)}
        <div style="padding: 40px; text-align: center;">
            <div class="skeleton skeleton-title" style="margin: 0 auto 20px;"></div>
            <div class="skeleton skeleton-text" style="margin: 0 auto 10px;"></div>
            <div class="skeleton skeleton-text" style="margin: 0 auto 10px; width: 60%;"></div>
        </div>
    `;

    try {
        const res = await fetch(`/api/courses/${id}/details`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (requestToken !== detailRequestToken) return;
        if (!data?.course || !Array.isArray(data.participants)) throw new Error('Réponse course invalide');
        
        const meteoIcon = getMeteoIcon(data.course.meteo);

        body.innerHTML = `${renderScannerDetailNavigation(id)}
            <div style="margin-bottom: 32px; animation: fadeIn 0.5s ease-out;">
                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px;">
                    <div>
                        <h3 style="font-size: 12px; color: var(--accent-indigo); text-transform: uppercase; font-weight: 800; letter-spacing: 2px;">Contexte de Course</h3>
                        <div style="font-size: 24px; font-weight: 800; color: var(--text-pure); margin-top: 8px;">${escapeHtml(data.course.hippodrome)} • ${escapeHtml(data.course.discipline)}</div>
                        <div style="font-size: 13px; color: var(--text-med); margin-top: 4px; font-weight: 600; display: flex; align-items: center; gap: 12px;">
                            <span>${escapeHtml(data.course.distance)}m</span>
                            <span style="width: 1px; height: 10px; background: var(--glass-border);"></span>
                            <span>${escapeHtml(data.course.terrain || 'Standard')}</span>
                            <span style="width: 1px; height: 10px; background: var(--glass-border);"></span>
                            <span>${Number(data.course.prix || 0).toLocaleString()} €</span>
                            <span style="width: 1px; height: 10px; background: var(--glass-border);"></span>
                            <span>${escapeHtml(data.course.partants)} PARTANTS</span>
                            <span style="width: 1px; height: 10px; background: var(--glass-border);"></span>
                            <span title="${getMeteoTooltip(data.course.meteo)}">${meteoIcon} ${getMeteoText(data.course.meteo)}</span>
                            ${data.course.corde ? `<span style="width: 1px; height: 10px; background: var(--glass-border);"></span><span>CORDE ${escapeHtml(data.course.corde)}</span>` : ''}
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <span class="badge badge-warning">ALGORITHME V46 ELITE</span>
                    </div>
                </div>

                <div class="data-table-container">
                    <table class="data-table" style="min-width: 100%;">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Cheval</th>
                                <th>Entourage</th>
                                <th>Radar IA (XAI)</th>
                                <th>Gains & Stats</th>
                                <th>Arguments IA</th>
                                <th>Score IA</th>
                                <th>Cote</th>
                                <th>Classe</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.participants.map(p => {
                                const forme = Math.max(0, Math.min(100, Number(p.baseScores?.forme) || 50));
                                const entourage = Math.max(0, Math.min(100, Number(p.baseScores?.entourage) || 50));
                                const gains = Number(p.gains);
                                const predictionScore = Number(p.prediction_score);
                                const riskColor = p.is_trap ? 'var(--accent-crimson)' : 'var(--accent-emerald)';
                                
                                return `
                                <tr>
                                    <td style="font-weight: 800; color: var(--accent-indigo); font-family: 'JetBrains Mono'">${escapeHtml(p.numero)}</td>
                                    <td>
                                        <div style="font-weight: 700; color: var(--text-pure); font-size: 16px; display: flex; align-items: center; gap: 6px;">
                                            ${escapeHtml(p.numero)}. ${escapeHtml(p.nom)}
                                            ${p.is_smart_money_alert ? '<i class="fas fa-rocket" style="color: var(--accent-purple); font-size: 11px;" title="Smart Money Velocity"></i>' : ''}
                                            ${p.is_swimmer ? '<i class="fas fa-water" style="color: var(--accent-blue); font-size: 11px;" title="Spécialiste Terrain"></i>' : ''}
                                            ${p.is_hot_trainer ? '<i class="fas fa-fire" style="color: var(--accent-crimson); font-size: 11px;" title="Écurie Hot Streak"></i>' : ''}
                                            ${p.is_trap ? '<i class="fas fa-skull-crossbones" style="color: var(--accent-crimson); font-size: 11px;" title="Faux Favori"></i>' : ''}
                                            ${p.is_bad_draw ? '<i class="fas fa-exclamation-triangle" style="color: var(--accent-gold); font-size: 11px;" title="Désavantage Balistique"></i>' : ''}
                                        </div>
                                        <div style="font-size: 10px; color: var(--text-low); font-family: 'JetBrains Mono'; margin-top: 4px;">${escapeHtml(p.musique)}</div>
                                    </td>
                                    <td>
                                        <div style="font-weight: 600; color: var(--text-pure); font-size: 13px;">${escapeHtml(p.driver)}</div>
                                        <div style="font-size: 11px; color: var(--text-low); margin-top: 2px;">T: ${escapeHtml(p.entraineur)}</div>
                                    </td>
                                    <td style="width: 150px;">
                                        <div style="margin-bottom: 4px;">
                                            <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-med); margin-bottom: 2px;"><span>FORM</span><span>${forme}%</span></div>
                                            <div style="height: 4px; background: hsla(0,0%,100%,0.1); border-radius: 2px; overflow: hidden;"><div style="width: ${forme}%; height: 100%; background: ${forme > 70 ? 'var(--accent-emerald)' : 'var(--accent-gold)'};"></div></div>
                                        </div>
                                        <div style="margin-bottom: 4px;">
                                            <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-med); margin-bottom: 2px;"><span>ENTOUR</span><span>${entourage}%</span></div>
                                            <div style="height: 4px; background: hsla(0,0%,100%,0.1); border-radius: 2px; overflow: hidden;"><div style="width: ${entourage}%; height: 100%; background: ${entourage > 70 ? 'var(--accent-indigo)' : 'var(--accent-gold)'};"></div></div>
                                        </div>
                                        <div>
                                            <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-med); margin-bottom: 2px;"><span>SAFE</span><span>${p.is_trap ? 'LOW' : 'HIGH'}</span></div>
                                            <div style="height: 4px; background: hsla(0,0%,100%,0.1); border-radius: 2px; overflow: hidden;"><div style="width: ${p.is_trap ? '20' : '100'}%; height: 100%; background: ${riskColor};"></div></div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style="font-weight: 700; color: var(--accent-gold); font-family: 'JetBrains Mono'; font-size: 13px;">${Number.isFinite(gains) ? gains.toLocaleString() : '0'} €</div>
                                        <div style="font-size: 10px; color: var(--text-low); margin-top: 2px;">${escapeHtml(p.nb_courses)} C / ${escapeHtml(p.nb_victoires)} V</div>
                                    </td>
                                    <td>
                                        <div style="display: flex; flex-direction: column; gap: 4px;">
                                            ${(p.arguments_ia || []).map(arg => `<div style="font-size: 10px; color: var(--text-med); background: hsla(0,0%,100%,0.03); padding: 2px 6px; border-radius: 4px; border: 1px solid hsla(0,0%,100%,0.05);">${escapeHtml(arg)}</div>`).join('')}
                                        </div>
                                    </td>
                                    <td>
                                        <div class="badge ${p.prediction_score == null ? 'badge-warning' : predictionScore > 75 ? 'badge-success' : 'badge-warning'}">${p.prediction_score == null ? '--' : escapeHtml(p.prediction_score) + '/100 pts'}</div>
                                    </td>
                                    <td style="font-weight: 800; color: var(--accent-gold); font-family: 'JetBrains Mono'">${escapeHtml(p.cote_ref || '--')}</td>
                                    <td>
                                        ${p.cat_trend === 'DOWN' ? '<span style="color: var(--accent-emerald); font-weight: 800; font-size: 11px;"><i class="fas fa-arrow-down"></i> DOWN</span>' : '<span style="color: var(--text-low); font-size: 11px;">STABLE</span>'}
                                    </td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (e) {
        if (requestToken !== detailRequestToken) return;
        body.innerHTML = `${renderScannerDetailNavigation(id)}
            <div style="color: var(--accent-crimson); padding: 40px; text-align: center;">
                <div style="margin-bottom: 16px;">Impossible de charger l’analyse de cette course.</div>
                <button class="scanner-retry-button" onclick="showDetails(${Number(id)})">Réessayer</button>
            </div>`;
    }
};

// ----------------------------------------------------
// TODO FEATURE 1: Assistant Vocal (Dictée Vocale UI)
// ----------------------------------------------------
window.startVoiceSearch = (targetInputId) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = document.getElementById('voice-search-btn');
    const input = document.getElementById(targetInputId);
    
    if (!SpeechRecognition) {
        showNotification("La reconnaissance vocale n'est pas supportée sur ce navigateur.", "info");
        return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
    
    if (btn) {
        btn.style.color = 'var(--accent-crimson)';
        btn.innerHTML = '<i class="fas fa-microphone-alt fa-pulse"></i>';
    }
    showNotification("Écoute vocale en cours... Parlez !", "info");
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (input) {
            input.value = transcript;
            showNotification(`Dictée vocale capturée: "${transcript}"`, "success");
            if (targetInputId === 'scanner-search') window.filterScanner();
        }
    };
    
    recognition.onerror = (event) => {
        showNotification(`Erreur vocale: ${event.error}`, "info");
    };
    
    recognition.onend = () => {
        if (btn) {
            btn.style.color = 'var(--accent-gold)';
            btn.innerHTML = '<i class="fas fa-microphone"></i>';
        }
    };
    
    recognition.start();
};

// ----------------------------------------------------
// TODO FEATURE 2: Exportation Synthétique PDF
// ----------------------------------------------------
window.exportQuintePDF = () => {
    showNotification("Génération de la fiche PDF en cours...", "info");
    const printWindow = window.open('', '_blank');
    const todayStr = new Date(`${getParisDateString()}T12:00:00Z`).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris'
    });
    
    let tableRowsHtml = '';
    if (allCourses && allCourses.length > 0) {
        tableRowsHtml = allCourses.slice(0, 15).map(c => `
            <tr>
                <td><b>${escapeHtml(c.heure || '--')}</b></td>
                <td><b>${escapeHtml(c.hippodrome || '--')}</b><br><small>R${escapeHtml(c.reunionNum)} C${escapeHtml(c.courseNum)} - ${escapeHtml(c.discipline)}</small></td>
                <td>${escapeHtml(c.top_horse || 'Non analysé')}</td>
                <td><b>${escapeHtml(c.ia_score || 0)}/100 pts</b></td>
                <td>${escapeHtml(c.fav_cote || '--')}</td>
                <td>${c.prix ? Number(c.prix).toLocaleString() + ' €' : '--'}</td>
            </tr>
        `).join('');
    } else {
        tableRowsHtml = `<tr><td colspan="6">Aucune course enregistrée.</td></tr>`;
    }
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>PMU-Prono Elite - Fiche de Presse & Synthèse ${todayStr}</title>
            <style>
                body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 30px; color: #111; line-height: 1.5; }
                h1 { color: #0f5132; margin-bottom: 5px; border-bottom: 3px solid #0f5132; padding-bottom: 10px; }
                .subtitle { color: #555; font-size: 14px; margin-bottom: 20px; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 13px; }
                th { background-color: #0f5132; color: white; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                .footer { margin-top: 40px; font-size: 11px; text-align: center; color: #888; border-top: 1px solid #ddd; padding-top: 10px; }
            </style>
        </head>
        <body>
            <h1>🏇 PMU-PRONO ELITE PUNTER V43.4</h1>
            <div class="subtitle">FICHE DE PRESSE DU SCANNER & SYNTHÈSE QUINTÉ+ • ${todayStr.toUpperCase()}</div>
            <p>Rapport d'analyse généré automatiquement par l'IA PMU-Prono (Modèle Hybride XGBoost / LightGBM).</p>
            <table>
                <thead>
                    <tr>
                        <th>Heure</th>
                        <th>Hippodrome / Événement</th>
                        <th>Top Vecteur IA</th>
                        <th>Score IA</th>
                        <th>Cote Ref</th>
                        <th>Allocation</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
            </table>
            <div class="footer">Document officiel généré pour hippodromes par PMU-Prono AI System. Tous droits réservés.</div>
            <script>window.onload = function() { window.print(); };</script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

// ----------------------------------------------------
// TODO FEATURE 3: Test & Alertes Telegram
// ----------------------------------------------------
window.testTelegramPrompt = async () => {
    const token = prompt("Entrez votre Token de Bot Telegram (ou laissez vide pour utiliser l'existant):");
    const chatId = prompt("Entrez votre Chat ID Telegram (laissez vide pour conserver l'existant):");
    
    if (token !== null && chatId !== null) {
        try {
            const config = { enabled: true };
            if (token.trim()) config.botToken = token.trim();
            if (chatId.trim()) config.chatId = chatId.trim();
            const configResponse = await fetch('/api/alerts/telegram/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            const configResult = await configResponse.json();
            if (!configResponse.ok || !configResult.success) throw new Error(configResult.error || 'Configuration Telegram refusée');
            showNotification("Configuration Telegram enregistrée. Envoi du message de test...", "info");
            
            const res = await fetch('/api/alerts/telegram/test', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (data.success) {
                showNotification("✅ Message Telegram envoyé avec succès !", "success");
            } else {
                showNotification(`⚠️ Erreur Telegram: ${data.error}`, "info");
            }
        } catch(e) {
            showNotification(`Erreur de connexion Telegram: ${e.message}`, "info");
        }
    }
};

// ----------------------------------------------------
// TODO FEATURE 4: Comparateur de Forme Écuries
// ----------------------------------------------------
window.openEcuriesModal = async () => {
    const modal = document.getElementById('modal-details');
    const body = document.getElementById('modal-body');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => modal.style.opacity = '1', 10);
    
    body.innerHTML = `
        <div style="padding: 40px; text-align: center;">
            <div class="skeleton skeleton-title" style="margin: 0 auto 20px;"></div>
            <div class="skeleton skeleton-text" style="margin: 0 auto 10px;"></div>
        </div>
    `;

    try {
        const res = await fetch('/api/ecuries/compare');
        const result = await res.json();
        const ecuries = result.data || [];
        
        body.innerHTML = `
            <div style="margin-bottom: 32px; animation: fadeIn 0.5s ease-out;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <div>
                        <h3 style="font-size: 12px; color: var(--accent-purple); text-transform: uppercase; font-weight: 800; letter-spacing: 2px;">Analyse de Réussite</h3>
                        <div style="font-size: 24px; font-weight: 800; color: var(--text-pure); margin-top: 4px;">Comparateur de Forme des Écuries (90 Derniers Jours)</div>
                    </div>
                    <span class="badge badge-success">${ecuries.length} Écuries Analysées</span>
                </div>
                
                <div class="data-table-container" style="max-height: 500px; overflow-y: auto;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Rang</th>
                                <th>Entraîneur / Écurie</th>
                                <th>Engagements</th>
                                <th>Victoires</th>
                                <th>Podiums (Top 3)</th>
                                <th>Taux de Victoire %</th>
                                <th>Taux de Podium %</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ecuries.map((e, idx) => `
                                <tr>
                                    <td style="font-weight: 800; color: var(--accent-gold); font-family: 'JetBrains Mono';">#${idx + 1}</td>
                                    <td style="font-weight: 700; color: var(--text-pure);">${escapeHtml(e.nom_ecurie)}</td>
                                    <td style="font-family: 'JetBrains Mono';">${e.total_engagements}</td>
                                    <td style="font-weight: 800; color: var(--accent-emerald); font-family: 'JetBrains Mono';">${e.victoires} V</td>
                                    <td style="font-weight: 700; color: var(--accent-indigo); font-family: 'JetBrains Mono';">${e.podiums} P</td>
                                    <td><div class="badge ${e.win_pct >= 20 ? 'badge-success' : 'badge-warning'}">${e.win_pct}%</div></td>
                                    <td><div class="badge ${e.podium_pct >= 40 ? 'badge-success' : 'badge-warning'}">${e.podium_pct}%</div></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch(err) {
        body.innerHTML = `<div style="color: var(--accent-crimson); padding: 40px; text-align: center;">Erreur lors du chargement des statistiques d'écuries.</div>`;
    }
};

