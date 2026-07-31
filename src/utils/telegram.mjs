import logger from './logger.mjs';

let telegramConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
};

export function setTelegramConfig({ botToken, chatId, enabled = true }) {
    if (botToken !== undefined) telegramConfig.botToken = botToken;
    if (chatId !== undefined) telegramConfig.chatId = chatId;
    telegramConfig.enabled = enabled && Boolean(telegramConfig.botToken && telegramConfig.chatId);
    return telegramConfig;
}

export function getTelegramConfig() {
    return { ...telegramConfig };
}

export async function sendTelegramMessage(text, parseMode = 'HTML') {
    if (!telegramConfig.enabled || !telegramConfig.botToken || !telegramConfig.chatId) {
        logger.warn('[Telegram] Service non configuré ou désactivé.');
        return { success: false, reason: 'Telegram non configuré' };
    }

    try {
        const url = `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramConfig.chatId,
                text: text,
                parse_mode: parseMode,
                disable_web_page_preview: true
            })
        });

        const data = await response.json();
        if (!response.ok || !data.ok) {
            logger.error(`[Telegram Error] ${data.description || response.statusText}`);
            return { success: false, error: data.description || 'Erreur Telegram API' };
        }

        logger.info('[Telegram] Notification envoyée avec succès.');
        return { success: true, message_id: data.result?.message_id };
    } catch (err) {
        logger.error(`[Telegram Error] ${err.message}`);
        return { success: false, error: err.message };
    }
}

export async function sendSmartMoneyTelegramAlert(horseAlerts) {
    if (!horseAlerts || horseAlerts.length === 0) return;

    let text = `🚀 <b>ALERTE SMART MONEY PMU-PRONO</b>\n`;
    text += `<i>Mouvement de masse et chute de cote détectée !</i>\n\n`;

    horseAlerts.forEach(h => {
        text += `🏇 <b>${h.nom || h.horseName || 'Cheval'}</b>\n`;
        text += `📍 Course: ${h.course || 'En direct'}\n`;
        text += `📉 Cote: <b>${h.cote || '--'}</b> | Edge: <b>+${h.edge || 0}%</b>\n\n`;
    });

    return await sendTelegramMessage(text);
}

export async function sendQuinteTelegramAlert(quinteData) {
    if (!quinteData || !quinteData.course) return;

    const { course, selection, tocard } = quinteData;
    let text = `🏆 <b>PRONOSTIC QUINTÉ+ DU JOUR</b>\n`;
    text += `📌 <b>${course.hippodrome}</b> (R${course.reunionNum} C${course.courseNum} - ${course.heure})\n`;
    text += `📏 ${course.discipline} • ${course.distance}m • Prix: ${course.prix?.toLocaleString() || 0} €\n\n`;

    text += `<b>Sélection de l'IA (Top 8) :</b>\n`;
    selection.forEach((p, idx) => {
        text += `${idx + 1}. <b>#${p.numero} ${p.nom}</b> (Cote: ${p.cote_ref || '--'} | Score: ${p.score}%)\n`;
    });

    if (tocard) {
        text += `\n🎯 <b>Le Tocard de l'IA :</b> #${tocard.numero} ${tocard.nom} (Cote ${tocard.cote_ref})\n`;
    }

    return await sendTelegramMessage(text);
}
