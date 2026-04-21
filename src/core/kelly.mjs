/**
 * OPTIMISATION FINANCIERE - CRITERE DE KELLY
 * 
 * Formule : f* = (bp - q) / b
 * f* : Fraction de bankroll à miser
 * b : Cote nette (Cote - 1)
 * p : Probabilité de victoire (Score IA / 100)
 * q : Probabilité de défaite (1 - p)
 */

import { getBankroll } from './db.mjs';
import CONFIG from '../config/settings.mjs';

const FINANCE = CONFIG.engine_settings.finance;

const BANKROLL_DEFAULT = FINANCE.bankroll_default;
const KELLY_FRACTION = FINANCE.kelly_fraction;
const MAX_BET_PERCENT = FINANCE.max_bet_percent;
const MIN_EDGE_THRESHOLD = FINANCE.min_edge_threshold;

/**
 * CALIBRATION DES PROBABILITÉS IA (v43 — Empirique)
 * Basée sur la table de calibration centralisée dans CONFIG.calibration.
 * Alignée sur le win rate réel observé en backtest (30.77%).
 * L'ancienne version sous-estimait systématiquement les hauts scores,
 * rendant Kelly quasi-nul et bloquant toute prise de position.
 */
export function calibrateProbability(score) {
    const table = CONFIG.calibration;
    for (const entry of table) {
        if (score >= entry.minScore) return entry.prob;
    }
    return 0.05; // Plancher de sécurité
}


export function calculateKellyMise(cote, winProbPercent, currentBankroll = BANKROLL_DEFAULT) {
    if (!cote || cote <= 1) return { mise: 0, advice: 'COTE INVALIDE' };

    // 1. Calcul des variables avec Calibration
    const b = cote - 1; // Cote nette
    const p = calibrateProbability(winProbPercent); // Proba calibrée (v40)
    const q = 1 - p; // Proba défaite

    // 2. Formule de Kelly
    // f = (bp - q) / b
    let f = ((b * p) - q) / b;

    // 3. Filtrage "Value Bet" (Espérance positive)
    // Si f <= 0, ça veut dire que l'espérance est négative => Ne pas parier
    if (f <= 0) return { mise: 0, advice: 'NO VALUE', explanation: 'Cote trop faible pour le risque' };

    // 4. Sécurisation (Kelly Fractionné) & Plafond
    let fractionReelle = f * KELLY_FRACTION;

    // Plafond de sécurité (Max 5% de la bankroll)
    if (fractionReelle > MAX_BET_PERCENT) fractionReelle = MAX_BET_PERCENT;

    // 5. Calcul Mise Euro
    const miseConseillee = Math.floor(currentBankroll * fractionReelle);

    return {
        mise: miseConseillee,
        percentage: (fractionReelle * 100).toFixed(2),
        advice: 'BET',
        bankroll: currentBankroll,
        espérance: ((p * (cote - 1)) - q).toFixed(2) // Gain espéré par euro misé
    };
}

/**
 * V28: KELLY ADAPTATIF BASÉ SUR LES TENDANCES
 * Ajuste la fraction de Kelly selon:
 * - Momentum (augmente si momentum > 70, réduit si < 40)
 * - Drawdown (réduit drastiquement si drawdown > 15%)
 * - Séquence de défaites (réduit après 3+ défaites consécutives)
 * 
 * @param {number} cote - Cote du cheval
 * @param {number} winProbPercent - Probabilité de victoire (0-100)
 * @param {number} currentBankroll - Bankroll actuelle
 * @param {Object} tendances - Objet tendances depuis getTendancesCumulees()
 * @param {Array} currentPatterns - Liste des patterns actifs pour le contexte actuel
 * @returns {Object} Suggestion de mise adaptée
 */
export async function calculateKellyAdaptatif(cote, winProbPercent, currentBankroll = 'shadow', tendances = null, currentPatterns = []) {
    // Résoudre la Bankroll V42 si une clé de portfolio est fournie (au lieu d'un nombre)
    let bankrollValue = BANKROLL_DEFAULT;
    if (typeof currentBankroll === 'string') {
        try {
            bankrollValue = await getBankroll(currentBankroll);
        } catch (e) {
            bankrollValue = BANKROLL_DEFAULT;
        }
    } else if (typeof currentBankroll === 'number') {
        bankrollValue = currentBankroll;
    }

    // Si pas de tendances, utiliser Kelly classique
    if (!tendances) {
        return calculateKellyMise(cote, winProbPercent, bankrollValue);
    }

    if (!cote || cote <= 1) return { mise: 0, advice: 'COTE INVALIDE' };

    const b = cote - 1;
    const p = calibrateProbability(winProbPercent);
    const q = 1 - p;

    let f = ((b * p) - q) / b;

    if (f <= 0) return { mise: 0, advice: 'NO VALUE', explanation: 'Cote trop faible pour le risque' };

    // ADAPTATION SELON TENDANCES
    let fractionAdaptee = KELLY_FRACTION;
    let adjustments = [];

    // 1. MOMENTUM
    if (tendances.momentum >= 70) {
        fractionAdaptee *= 1.2; // Augmenter de 20% si momentum fort
        adjustments.push('Momentum élevé (+20%)');
    } else if (tendances.momentum < 40) {
        fractionAdaptee *= 0.7; // Réduire de 30% si momentum faible
        adjustments.push('Momentum faible (-30%)');
    }

    // 2. DRAWDOWN
    const drawdownPercent = tendances.drawdown.currentPercent;
    if (drawdownPercent > 0.15) {
        fractionAdaptee *= 0.5; // Réduire de 50% si drawdown > 15%
        adjustments.push('Drawdown élevé (-50%)');
    } else if (drawdownPercent > 0.10) {
        fractionAdaptee *= 0.75; // Réduire de 25% si drawdown > 10%
        adjustments.push('Drawdown modéré (-25%)');
    }

    // 3. SÉQUENCE DE DÉFAITES
    if (tendances.sequence.type === 'LOSE' && tendances.sequence.count >= 3) {
        fractionAdaptee *= 0.6; // Réduire de 40% après 3+ défaites
        adjustments.push(`${tendances.sequence.count} défaites consécutives (-40%)`);
    }

    // 4. SÉQUENCE DE VICTOIRES
    if (tendances.sequence.type === 'WIN' && tendances.sequence.count >= 3) {
        fractionAdaptee *= 1.1; // Augmenter légèrement de 10%
        adjustments.push(`${tendances.sequence.count} victoires consécutives (+10%)`);
    }

    // 5. TENDANCE GÉNÉRALE
    if (tendances.tendance.tendance === 'BAISSIERE') {
        fractionAdaptee *= 0.8; // Réduire de 20% si tendance baissière
        adjustments.push('Tendance baissière (-20%)');
    }

    // 6. PATTERNS OPTIMISÉS (V29)
    if (currentPatterns && currentPatterns.length > 0) {
        currentPatterns.forEach(p => {
            if (p.type === 'GOLDEN_PATTERN') {
                const bonus = 1 + (p.roi / 200); // 1.1 si ROI 20%, 1.2 si ROI 40%
                fractionAdaptee *= bonus;
                adjustments.push(`Golden Pattern: ${p.pattern} (+${Math.round((bonus - 1) * 100)}%)`);
            } else if (p.type === 'DANGER_PATTERN') {
                const malus = 0.5; // Réduire de moitié par défaut pour un pattern dangereux
                fractionAdaptee *= malus;
                adjustments.push(`Danger Pattern: ${p.pattern} (-50%)`);
            }
        });
    }

    // 7. FILTRAGE PAR EDGE (V40)
    const marketProb = 1 / cote;
    const edge = p - marketProb;
    
    if (edge < MIN_EDGE_THRESHOLD) {
        fractionAdaptee *= 0.5; // Réduire de moitié si l'edge est trop fin
        adjustments.push(`Edge faible (${(edge * 100).toFixed(1)}%) - Sécurité (-50%)`);
    }

    // Appliquer la fraction adaptée
    let fractionReelleFinal = f * fractionAdaptee;

    // Plafond de sécurité
    if (fractionReelleFinal > MAX_BET_PERCENT) fractionReelleFinal = MAX_BET_PERCENT;

    // Plancher minimum (ne pas descendre en dessous de 0.5%)
    if (fractionReelleFinal < 0.005) fractionReelleFinal = 0.005;

    const miseConseillee = Math.floor(bankrollValue * fractionReelleFinal);

    return {
        mise: miseConseillee,
        percentage: (fractionReelleFinal * 100).toFixed(2),
        advice: 'BET ADAPTATIF',
        bankroll: bankrollValue,
        espérance: ((p * (cote - 1)) - q).toFixed(2),
        adjustments: adjustments,
        kellyFraction: fractionAdaptee.toFixed(2)
    };
}

