/**
 * Formate une date en string YYYY-MM-DD (fuseau horaire Europe/Paris)
 * @param {Date|string|number} date - Date à formater
 * @param {string} timeZone - Fuseau horaire (défaut: 'Europe/Paris')
 * @returns {string} Date formatée YYYY-MM-DD
 */
export function formatDate(date = new Date(), timeZone = 'Europe/Paris') {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const [year, month, day] = date.split('-').map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
            ? date
            : '';
    }
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-CA', { timeZone });
}

/**
 * Formate une heure de départ en HH:mm (fuseau horaire Europe/Paris)
 * @param {Date|string|number} date - Date ou timestamp
 * @param {string} timeZone - Fuseau horaire (défaut: 'Europe/Paris')
 * @returns {string} Heure formatée HH:mm
 */
export function formatHeure(date, timeZone = 'Europe/Paris') {
    if (!date) return '--:--';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone
    });
}
