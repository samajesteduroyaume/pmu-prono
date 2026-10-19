import logger from './logger.mjs';
import { getTelegramConfig, sendTelegramMessage } from './telegram.mjs';
import { CONFIG } from '../config/settings.mjs';

/**
 * MODULE DE NOTIFICATIONS WEBHOOK (V42)
 * Gère l'envoi d'alertes vers Telegram.
 */

export async function sendTelegramNotification(title, message, priority = 2) {
    const { enabled } = getTelegramConfig();
    const { priorityThreshold } = CONFIG.notifications.telegram;

    if (!enabled) {
        return false;
    }

    if (priority < priorityThreshold) {
        return false;
    }

    try {
        const result = await sendTelegramMessage(`*${title}*\n\n${message}`, 'Markdown');
        if (!result.success) return false;
        logger.info(`[WEBHOOK] Notification envoyée: ${title}`);
        return true;
    } catch (err) {
        logger.error(`[WEBHOOK] Erreur réseau Telegram: ${err.message}`);
        return false;
    }
}
