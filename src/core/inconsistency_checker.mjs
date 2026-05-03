// src/core/inconsistency_checker.mjs
import logger from '../utils/logger.mjs';

/**
 * ARCHITECT v42 - INCONSISTENCY CHECKER
 * Système expert de détection d'anomalies et de "pièges" PMU
 */

export function detectInconsistencies(participant, contexte, baseScores, finalScore) {
    const alerts = [];
    const disc = (contexte.discipline || '').toUpperCase();
    const isTrot = disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE');
    
    // 1. ANOMALIE : DÉFERRAGE SANS FORME (LE "FAUX DÉPART")
    // Un cheval D4 (tous pieds nus) est censé être prêt, mais si sa forme est < 30, 
    // c'est souvent un signe d'incohérence ou de bluff.
    const ferrage = (participant.ferrage || '').toUpperCase();
    if (isTrot && ferrage === 'D4' && baseScores.forme < 30 && finalScore > 60) {
        alerts.push({
            type: 'FAKE_INTENT',
            severity: 'HIGH',
            message: `D4 détecté pour ${participant.nom} mais forme critique (${baseScores.forme}). Risque de contre-performance.`
        });
    }

    // 2. ANOMALIE : MONTEE DE CATÉGORIE BRUTALE
    // Le score IA peut être haut à cause du driver, mais la marche est peut-être trop haute.
    const prix = contexte.prixCourse || 20000;
    const gains = parseFloat(participant.gains) || 0;
    const nbCourses = Math.max(1, participant.nb_courses || 5);
    const gainMoyen = gains / nbCourses;
    
    if (gainMoyen < (prix / 10) && finalScore > 75) {
        alerts.push({
            type: 'CATEGORY_GAP',
            severity: 'MEDIUM',
            message: 'Écart de catégorie massif. Le score IA semble surestimé par rapport au niveau réel.'
        });
    }

    // 3. ANOMALIE : SPÉCIALISTE HORS-ZONE
    // Un cheval qui performe en Attelé mais qui n'a aucune référence en Monté (ou vice versa).
    const musique = participant.musique || '';
    if (disc.includes('MONTE') && !musique.includes('m') && finalScore > 70) {
        alerts.push({
            type: 'DISCIPLINE_VIRGIN',
            severity: 'HIGH',
            message: 'Zéro référence en Monté pour un favori IA. Incohérence majeure.'
        });
    }

    // 4. ANOMALIE : COTE ILLOGIQUE (LE "SMART MONEY" INVERSE)
    // IA donne un score énorme mais la cote est délaissée (> 40).
    const cote = parseFloat(participant.cote_ref);
    if (cote > 40 && finalScore > 80) {
        alerts.push({
            type: 'NEGLECTED_POWER',
            severity: 'MEDIUM',
            message: 'Cote abandonnée par le marché malgré un score IA d\'élite. Suspicion d\'info manquante.'
        });
    }

    // 5. ANOMALIE : RENTRÉE ANNUELLE SUR-PONDÉRÉE
    const trimmedMusique = musique.trim();
    if (trimmedMusique.startsWith('(')) {
        const firstYearMatch = trimmedMusique.match(/^\((\d+)\)/);
        if (firstYearMatch) {
            const currentYear = new Date().getFullYear() % 100;
            const lastYear = parseInt(firstYearMatch[1]);
            if (currentYear !== lastYear && lastYear !== (currentYear - 1) && finalScore > 65) {
                alerts.push({
                    type: 'LONG_REST_BIAS',
                    severity: 'HIGH',
                    message: 'Rentrée de plus d\'un an. Le score IA ne reflète pas l\'incertitude physique.'
                });
            }
        }
    }

    if (alerts.length > 0) {
        logger.info(`[INCONSISTENCY] ${alerts.length} anomalie(s) détectée(s) pour ${participant.nom}`);
    }

    return alerts;
}

/**
 * Applique une correction dynamique au score final basée sur les incohérences
 */
export function applyCorrection(score, alerts) {
    let correctedScore = score;
    
    alerts.forEach(alert => {
        if (alert.severity === 'HIGH') correctedScore -= 25; // v43.2: Pénalité augmentée pour plus de réalisme
        if (alert.severity === 'MEDIUM') correctedScore -= 15; // v43.2: Pénalité augmentée pour plus de réalisme
    });

    return Math.round(Math.max(0, Math.min(100, correctedScore)));
}
