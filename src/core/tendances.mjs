import logger from '../utils/logger.mjs';
import { getPlageHoraire } from './pattern_optimizer.mjs';
import CONFIG from '../config/settings.mjs';

/**
 * MODULE DE TENDANCES CUMULÉES AVANCÉES v1.0
 * 
 * Analyse approfondie des performances avec:
 * - Détection de tendances (haussière/baissière/neutre)
 * - Calcul de momentum
 * - Maximum drawdown et drawdown actuel
 * - Ratio de Sharpe
 * - Détection de séquences (victoires/défaites consécutives)
 * - Patterns par discipline, hippodrome, horaire
 */

/**
 * Calcule la tendance globale avec régression linéaire
 * @param {Array} historique - Tableau d'objets {date, cumulative, gain}
 * @returns {Object} {tendance: 'HAUSSIERE'|'BAISSIERE'|'NEUTRE', pente: number}
 */
export function calculerTendanceCumulee(historique) {
    if (!historique || historique.length < 2) {
        return { tendance: 'NEUTRE', pente: 0 };
    }

    const cumulativeValues = historique.map(entry =>
        entry?.cumulative == null ? NaN : Number(entry.cumulative)
    );
    if (cumulativeValues.some(value => !Number.isFinite(value))) {
        return { tendance: 'NEUTRE', pente: 0 };
    }

    // Régression linéaire simple: y = ax + b
    const n = cumulativeValues.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    historique.forEach((entry, index) => {
        const x = index;
        const y = cumulativeValues[index];
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
    });

    const pente = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    // Classification de la tendance
    let tendance = 'NEUTRE';
    if (pente > 5) tendance = 'HAUSSIERE';
    else if (pente < -5) tendance = 'BAISSIERE';

    return { tendance, pente: parseFloat(pente.toFixed(2)) };
}

/**
 * Calcule le momentum (0-100) basé sur la performance récente vs historique
 * @param {Array} historique - Tableau d'objets {date, gain, mise}
 * @returns {number} Score de momentum entre 0 et 100
 */
export function calculerMomentum(historique) {
    if (!historique || historique.length < 8) return 50;
    const daily = new Map();
    for (const entry of historique) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') || entry.gain == null) continue;
        const parsedDate = new Date(`${entry.date}T12:00:00.000Z`);
        if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== entry.date) continue;
        const profit = Number(entry.gain);
        const stake = Number(entry.mise);
        if (!Number.isFinite(profit) || !Number.isFinite(stake) || stake <= 0) continue;
        const day = daily.get(entry.date) || { profit: 0, stake: 0 };
        day.profit += profit;
        day.stake += stake;
        daily.set(entry.date, day);
    }
    if (!daily.size) return 50;

    const latestDate = [...daily.keys()].sort().at(-1);
    const shiftDate = (value, days) => {
        const date = new Date(`${value}T12:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    };
    const calculateRoi = cutoff => {
        let profit = 0;
        let stake = 0;
        for (const [date, totals] of daily) {
            if (date < cutoff || date > latestDate) continue;
            profit += totals.profit;
            stake += totals.stake;
        }
        return stake > 0 ? (profit / stake) * 100 : null;
    };

    // Fenêtres calendaires ancrées sur le dernier jour réglé, pas sur le nombre de courses.
    const roiRecent = calculateRoi(shiftDate(latestDate, -6));
    const roiPeriod = calculateRoi(shiftDate(latestDate, -29));
    if (roiRecent === null || roiPeriod === null) return 50;

    // Chaque amélioration de 10 points de ROI apporte 20 points de momentum.
    return Math.round(Math.max(0, Math.min(100, 50 + (roiRecent - roiPeriod) * 2)));
}

/**
 * Calcule le drawdown maximum et actuel
 * @param {Array} historique - Tableau d'objets {date, cumulative}
 * @returns {Object} {current: number, max: number, currentPercent: number, maxPercent: number}
 */
export function calculerDrawdown(historique, initialCapital = CONFIG.engine_settings.finance.bankroll_default) {
    if (!historique || historique.length === 0) {
        return { current: 0, max: 0, currentPercent: 0, maxPercent: 0 };
    }

    const startingCapital = Number.isFinite(Number(initialCapital)) && Number(initialCapital) > 0
        ? Number(initialCapital)
        : CONFIG.engine_settings.finance.bankroll_default;
    // Le capital initial est le premier sommet du parcours : une première
    // perte doit déjà apparaître dans le drawdown.
    let peak = startingCapital;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let currentDrawdown = 0;

    historique.forEach(entry => {
        const value = startingCapital + (Number(entry.cumulative) || 0);

        // Nouveau pic
        if (value > peak) {
            peak = value;
        }

        // Calcul du drawdown actuel
        const dd = peak - value;
        currentDrawdown = dd;

        // Mise à jour du drawdown maximum
        if (dd > maxDrawdown) {
            maxDrawdown = dd;
            maxDrawdownPercent = peak > 0 ? dd / peak : 1;
        }
    });

    // Calcul en pourcentage
    const currentPercent = peak > 0 ? (currentDrawdown / peak) : (currentDrawdown > 0 ? 1 : 0);

    return {
        current: parseFloat(currentDrawdown.toFixed(2)),
        max: parseFloat(maxDrawdown.toFixed(2)),
        currentPercent: parseFloat(currentPercent.toFixed(4)),
        maxPercent: parseFloat(maxDrawdownPercent.toFixed(4))
    };
}

/**
 * Calcule la variance et l'écart-type des gains
 * @param {Array} historique - Tableau d'objets {date, gain}
 * @returns {Object} {variance: number, ecartType: number}
 */
export function calculerVariance(historique) {
    const gains = (historique || [])
        .map(entry => entry?.gain == null ? NaN : Number(entry.gain))
        .filter(Number.isFinite);
    if (gains.length < 2) {
        return { variance: 0, ecartType: 0 };
    }
    const moyenne = gains.reduce((a, b) => a + b, 0) / gains.length;

    const variance = gains.reduce((sum, gain) => {
        return sum + Math.pow(gain - moyenne, 2);
    }, 0) / gains.length;

    const ecartType = Math.sqrt(variance);

    return {
        variance: parseFloat(variance.toFixed(2)),
        ecartType: parseFloat(ecartType.toFixed(2))
    };
}

/**
 * Calcule le ratio de Sharpe (rendement ajusté au risque)
 * @param {Array} historique - Tableau d'objets {date, gain}
 * @param {number} tauxSansRisque - Taux sans risque annuel (défaut: 0.02 = 2%)
 * @returns {number} Ratio de Sharpe
 */
export function calculerRatioSharpe(historique, tauxSansRisque = 0.02) {
    const gains = (historique || [])
        .map(entry => entry?.gain == null ? NaN : Number(entry.gain))
        .filter(Number.isFinite);
    if (gains.length < 2) return 0;
    const rendementMoyen = gains.reduce((a, b) => a + b, 0) / gains.length;

    const { ecartType } = calculerVariance(historique);

    if (ecartType === 0) return 0;

    // Sharpe = (Rendement Moyen - Taux sans risque) / Écart-type
    // Ajustement: on considère le taux sans risque journalier
    const tauxJournalier = tauxSansRisque / 365;
    const sharpe = (rendementMoyen - tauxJournalier) / ecartType;

    return parseFloat(sharpe.toFixed(2));
}

/**
 * Détecte les séquences de victoires ou défaites consécutives
 * @param {Array} historique - Tableau d'objets {date, gain, resultat}
 * @returns {Object} {type: 'WIN'|'LOSE'|'NEUTRE', count: number, depuis: string}
 */
export function detecterSequences(historique) {
    if (!historique || historique.length === 0) {
        return { type: 'NEUTRE', count: 0, depuis: null };
    }

    // Parcourir l'historique du plus récent au plus ancien
    const reversed = [...historique].reverse();
    let currentType = null;
    let count = 0;
    let depuis = null;

    for (const entry of reversed) {
        const isWin = (entry.gain && entry.gain > 0) || entry.resultat === 'WIN';
        const isLose = (entry.gain && entry.gain < 0) || entry.resultat === 'LOSE';

        if (count === 0) {
            // Première entrée
            if (isWin) {
                currentType = 'WIN';
                count = 1;
                depuis = entry.date;
            } else if (isLose) {
                currentType = 'LOSE';
                count = 1;
                depuis = entry.date;
            }
        } else {
            // Vérifier si la séquence continue
            if ((currentType === 'WIN' && isWin) || (currentType === 'LOSE' && isLose)) {
                count++;
                depuis = entry.date;
            } else {
                // Séquence interrompue
                break;
            }
        }
    }

    return {
        type: currentType || 'NEUTRE',
        count,
        depuis
    };
}

/**
 * Détecte les patterns de performance par discipline, hippodrome, horaire
 * @param {Array} courses - Tableau de courses avec {discipline, hippodrome, heure, gain, resultat}
 * @returns {Object} Patterns détectés
 */
export function detecterPatterns(courses) {
    if (!courses || courses.length === 0) {
        return {
            meilleureDiscipline: null,
            meilleureHeure: null,
            meilleursJours: [],
            hippodromesPerformants: []
        };
    }

    // Analyse par discipline
    const parDiscipline = {};
    courses.forEach(c => {
        const disc = c.discipline || 'INCONNU';
        if (!parDiscipline[disc]) {
            parDiscipline[disc] = { total: 0, wins: 0 };
        }
        parDiscipline[disc].total++;
        if (c.resultat === 'WIN' || (Number.isFinite(Number(c.gain)) && Number(c.gain) > 0)) {
            parDiscipline[disc].wins++;
        }
    });

    let meilleureDiscipline = null;
    let meilleureWinRate = 0;
    Object.keys(parDiscipline).forEach(disc => {
        const winRate = parDiscipline[disc].wins / parDiscipline[disc].total;
        if (winRate > meilleureWinRate) {
            meilleureWinRate = winRate;
            meilleureDiscipline = disc;
        }
    });

    // Analyse par hippodrome
    const parHippodrome = {};
    courses.forEach(c => {
        const hippo = c.hippodrome || 'INCONNU';
        if (!parHippodrome[hippo]) {
            parHippodrome[hippo] = { total: 0, wins: 0 };
        }
        parHippodrome[hippo].total++;
        if (c.resultat === 'WIN' || (Number.isFinite(Number(c.gain)) && Number(c.gain) > 0)) {
            parHippodrome[hippo].wins++;
        }
    });

    const hippodromesPerformants = Object.keys(parHippodrome)
        .filter(h => parHippodrome[h].total >= 3) // Au moins 3 courses
        .sort((a, b) => {
            const winRateA = parHippodrome[a].wins / parHippodrome[a].total;
            const winRateB = parHippodrome[b].wins / parHippodrome[b].total;
            return winRateB - winRateA;
        })
        .slice(0, 3);

    // Analyse par heure (plage horaire)
    const parHeure = {};
    courses.forEach(c => {
        if (!c.heure) return;
        const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(c.heure));
        if (!match) return;
        const heure = Number(match[1]);
        if (heure > 23) return;
        const plage = getPlageHoraire(heure);
        if (!parHeure[plage]) {
            parHeure[plage] = { total: 0, wins: 0 };
        }
        parHeure[plage].total++;
        if (c.resultat === 'WIN' || (Number.isFinite(Number(c.gain)) && Number(c.gain) > 0)) {
            parHeure[plage].wins++;
        }
    });

    let meilleureHeure = null;
    let meilleureHeureWinRate = 0;
    Object.keys(parHeure).forEach(plage => {
        const winRate = parHeure[plage].wins / parHeure[plage].total;
        if (winRate > meilleureHeureWinRate && parHeure[plage].total >= 3) {
            meilleureHeureWinRate = winRate;
            meilleureHeure = plage;
        }
    });

    // Analyse par jour de la semaine
    const parJour = {};
    courses.forEach(c => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || '')) return;
        const [year, month, day] = c.date.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day, 12));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return;
        const jour = date.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
        if (!parJour[jour]) {
            parJour[jour] = { total: 0, wins: 0 };
        }
        parJour[jour].total++;
        if (c.resultat === 'WIN' || (c.gain && c.gain > 0)) {
            parJour[jour].wins++;
        }
    });

    const meilleursJours = Object.keys(parJour)
        .filter(j => parJour[j].total >= 2)
        .sort((a, b) => {
            const winRateA = parJour[a].wins / parJour[a].total;
            const winRateB = parJour[b].wins / parJour[b].total;
            return winRateB - winRateA;
        })
        .slice(0, 2);

    return {
        meilleureDiscipline,
        meilleureHeure,
        meilleursJours,
        hippodromesPerformants
    };
}

/**
 * Analyse complète des tendances
 * @param {Array} historique - Historique complet avec {date, cumulative, gain, resultat}
 * @param {Array} courses - Courses détaillées pour patterns
 * @returns {Object} Analyse complète
 */
export function analyserTendancesCompletes(historique, courses = []) {
    const tendance = calculerTendanceCumulee(historique);
    const momentum = calculerMomentum(historique);
    const drawdown = calculerDrawdown(historique);
    const variance = calculerVariance(historique);
    const sharpe = calculerRatioSharpe(historique);
    const sequence = detecterSequences(historique);
    const patterns = detecterPatterns(courses);

    logger.info(`[TENDANCES] Tendance: ${tendance.tendance}, Momentum: ${momentum}, Drawdown: ${drawdown.currentPercent.toFixed(2)}%`);

    return {
        tendance,
        momentum,
        drawdown,
        variance,
        sharpe,
        sequence,
        patterns,
        timestamp: new Date().toISOString()
    };
}
