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
 * CALIBRATION DES PROBABILITÉS IA (v43.3 — Basée sur win rates réels)
 * Basée sur la table de calibration centralisée dans CONFIG.calibration.
 * Alignée sur le win rate réel observé en backtest (39% global, 25% value hunter).
 * Le score IA représente toujours LE meilleur cheval sélectionné dans une course.
 * Ces probabilités sont utilisées pour calculer l'Edge vs le marché (cote).
 */
export function calibrateProbability(score) {
    const table = CONFIG.calibration; // v48: Interpolation linéaire pour éviter les effets de seuil
    
    if (score >= table[0].minScore) return table[0].prob;
    
    for (let i = 0; i < table.length - 1; i++) {
        const upper = table[i];
        const lower = table[i + 1];
        
        if (score >= lower.minScore && score <= upper.minScore) {
            const range = upper.minScore - lower.minScore;
            if (range === 0) return upper.prob;
            const factor = (score - lower.minScore) / range;
            return lower.prob + factor * (upper.prob - lower.prob);
        }
    }
    return table[table.length - 1].prob;
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

    // 3. Filtrage "Value Bet" (Espérance positive & Edge)
    // Si f <= 0, l'espérance est négative => Ne pas parier
    if (f <= 0) return { mise: 0, advice: 'NO VALUE', explanation: 'Espérance mathématique négative' };

    // Filtrage strict par Edge (Value Hunter)
    const marketProb = 1 / cote;
    const edge = p - marketProb;
    if (edge < MIN_EDGE_THRESHOLD) {
        return { mise: 0, advice: 'NO VALUE', explanation: `Edge insuffisant (${(edge * 100).toFixed(1)}% < ${MIN_EDGE_THRESHOLD * 100}%)` };
    }

    // 4. Sécurisation (Kelly Fractionné) & Plafond
    let fractionReelle = f * KELLY_FRACTION;

    // Plafond de sécurité (Max 5% de la bankroll)
    if (fractionReelle > MAX_BET_PERCENT) fractionReelle = MAX_BET_PERCENT;

    // 5. Calcul Mise Euro
    let miseConseillee = Math.floor(currentBankroll * fractionReelle);
    if (miseConseillee < 1 && fractionReelle > 0) miseConseillee = 1; // v48: Plancher 1€ pour les petites bankrolls

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
 */
export async function calculateKellyAdaptatif(participantOrCote, winProbPercent, currentBankroll = 'shadow', tendances = null, currentPatterns = []) {
    let cote = 0;
    let participant = null;
    
    if (typeof participantOrCote === 'number') {
        cote = participantOrCote;
    } else if (participantOrCote) {
        cote = parseFloat(participantOrCote.cote_ref || participantOrCote.fav_cote || 0);
        participant = participantOrCote;
    }

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

    // --- V45.1 : BOUCLIER ANTI-PIÈGES ---
    if (participant && participant.is_trap) {
        return { mise: 0, advice: 'TRAP DETECTED', explanation: 'Faux favori détecté. Capital protégé.' };
    }

    const b = cote - 1;
    const p = calibrateProbability(winProbPercent);
    const q = 1 - p;

    let f = ((b * p) - q) / b;

    if (f <= 0) return { mise: 0, advice: 'NO VALUE', explanation: 'Cote trop faible pour le risque' };

    // ADAPTATION SELON TENDANCES
    let fractionAdaptee = KELLY_FRACTION;
    let adjustments = [];

    // --- V45.1 : RADARS D'OPPORTUNITÉS ---
    if (participant) {
        if (participant.is_smart_money_alert) {
            fractionAdaptee *= 1.25;
            adjustments.push('Smart Money Velocity (+25%)');
        }
        if (participant.is_swimmer) {
            fractionAdaptee *= 1.15;
            adjustments.push('Spécialiste Terrain (+15%)');
        }
        if (participant.is_bad_draw) {
            fractionAdaptee *= 0.5;
            adjustments.push('Mauvais Tirage Balistique (-50%)');
        }
    }

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
        currentPatterns.forEach(pat => {
            if (pat.type === 'GOLDEN_PATTERN') {
                let bonus = 1 + (pat.roi / 200); // Base: 1.1 si ROI 20%
                if (pat.roi > 30) bonus *= 1.25; // Booster v43.1 pour les patterns très rentables
                fractionAdaptee *= bonus;
                adjustments.push(`Golden Pattern: ${pat.pattern} (+${Math.round((bonus - 1) * 100)}%)`);
            } else if (pat.type === 'DANGER_PATTERN') {
                const malus = 0.5; // Réduire de moitié par défaut pour un pattern dangereux
                fractionAdaptee *= malus;
                adjustments.push(`Danger Pattern: ${pat.pattern} (-50%)`);
            }
        });
    }

    // 7. FILTRAGE PAR EDGE (V40 / V43.3)
    const marketProb = 1 / cote;
    const edge = p - marketProb;
    
    if (edge < MIN_EDGE_THRESHOLD) {
        return { mise: 0, advice: 'NO VALUE', explanation: `Edge insuffisant (${(edge * 100).toFixed(1)}% < ${MIN_EDGE_THRESHOLD * 100}%)` };
    }

    // Appliquer la fraction adaptée
    let fractionReelleFinal = f * fractionAdaptee;

    // Plancher de sécurité
    if (fractionReelleFinal > MAX_BET_PERCENT) fractionReelleFinal = MAX_BET_PERCENT;

    // Plancher minimum (ne pas descendre en dessous de 0.5% si avantage détecté)
    if (fractionReelleFinal < 0.005) fractionReelleFinal = 0.005;

    let miseConseillee = Math.floor(bankrollValue * fractionReelleFinal);
    if (miseConseillee < 1 && fractionReelleFinal > 0) miseConseillee = 1; // v48: Plancher 1€

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

