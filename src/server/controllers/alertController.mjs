import { getActiveAlerts, getAlertHistory, dismissAlert, dismissAllAlerts, getAlertStats, markAlertAsRead, analyserEtGenererAlertes } from '../../core/alerts.mjs';
import logger from '../../utils/logger.mjs';

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
        const { limit = 50 } = req.query;
        const history = getAlertHistory(parseInt(limit));
        res.json(history);
    } catch (error) {
        logger.error(`API Error Alert History: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export function dismiss(req, res) {
    try {
        const alertId = parseInt(req.params.id);
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
        const alertId = parseInt(req.params.id);
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
        const { getTendancesCumulees, getIAPerformanceStats, getHistoriqueParis } = await import('../../core/db.mjs');
        const { analyseCompletePatterns } = await import('../../core/pattern_optimizer.mjs');

        const tendances = await getTendancesCumulees(days ? parseInt(days) : null);
        const performance = await getIAPerformanceStats(days ? parseInt(days) : null);
        const historique = await getHistoriqueParis(days ? parseInt(days) : 30);
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
        const { botToken, chatId, enabled } = req.body;
        const { setTelegramConfig } = await import('../../utils/telegram.mjs');
        const updated = setTelegramConfig({ botToken, chatId, enabled });
        res.json({ success: true, config: { enabled: updated.enabled, hasToken: Boolean(updated.botToken), hasChatId: Boolean(updated.chatId) } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function testTelegram(req, res) {
    try {
        const { sendTelegramMessage } = await import('../../utils/telegram.mjs');
        const text = req.body.message || `🔔 <b>TEST TELEGRAM PMU-PRONO</b>\nConnexion établie avec succès avec l'Agent IA !`;
        const result = await sendTelegramMessage(text);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
