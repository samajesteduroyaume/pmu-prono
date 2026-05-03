// src/core/signal_gate.mjs
// ARCHITECT v43 — Signal Gate : Système de Confirmation Multi-Signal

import CONFIG from '../config/settings.mjs';
import { calculerRegularite } from '../utils/engine_utils.mjs';

const VH_CONFIG = CONFIG.engine_settings.value_hunter;

/**
 * SIGNAL GATE v43
 * Un cheval n'est recommandé QUE si un minimum de signaux positifs sont réunis.
 * Anti-faux-positifs : évite de jouer un cheval juste parce qu'il a un bon driver
 * ou une belle côte sans convergence des indicateurs.
 *
 * Signaux évalués (chacun vaut 1 point) :
 * 1. Score IA ≥ 65 (confiance algorithmique)
 * 2. Marché confirme : cote entre 2.5 et 12 (éviter les extrêmes)
 * 3. Aucune alerte d'incohérence (is_inconsistent !== true)
 * 4. Régularité ≥ 40% (cheval constant)
 * 5. Entourage Top (driver OU entraîneur Elite) OU synergie détectée
 *
 * @param {object} participant - Le participant enrichi (avec score, edge_stat, etc.)
 * @param {object} contexte - Contexte de la course
 * @returns {{go: boolean, score: number, signals: object, recommendation: string}}
 */
export function evaluerSignalGate(participant, contexte, predictionScore) {
    const signals = {
        ia_confidence: false,
        market_range: false,
        no_inconsistency: false,
        regularite: false,
        entourage: false,
        momentum: false
    };

    // Signal 1 — Score IA ≥ 65
    if (predictionScore >= 65) {
        signals.ia_confidence = true;
    }

    // Signal 2 — Cote dans la zone de valeur
    const cote = parseFloat(participant.cote_ref);
    if (!isNaN(cote) && cote >= VH_CONFIG.min_cote && cote <= VH_CONFIG.max_cote) {
        signals.market_range = true;
    }

    // Signal 3 — Pas d'alerte d'incohérence
    if (!participant.is_inconsistent) {
        signals.no_inconsistency = true;
    }

    // Signal 4 — Régularité ≥ 40%
    const reg = calculerRegularite(participant);
    if (reg >= 40) {
        signals.regularite = true;
    }

    // Signal 5 — Entourage elite ou synergie
    const topDrivers = CONFIG.experts.drivers;
    const topTrainers = CONFIG.experts.trainers;
    const driverName = (participant.driver || '').toUpperCase();
    const trainerName = (participant.entraineur || '').toUpperCase();
    const isTopDriver = topDrivers.some(d => driverName.includes(d));
    const isTopTrainer = topTrainers.some(t => trainerName.includes(t));
    if (isTopDriver || isTopTrainer || participant.has_synergy) {
        signals.entourage = true;
    }

    // Signal 6 — Momentum (v43.1 : Victoire ou Place très récente)
    const musique = (participant.musique || '').trim();
    if (musique.startsWith('1') || musique.startsWith('2')) {
        signals.momentum = true;
    }

    // Calcul du score total de confirmation
    const signalCount = Object.values(signals).filter(Boolean).length;
    const minRequired = VH_CONFIG.min_signals || 3;
    const go = signalCount >= minRequired;

    // Recommandation lisible (Adaptée pour 6 signaux)
    let recommendation;
    if (signalCount >= 6) recommendation = '💎 PÉPITE RARE';
    else if (signalCount >= 5) recommendation = '🔥 ULTRA-CONFIANCE';
    else if (signalCount >= 4) recommendation = '✅ JOUER';
    else if (signalCount >= 3) recommendation = '✅ JOUER (prudence)';
    else if (signalCount === 2) recommendation = '⚠️ ATTENDRE';
    else recommendation = '❌ PASSER';

    return {
        go,
        score: signalCount,
        signals,
        recommendation
    };
}

/**
 * Filtre une liste de prédictions en ne gardant que celles passant le Signal Gate.
 * @param {Array} predictions - Liste de {participant, score, ...}
 * @param {object} contexte - Contexte de course
 * @returns {Array} Liste filtrée et enrichie avec les données Signal Gate
 */
export function filtrerParSignalGate(predictions, contexte) {
    return predictions
        .map(pred => {
            const gate = evaluerSignalGate(pred, contexte, pred.score);
            return { ...pred, signal_gate: gate };
        })
        .filter(pred => pred.signal_gate.go);
}
