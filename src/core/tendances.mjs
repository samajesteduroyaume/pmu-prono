import logger from '../utils/logger.mjs';
import { getPlageHoraire } from './pattern_optimizer.mjs';

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

    // Régression linéaire simple: y = ax + b
    const n = historique.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    historique.forEach((entry, index) => {
        const x = index;
        const y = entry.cumulative || 0;
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
 * @param {Array} historique - Tableau d'objets {date, cumulative}
 * @returns {number} Score de momentum entre 0 et 100
 */
export function calculerMomentum(historique) {
    if (!historique || historique.length < 8) return 50;

    // ROI des 7 derniers jours
    const recent7 = historique.slice(-7);
    const roiRecent = recent7.length > 1
        ? ((recent7[recent7.length - 1].cumulative - recent7[0].cumulative) / Math.abs(recent7[0].cumulative || 1)) * 100
        : 0;

    // ROI des 30 derniers jours (ou tout l'historique si < 30)
    const period30 = historique.slice(-30);
    const roiPeriod = period30.length > 1
        ? ((period30[period30.length - 1].cumulative - period30[0].cumulative) / Math.abs(period30[0].cumulative || 1)) * 100
        : 0;

    // Momentum = comparaison ROI récent vs ROI période
    let momentum = 50; // Neutre par défaut

    if (roiPeriod !== 0) {
        const ratio = roiRecent / roiPeriod;
        // Si ROI récent > ROI période = momentum positif
        if (ratio > 1.5) momentum = 85;
        else if (ratio > 1.2) momentum = 75;
        else if (ratio > 1.0) momentum = 65;
        else if (ratio > 0.8) momentum = 50;
        else if (ratio > 0.5) momentum = 35;
        else momentum = 20;
    }

    return Math.round(momentum);
}

/**
 * Calcule le drawdown maximum et actuel
 * @param {Array} historique - Tableau d'objets {date, cumulative}
 * @returns {Object} {current: number, max: number, currentPercent: number, maxPercent: number}
 */
export function calculerDrawdown(historique) {
    if (!historique || historique.length === 0) {
        return { current: 0, max: 0, currentPercent: 0, maxPercent: 0 };
    }

    let peak = historique[0].cumulative || 0;
    let maxDrawdown = 0;
    let currentDrawdown = 0;

    historique.forEach(entry => {
        const value = entry.cumulative || 0;

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
        }
    });

    // Calcul en pourcentage
    const currentPercent = peak !== 0 ? (currentDrawdown / peak) : 0;
    const maxPercent = peak !== 0 ? (maxDrawdown / peak) : 0;

    return {
        current: parseFloat(currentDrawdown.toFixed(2)),
        max: parseFloat(maxDrawdown.toFixed(2)),
        currentPercent: parseFloat(currentPercent.toFixed(4)),
        maxPercent: parseFloat(maxPercent.toFixed(4))
    };
}

/**
 * Calcule la variance et l'écart-type des gains
 * @param {Array} historique - Tableau d'objets {date, gain}
 * @returns {Object} {variance: number, ecartType: number}
 */
export function calculerVariance(historique) {
    if (!historique || historique.length < 2) {
        return { variance: 0, ecartType: 0 };
    }

    const gains = historique.map(h => h.gain || 0);
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
    if (!historique || historique.length < 2) return 0;

    const gains = historique.map(h => h.gain || 0);
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
            parDiscipline[disc] = { total: 0, wins: 0, gains: 0 };
        }
        parDiscipline[disc].total++;
        if (c.resultat === 'WIN' || (c.gain && c.gain > 0)) {
            parDiscipline[disc].wins++;
        }
        parDiscipline[disc].gains += (c.gain || 0);
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
            parHippodrome[hippo] = { total: 0, wins: 0, gains: 0 };
        }
        parHippodrome[hippo].total++;
        if (c.resultat === 'WIN' || (c.gain && c.gain > 0)) {
            parHippodrome[hippo].wins++;
        }
        parHippodrome[hippo].gains += (c.gain || 0);
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
        const heure = parseInt(c.heure.split(':')[0]);
        const plage = getPlageHoraire(heure);
        if (!parHeure[plage]) {
            parHeure[plage] = { total: 0, wins: 0 };
        }
        parHeure[plage].total++;
        if (c.resultat === 'WIN' || (c.gain && c.gain > 0)) {
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
        if (!c.date) return;
        const date = new Date(c.date);
        const jour = date.toLocaleDateString('fr-FR', { weekday: 'long' });
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
