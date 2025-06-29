/**
 * Génère une liste de dates pour une période donnée
 * @param {number} days - Nombre de jours à générer
 * @param {Date} endDate - Date de fin (par défaut aujourd'hui)
 * @returns {Date[]} Liste des dates
 */
export function generateDateRange(days, endDate = new Date()) {
    const dates = [];
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days + 1);
    
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
}

/**
 * Génère les dates pour les X derniers mois
 * @param {number} months - Nombre de mois
 * @returns {Date[]} Liste des dates
 */
export function getDaysForLastMonths(months) {
    const days = [];
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    // Calculer le mois de début
    let startMonth = currentMonth - (months - 1);
    let startYear = currentYear;
    
    if (startMonth < 0) {
        startMonth += 12;
        startYear -= 1;
    }
    
    let date = new Date(startYear, startMonth, 1);
    
    while (date <= today) {
        days.push(new Date(date));
        date.setDate(date.getDate() + 1);
    }
    return days;
}

/**
 * Formate une date en string ISO
 * @param {Date} date - Date à formater
 * @returns {string} Date formatée YYYY-MM-DD
 */
export function formatDate(date) {
    return date.toISOString().split('T')[0];
}

/**
 * Calcule le pourcentage de progression
 * @param {number} current - Position actuelle
 * @param {number} total - Total
 * @returns {string} Pourcentage formaté
 */
export function calculateProgress(current, total) {
    return ((current / total) * 100).toFixed(1);
} 