/**
 * SYSTÈME D'ALERTES EN TEMPS RÉEL - V29
 * 
 * Détecte et gère les alertes critiques basées sur les tendances et performances
 */

import logger from '../utils/logger.mjs';
import { sendTelegramNotification } from '../utils/webhook.mjs';
import CONFIG from '../config/settings.mjs';

const MON = CONFIG.engine_settings.monitoring;

// Types d'alertes
export const ALERT_TYPES = {
    CRITICAL: 'CRITICAL',      // Drawdown > 20%
    DANGER: 'DANGER',          // Séquence 5+ défaites
    OPPORTUNITY: 'OPPORTUNITY', // Momentum > 80 + tendance haussière
    INFO: 'INFO',              // Pattern favorable détecté
    WARNING: 'WARNING'         // Situations à surveiller
};

// Priorités d'alertes
export const ALERT_PRIORITY = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
};

// Stockage en mémoire des alertes actives
let activeAlerts = [];
let alertHistory = [];
let alertIdCounter = 1;

/**
 * Crée une nouvelle alerte
 */
function createAlert(type, title, message, priority = ALERT_PRIORITY.MEDIUM, data = {}) {
    const alert = {
        id: alertIdCounter++,
        type,
        title,
        message,
        priority,
        data,
        timestamp: new Date().toISOString(),
        dismissed: false,
        read: false
    };

    activeAlerts.push(alert);
    alertHistory.push(alert);

    // Garder seulement les 100 dernières alertes en historique
    if (alertHistory.length > 100) {
        alertHistory = alertHistory.slice(-100);
    }

    logger.info(`[ALERTE ${type}] ${title}: ${message}`);

    // Envoi Webhook Telegram pour les alertes importantes (V42)
    if (priority >= ALERT_PRIORITY.MEDIUM) {
        sendTelegramNotification(title, message, priority).catch(err => {
            logger.error(`Erreur asynchrone Webhook: ${err.message}`);
        });
    }

    return alert;
}

/**
 * Analyse les tendances et génère les alertes appropriées
 * @param {Object} tendances - Tendances calculées
 * @param {Object} performance - Stats de performance
 * @param {Object} patternData - Données de patterns optimisés (Optionnel)
 */
export function analyserEtGenererAlertes(tendances, performance, patternData = null) {
    const newAlerts = [];

    // 1. ALERTE DRAWDOWN CRITIQUE
    if (tendances.drawdown.currentPercent > MON.alert_drawdown_critical) {
        newAlerts.push(createAlert(
            ALERT_TYPES.CRITICAL,
            '🚨 DRAWDOWN CRITIQUE',
            `Drawdown actuel de ${(tendances.drawdown.currentPercent * 100).toFixed(1)}% ! Réduction drastique des mises recommandée.`,
            ALERT_PRIORITY.HIGH,
            {
                drawdown: tendances.drawdown.current,
                drawdownPercent: tendances.drawdown.currentPercent,
                recommendation: 'Arrêter les paris ou réduire à 10% des mises normales'
            }
        ));
    } else if (tendances.drawdown.currentPercent > MON.alert_drawdown_warning) {
        newAlerts.push(createAlert(
            ALERT_TYPES.WARNING,
            '⚠️ Drawdown Élevé',
            `Drawdown de ${(tendances.drawdown.currentPercent * 100).toFixed(1)}%. Prudence recommandée.`,
            ALERT_PRIORITY.MEDIUM,
            { drawdown: tendances.drawdown.current }
        ));
    }

    // 2. ALERTE SÉQUENCE DE DÉFAITES
    if (tendances.sequence.type === 'LOSE' && tendances.sequence.count >= MON.alert_lose_streak_critical) {
        newAlerts.push(createAlert(
            ALERT_TYPES.DANGER,
            '❄️ SÉQUENCE DANGEREUSE',
            `${tendances.sequence.count} défaites consécutives depuis le ${tendances.sequence.depuis}. Pause recommandée.`,
            ALERT_PRIORITY.HIGH,
            {
                count: tendances.sequence.count,
                depuis: tendances.sequence.depuis,
                recommendation: 'Faire une pause de 24-48h pour réévaluer la stratégie'
            }
        ));
    } else if (tendances.sequence.type === 'LOSE' && tendances.sequence.count >= 3) {
        newAlerts.push(createAlert(
            ALERT_TYPES.WARNING,
            '⚠️ Série de Défaites',
            `${tendances.sequence.count} défaites d'affilée. Restez vigilant.`,
            ALERT_PRIORITY.MEDIUM,
            { count: tendances.sequence.count }
        ));
    }

    // 3. ALERTE OPPORTUNITÉ
    if (tendances.momentum >= MON.alert_momentum_ultra && tendances.tendance.tendance === 'HAUSSIERE') {
        newAlerts.push(createAlert(
            ALERT_TYPES.OPPORTUNITY,
            '🔥 OPPORTUNITÉ DÉTECTÉE',
            `Momentum à ${tendances.momentum} avec tendance haussière ! Conditions optimales pour parier.`,
            ALERT_PRIORITY.HIGH,
            {
                momentum: tendances.momentum,
                tendance: tendances.tendance.tendance,
                recommendation: 'Augmenter légèrement les mises (Kelly adaptatif actif)'
            }
        ));
    } else if (tendances.momentum >= 70) {
        newAlerts.push(createAlert(
            ALERT_TYPES.INFO,
            '📈 Momentum Positif',
            `Momentum à ${tendances.momentum}. Conditions favorables.`,
            ALERT_PRIORITY.LOW,
            { momentum: tendances.momentum }
        ));
    }

    // 4. ALERTE PATTERNS FAVORABLES
    if (tendances.patterns && tendances.patterns.meilleureDiscipline) {
        const discipline = tendances.patterns.meilleureDiscipline;
        const heure = tendances.patterns.meilleureHeure;

        // Vérifier si on est dans la plage horaire favorable
        const now = new Date();
        const currentHour = now.getHours();

        if (heure && isInFavorableTimeRange(currentHour, heure)) {
            newAlerts.push(createAlert(
                ALERT_TYPES.INFO,
                '🎯 Pattern Favorable Actif',
                `C'est l'heure optimale (${heure}) pour ${discipline} !`,
                ALERT_PRIORITY.MEDIUM,
                {
                    discipline,
                    heure,
                    recommendation: `Privilégier les courses de ${discipline}`
                }
            ));
        }
    }

    // 5. ALERTE SHARPE RATIO FAIBLE
    if (tendances.sharpe < MON.alert_sharpe_min) {
        newAlerts.push(createAlert(
            ALERT_TYPES.WARNING,
            '📉 Ratio Sharpe Négatif',
            `Sharpe à ${tendances.sharpe.toFixed(2)}. Le risque dépasse largement le rendement.`,
            ALERT_PRIORITY.MEDIUM,
            {
                sharpe: tendances.sharpe,
                recommendation: 'Réévaluer la stratégie ou faire une pause'
            }
        ));
    }

    // 6. ALERTE SÉQUENCE DE VICTOIRES (Positif)
    if (tendances.sequence.type === 'WIN' && tendances.sequence.count >= 5) {
        newAlerts.push(createAlert(
            ALERT_TYPES.INFO,
            '🔥 SÉRIE GAGNANTE',
            `${tendances.sequence.count} victoires consécutives ! Excellente performance.`,
            ALERT_PRIORITY.LOW,
            {
                count: tendances.sequence.count,
                depuis: tendances.sequence.depuis,
                recommendation: 'Maintenir la discipline, ne pas sur-parier'
            }
        ));
    }

    // 7. ALERTES PATTERNS OPTIMISÉS (V29)
    if (patternData) {
        // Golden Patterns
        if (patternData.goldenPatterns && patternData.goldenPatterns.length > 0) {
            patternData.goldenPatterns.slice(0, 3).forEach(gp => {
                newAlerts.push(createAlert(
                    ALERT_TYPES.OPPORTUNITY,
                    '🏆 GOLDEN PATTERN DÉTECTÉ',
                    `Pattern à haut rendement: ${gp.pattern} (ROI: ${gp.roi}%)`,
                    ALERT_PRIORITY.MEDIUM,
                    { pattern: gp.pattern, roi: gp.roi, winRate: gp.winRate }
                ));
            });
        }

        // Danger Patterns
        if (patternData.dangerPatterns && patternData.dangerPatterns.length > 0) {
            patternData.dangerPatterns.slice(0, 3).forEach(dp => {
                newAlerts.push(createAlert(
                    ALERT_TYPES.WARNING,
                    '⚠️ PATTERN À ÉVITER',
                    `Pattern à risque: ${dp.pattern} (ROI: ${dp.roi}%)`,
                    ALERT_PRIORITY.MEDIUM,
                    { pattern: dp.pattern, roi: dp.roi }
                ));
            });
        }

        // Smart Money Alerts
        if (patternData.smartMoney && patternData.smartMoney.length > 0) {
            patternData.smartMoney.forEach(sm => {
                newAlerts.push(createAlert(
                    ALERT_TYPES.OPPORTUNITY,
                    '🧠 SMART MONEY DÉTECTÉ',
                    `${sm.cheval} (${sm.course}): Baisse de cote de ${Math.abs(sm.variation).toFixed(0)}%`,
                    ALERT_PRIORITY.MEDIUM,
                    { ...sm }
                ));
            });
        }
    }

    return newAlerts;
}

/**
 * Vérifie si l'heure actuelle est dans la plage favorable
 */
function isInFavorableTimeRange(currentHour, favorableRange) {
    // Format: "10h-11h"
    if (!favorableRange) return false;

    const match = favorableRange.match(/(\d+)h-(\d+)h/);
    if (!match) return false;

    const start = parseInt(match[1]);
    const end = parseInt(match[2]);

    return currentHour >= start && currentHour < end;
}

/**
 * Récupère toutes les alertes actives (non dismissées)
 */
export function getActiveAlerts() {
    return activeAlerts.filter(a => !a.dismissed);
}

/**
 * Récupère l'historique complet des alertes
 */
export function getAlertHistory(limit = 50) {
    return alertHistory.slice(-limit).reverse();
}

/**
 * Marque une alerte comme lue
 */
export function markAlertAsRead(alertId) {
    const alert = activeAlerts.find(a => a.id === alertId);
    if (alert) {
        alert.read = true;
        return true;
    }
    return false;
}

/**
 * Dismiss une alerte (la retire des alertes actives)
 */
export function dismissAlert(alertId) {
    const alert = activeAlerts.find(a => a.id === alertId);
    if (alert) {
        alert.dismissed = true;
        activeAlerts = activeAlerts.filter(a => a.id !== alertId);
        logger.info(`Alerte #${alertId} dismissée`);
        return true;
    }
    return false;
}

/**
 * Dismiss toutes les alertes
 */
export function dismissAllAlerts() {
    activeAlerts.forEach(a => a.dismissed = true);
    const count = activeAlerts.length;
    activeAlerts = [];
    logger.info(`${count} alertes dismissées`);
    return count;
}

/**
 * Compte les alertes par type
 */
export function getAlertStats() {
    const active = getActiveAlerts();

    return {
        total: active.length,
        critical: active.filter(a => a.type === ALERT_TYPES.CRITICAL).length,
        danger: active.filter(a => a.type === ALERT_TYPES.DANGER).length,
        opportunity: active.filter(a => a.type === ALERT_TYPES.OPPORTUNITY).length,
        warning: active.filter(a => a.type === ALERT_TYPES.WARNING).length,
        info: active.filter(a => a.type === ALERT_TYPES.INFO).length,
        unread: active.filter(a => !a.read).length
    };
}

/**
 * Nettoie les vieilles alertes (> 7 jours)
 */
export function cleanOldAlerts() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const before = alertHistory.length;
    alertHistory = alertHistory.filter(a => new Date(a.timestamp) > sevenDaysAgo);
    const removed = before - alertHistory.length;

    if (removed > 0) {
        logger.info(`${removed} anciennes alertes nettoyées`);
    }

    return removed;
}
