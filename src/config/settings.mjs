// src/config/settings.mjs
export const CONFIG = {
    // Paramètres de base de données
    database: {
        path: './data/pmu.db',
        backupPath: './data/backup/'
    },
    
    // Paramètres de filtrage
    filters: {
        disciplines: ['TROT', 'PLAT', 'OBSTACLE', 'STEEPLECHASE', 'HAIE', 'MONTE', 'ATTELE'],
        requiredFields: ['date', 'heure', 'hippodrome', 'discipline', 'distance', 'statut', 'partants']
    },
    
    // Paramètres de récupération
    fetcher: {
        retryAttempts: 3,
        retryDelay: 2000,
        timeout: 30000
    },
    
    // Périodes prédéfinies
    periods: {
        week: 7,
        month: 30,
        quarter: 90,
        semester: 180,
        year: 365
    }
};

export default CONFIG; 