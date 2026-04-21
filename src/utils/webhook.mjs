import { CONFIG } from '../config/settings.mjs';
import logger from './logger.mjs';

/**
 * MODULE DE NOTIFICATIONS WEBHOOK (V42)
 * Gère l'envoi d'alertes vers Telegram.
 */

export async function sendTelegramNotification(title, message, priority = 2) {
    const { enabled, token, chatId, priorityThreshold } = CONFIG.notifications.telegram;

    if (!enabled || !token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
        return false;
    }

    if (priority < priorityThreshold) {
        return false;
    }

    const payload = {
        chat_id: chatId,
        text: `*${title}*\n\n${message}`,
        parse_mode: 'Markdown'
    };

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            logger.error(`[WEBHOOK] Erreur Telegram: ${JSON.stringify(error)}`);
            return false;
        }

        logger.info(`[WEBHOOK] Notification envoyée: ${title}`);
        return true;
    } catch (err) {
        logger.error(`[WEBHOOK] Erreur réseau Telegram: ${err.message}`);
        return false;
    }
}

/**
 * Formate un message d'opportunité pour Telegram
 */
export function formatOpportunityMessage(data) {
    return `🎯 *${data.cheval}* (${data.course})\n` +
           `💰 Cote: *${data.cote}*\n` +
           `📉 Variation: *${data.variation.toFixed(1)}%*\n` +
           `📈 Conseil: *BET (Value Hunter)*`;
}
