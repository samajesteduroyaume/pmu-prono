// src/config/settings.mjs
export const CONFIG = {
    // Profils d'experts (Drivers & Entraîneurs)
    experts: {
        drivers: ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'BARZALONA', 'SOUMILLON', 'GUYON', 'PASQUIER', 'DEMURO', 'MOUROT', 'MOTTIER', 'GELORMINI', 'LAGADEUC'],
        trainers: ['DUVALDESTIN', 'BAZIRE', 'GUARATO', 'ABRIVARD', 'ALLAIRE', 'LEVESQUE', 'SOULOY', 'ROUGET', 'FABRE', 'PANTALL']
    },

    // Calibration empirique des probabilités (v43) — Alignée sur win rate réel (30.77%)
    // Scores IA → probabilités de victoire observées en backtest
    calibration: [
        // Calibration v43.3 : alignée sur les win rates réels observés en backtest
        // (Win Rate global 39%, mode Value Hunter ~25%)
        // Un score IA représente TOUJOURS le meilleur cheval sélectionné dans la course.
        { minScore: 95, prob: 0.40 }, // Top pick très fort → ~40% win rate réel
        { minScore: 90, prob: 0.35 }, // Excellente sélection → ~35%
        { minScore: 80, prob: 0.28 }, // Bonne sélection → ~28%
        { minScore: 70, prob: 0.22 }, // Sélection correcte → ~22%
        { minScore: 60, prob: 0.15 }, // Sélection incertaine → ~15%
        { minScore: 50, prob: 0.09 }, // Faible conviction → ~9%
        { minScore: 0,  prob: 0.05 }  // Plancher de sécurité
    ],

    // Pondérations par défaut du moteur IA (Optimisées v43.2)
    weights: {
        // TROT : Alias vers ATTELE — ne pas dupliquer ici (fix v48.1: CONTRA1)
        // Utiliser CONFIG.weights.ATTELE pour toute discipline Trot/Attelé sans moteur spécifique
        PLAT: {
            FORME: 0.25,
            ENTOURAGE: 0.15,
            CONFIANCE: 0.05,
            CONFIGURATION: 0.15,
            APTITUDE: 0.25,
            EXPERT: 0.15
        },
        ATTELE: {
            FORME: 0.25,      // v48: Réduit (0.35 -> 0.25) pour rééquilibrer
            ENTOURAGE: 0.15,  // v48: Augmenté (0.05 -> 0.15) - Crucial en Attelé
            CONFIANCE: 0.15,
            CONFIGURATION: 0.2,
            APTITUDE: 0.2,
            EXPERT: 0.05
        },
        MONTE: {
            FORME: 0.2,
            ENTOURAGE: 0.2,
            CONFIANCE: 0.15,
            CONFIGURATION: 0.2,
            APTITUDE: 0.2,
            EXPERT: 0.05
        },
        OBSTACLE: {
            FORME: 0.25,
            ENTOURAGE: 0.4,
            CONFIANCE: 0.1,
            CONFIGURATION: 0.11,
            APTITUDE: 0.11,
            EXPERT: 0.03
        },
        HAIE: {
            FORME: 0.2,
            ENTOURAGE: 0.15,
            CONFIANCE: 0.15,
            CONFIGURATION: 0.2,
            APTITUDE: 0.25,
            EXPERT: 0.05
        },
        STEEPLECHASE: {
            FORME: 0.1,
            ENTOURAGE: 0.25,
            CONFIANCE: 0.05,
            CONFIGURATION: 0.27,
            APTITUDE: 0.27,
            EXPERT: 0.06
        },
        CROSS: {
            FORME: 0.05,
            ENTOURAGE: 0.05,
            CONFIANCE: 0.1,
            CONFIGURATION: 0.36,
            APTITUDE: 0.36,
            EXPERT: 0.08
        },
        // DEFAULT : Poids neutres équilibrés (fix v48.1: CONTRA2 — différencié d'OBSTACLE)
        // Utilisé pour les disciplines non reconnues. 6 critères à poids égaux (≈1/6).
        DEFAULT: {
            FORME: 0.17,
            ENTOURAGE: 0.17,
            CONFIANCE: 0.17,
            CONFIGURATION: 0.17,
            APTITUDE: 0.17,
            EXPERT: 0.15
        }
    },

    // Paramètres de base de données
    database: {
        path: process.env.DB_PATH || './data/pmu.db',
        backupPath: './data/backup/'
    },
    
    // Paramètres de filtrage
    filters: {
        disciplines: ['TROT', 'MONTE', 'ATTELE', 'PLAT', 'HAIE', 'STEEPLECHASE', 'CROSS'], // v43.3: Toutes disciplines
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
            decay: 0.75,           // v44: Dégressivité plus forte (0.8→0.75) : dernière perf compte encore plus
            recentWinBonus: 20     // v44: Bonus victoire récente renforcé (15→20)
        },
        hybride: {
            mlWeight: 0.5,         // v48: Réduit (0.7 -> 0.5) pour assainissement
            heuristicWeight: 0.5   // v48: Augmenté (0.3 -> 0.5)
        },
        malus: {
            rentreeLongue: 45,
            rentreeSaisonniere: 10,
            trotDA: 30             // v48: Réduit (50 -> 30) pour mieux pénaliser l'instabilité
        },
        // v44: Bonus winrate historique — meilleur discriminant observé
        winrate_histo: {
            enabled: true,
            excellent_threshold: 20,  // >=20% victoires → bonus fort
            bon_threshold: 13,        // >=13% → bonus modéré
            faible_threshold: 5,      // <=5% → malus
            excellent_bonus: 10,
            bon_bonus: 5,
            faible_malus: -8,
            min_courses: 5           // Minimum de courses pour être significatif
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
            elite_gains_threshold: 100000,
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
            red_flag_malus: 25,
            max_cumulative_bonus: 25,  // v48: Plafond global pour éviter l'inflation
            market: {
                smart_money_fav_threshold: 0.10, // 10% pour favoris
                smart_money_std_threshold: 0.20, // 20% standard
                momentum_malus_soft: 1.30,       // +30% cote
                momentum_malus_hard: 1.50        // +50% cote
            }
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
            target_disciplines: ['ATTELE', 'PLAT', 'HAIE', 'MONTE', 'STEEPLECHASE', 'CROSS'],
            min_edge_value: 0.05,          // v43.3: Aligné sur le MIN_EDGE_THRESHOLD de Kelly
            min_score: 70,                 // v43.3: Relevé pour plus de sécurité (65 → 70)
            min_cote: 2.5,                 // v43: Cote plancher
            max_cote: 15.0,                // v43.1: Élargi pour capturer les gros outsiders IA
            min_signals: 3,                // v43: Minimum de signaux positifs requis (Signal Gate)
            require_no_inconsistency: true // v43: Rejeter les chevaux inconsistants
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