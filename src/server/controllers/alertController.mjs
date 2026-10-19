import { getActiveAlerts, getAlertHistory, dismissAlert, dismissAllAlerts, getAlertStats, markAlertAsRead, analyserEtGenererAlertes } from '../../core/alerts.mjs';
import logger from '../../utils/logger.mjs';
import { parseDays } from '../../utils/requestParams.mjs';

function parseAlertId(value) {
    const text = String(value ?? '');
    if (!/^\d+$/.test(text)) return null;
    const id = Number(text);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function getAlerts(req, res) {
    try {
        const alerts = getActiveAlerts();
        const stats = getAlertStats();
        res.json({ alerts, stats });
    } catch (error) {
        logger.error(`API Error Alerts: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export function getHistory(req, res) {
    try {
        const rawLimit = req.query.limit;
        const limit = rawLimit === undefined ? 50 : Number(rawLimit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
            return res.status(400).json({ error: 'Le paramètre limit doit être un entier entre 1 et 500.' });
        }
        const history = getAlertHistory(limit);
        res.json(history);
    } catch (error) {
        logger.error(`API Error Alert History: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export function dismiss(req, res) {
    try {
        const alertId = parseAlertId(req.params.id);
        if (alertId === null) return res.status(400).json({ success: false, message: 'Identifiant d’alerte invalide.' });
        const success = dismissAlert(alertId);
        if (success) res.json({ success: true, message: 'Alerte dismissée' });
        else res.status(404).json({ success: false, message: 'Alerte non trouvée' });
    } catch (error) {
        logger.error(`API Error Dismiss Alert: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export function dismissAll(req, res) {
    try {
        const count = dismissAllAlerts();
        res.json({ success: true, count, message: `${count} alertes dismissées` });
    } catch (error) {
        logger.error(`API Error Dismiss All: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export function markRead(req, res) {
    try {
        const alertId = parseAlertId(req.params.id);
        if (alertId === null) return res.status(400).json({ success: false, message: 'Identifiant d’alerte invalide.' });
        const success = markAlertAsRead(alertId);
        if (success) res.json({ success: true, message: 'Alerte marquée comme lue' });
        else res.status(404).json({ success: false, message: 'Alerte non trouvée' });
    } catch (error) {
        logger.error(`API Error Mark Read: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function generate(req, res) {
    try {
        const { days } = req.query;
        const daysFilter = parseDays(days);
        if (daysFilter === undefined) return res.status(400).json({ error: 'Le paramètre days doit être un entier entre 1 et 3650.' });
        const { getTendancesCumulees, getIAPerformanceStats, getHistoriqueParis } = await import('../../core/db.mjs');
        const { analyseCompletePatterns } = await import('../../core/pattern_optimizer.mjs');

        const tendances = await getTendancesCumulees(daysFilter);
        const performance = await getIAPerformanceStats(daysFilter);
        const historique = await getHistoriqueParis(daysFilter ?? 30);
        const patternData = await analyseCompletePatterns(historique);

        const newAlerts = analyserEtGenererAlertes(tendances, performance, patternData);

        res.json({
            success: true,
            generated: newAlerts.length,
            alerts: newAlerts,
            patternStats: patternData.stats
        });
    } catch (error) {
        logger.error(`API Error Generate Alerts: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getTelegramStatus(req, res) {
    try {
        const { getTelegramConfig } = await import('../../utils/telegram.mjs');
        const config = getTelegramConfig();
        res.json({
            success: true,
            enabled: config.enabled,
            hasToken: Boolean(config.botToken),
            hasChatId: Boolean(config.chatId)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function configureTelegram(req, res) {
    try {
        const { botToken, chatId, enabled } = req.body || {};
        if ((botToken !== undefined && (typeof botToken !== 'string' || botToken.length > 512))
            || (chatId !== undefined && (typeof chatId !== 'string' || chatId.length > 128))
            || (enabled !== undefined && typeof enabled !== 'boolean')) {
            return res.status(400).json({ success: false, error: 'Configuration Telegram invalide.' });
        }
        const { setTelegramConfig } = await import('../../utils/telegram.mjs');
        const updated = setTelegramConfig({
            botToken: botToken?.trim(),
            chatId: chatId?.trim(),
            enabled
        });
        res.json({ success: true, config: { enabled: updated.enabled, hasToken: Boolean(updated.botToken), hasChatId: Boolean(updated.chatId) } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function testTelegram(req, res) {
    try {
        const { sendTelegramMessage } = await import('../../utils/telegram.mjs');
        const message = req.body?.message;
        if (message !== undefined && (typeof message !== 'string' || message.length > 4096)) {
            return res.status(400).json({ success: false, error: 'Message Telegram invalide (4096 caractères maximum).' });
        }
        const text = message || `🔔 <b>TEST TELEGRAM PMU-PRONO</b>\nConnexion établie avec succès avec l'Agent IA !`;
        const result = await sendTelegramMessage(text);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
