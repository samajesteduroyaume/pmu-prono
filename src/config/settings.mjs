// src/config/settings.mjs
export const CONFIG = {
    // Profils d'experts (Drivers & Entraîneurs)
    experts: {
        drivers: ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'BARZALONA', 'SOUMILLON', 'GUYON', 'PASQUIER', 'DEMURO', 'MOUROT', 'MOTTIER', 'GELORMINI', 'LAGADEUC'],
        trainers: ['DUVALDESTIN', 'BAZIRE', 'GUARATO', 'ABRIVARD', 'ALLAIRE', 'LEVESQUE', 'SOULOY', 'ROUGET', 'FABRE', 'PANTALL']
    },

    // Pondérations par défaut du moteur IA (Optimisées v40)
    weights: {
        TROT: {
            FORME: 0.2,
            ENTOURAGE: 0.25,
            CONFIANCE: 0.1,
            CONFIGURATION: 0.3,
            APTITUDE: 0.1,
            EXPERT: 0.05
        },
        PLAT: {
            FORME: 0.2,
            ENTOURAGE: 0.4,
            CONFIANCE: 0.05,
            CONFIGURATION: 0.16,
            APTITUDE: 0.16,
            EXPERT: 0.03
        },
        OBSTACLE: {
            FORME: 0.2,
            ENTOURAGE: 0.25,
            CONFIANCE: 0.05,
            CONFIGURATION: 0.3,
            APTITUDE: 0.15,
            EXPERT: 0.05
        },
        DEFAULT: {
            FORME: 0.15,
            ENTOURAGE: 0.35,
            CONFIANCE: 0.05,
            CONFIGURATION: 0.2,
            APTITUDE: 0.2,
            EXPERT: 0.05
        },
        ATTELE: {
            FORME: 0.15,
            ENTOURAGE: 0.1,
            CONFIANCE: 0.15,
            CONFIGURATION: 0.27,
            APTITUDE: 0.27,
            EXPERT: 0.06
        },
        MONTE: {
            FORME: 0.15,
            ENTOURAGE: 0.2,
            CONFIANCE: 0.05,
            CONFIGURATION: 0.27,
            APTITUDE: 0.27,
            EXPERT: 0.06
        },
        HAIE: {
            FORME: 0.2,
            ENTOURAGE: 0.25,
            CONFIANCE: 0.05,
            CONFIGURATION: 0.3,
            APTITUDE: 0.15,
            EXPERT: 0.05
        },
        STEEPLECHASE: {
            FORME: 0.2,
            ENTOURAGE: 0.25,
            CONFIANCE: 0.05,
            CONFIGURATION: 0.3,
            APTITUDE: 0.15,
            EXPERT: 0.05
        },
        CROSS: {
            FORME: 0.2,
            ENTOURAGE: 0.25,
            CONFIANCE: 0.05,
            CONFIGURATION: 0.3,
            APTITUDE: 0.15,
            EXPERT: 0.05
        }
    },

    // Paramètres de base de données
    database: {
        path: process.env.DB_PATH || './data/pmu.db',
        backupPath: './data/backup/'
    },
    
    // Paramètres de filtrage
    filters: {
        disciplines: ['TROT', 'MONTE', 'ATTELE'], // Restriction ROI V40 (Focus Trot)
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
    },
    
    // Notifications (V42)
    notifications: {
        telegram: {
            enabled: !!process.env.TELEGRAM_TOKEN,
            token: process.env.TELEGRAM_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN',
            chatId: process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID',
            priorityThreshold: 2 // ALERT_PRIORITY.MEDIUM par défaut
        }
    },
    
    // Constantes de calcul Architect v27.1
    architect: {
        classe: {
            factor: 15000
        },
        forme: {
            decay: 0.8,
            recentWinBonus: 15
        },
        hybride: {
            mlWeight: 0.7,
            heuristicWeight: 0.3
        },
        malus: {
            rentreeLongue: 35,
            rentreeSaisonniere: 10,
            trotDA: 50 // Moins sévère (v27.1)
        }
    },

    // Réglages spécifiques aux moteurs de discipline
    engine_settings: {
        attele: {
            vincennes_ferrage_malus: 20,
            reg_bonus: 10,
            desc_bonus: 15,
            crack_price_threshold: 40000
        },
        plat: {
            elite_gains_threshold: 200000,
            corde_bonus: 10,
            hippo_bonus: 5
        },
        monte: {
            top_jockeys: ['MOTTIER', 'RAFFIN', 'ABRIVARD', 'LAGADEUC', 'ROCHARD'],
            win_bonus: 15,
            age_bonus: 10
        },
        obstacle: {
            fall_malus: 15,
            freshness_bonus: 15,
            specialty_bonus: 10,
            inexperience_malus: 20
        },
        common: {
            shield_malus_max: 25,
            shield_malus_med: 15,
            shield_malus_min: 10,
            red_flag_malus: 20
        },
        finance: {
            kelly_fraction: 0.25,
            max_bet_percent: 0.05,
            min_edge_threshold: 0.05,
            bankroll_default: 1000
        },
        monitoring: {
            alert_drawdown_critical: 0.20,
            alert_drawdown_warning: 0.15,
            alert_lose_streak_critical: 5,
            alert_momentum_ultra: 80,
            alert_sharpe_min: -0.5
        },
        value_hunter: {
            target_disciplines: ['TROT', 'ATTELE', 'MONTE'],
            min_edge_value: 0.05
        },
        patterns: {
            min_significance_count: 3,
            golden_roi_threshold: 20,
            golden_winrate_threshold: 40,
            golden_count_threshold: 5,
            danger_roi_threshold: -10,
            smart_money_threshold: -20,
            abandonment_threshold: 30
        },
        tracking: {
            refresh_interval_ms: 300000, // 5 minutes
            start_window_minutes: 60      // Tracker commence 60 min avant le départ
        }
    }
};

export default CONFIG;