/**
 * OPTIMISATION FINANCIERE - CRITERE DE KELLY
 * 
 * Formule : f* = (bp - q) / b
 * f* : Fraction de bankroll à miser
 * b : Cote nette (Cote - 1)
 * p : estimation issue des favoris IA observés avant course
 * q : Probabilité de défaite (1 - p)
 */

import { getBankroll } from './db.mjs';
import { getDB } from '../db/db.mjs';
import CONFIG from '../config/settings.mjs';

const FINANCE = CONFIG.engine_settings.finance;

const BANKROLL_DEFAULT = FINANCE.bankroll_default;
const KELLY_FRACTION = FINANCE.kelly_fraction;
const MAX_BET_PERCENT = FINANCE.max_bet_percent;
const MIN_EDGE_THRESHOLD = FINANCE.min_edge_threshold;
const CALIBRATION_MIN_TOTAL = 100;
const CALIBRATION_MIN_BAND = 30;
const CALIBRATION_TTL_MS = 5 * 60 * 1000;
const SCORE_BANDS = [
    { label: '95+', min: 95, max: Infinity },
    { label: '90–94', min: 90, max: 95 },
    { label: '80–89', min: 80, max: 90 },
    { label: '70–79', min: 70, max: 80 },
    { label: '60–69', min: 60, max: 70 },
    { label: '50–59', min: 50, max: 60 },
    { label: '0–49', min: 0, max: 50 }
];
let prospectiveCalibration = null;

function wilsonLowerBound(wins, total) {
    if (!total) return 0;
    const z = 1.96;
    const p = wins / total;
    const denominator = 1 + z * z / total;
    const center = p + z * z / (2 * total);
    const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
    return Math.max(0, (center - margin) / denominator);
}

export async function refreshProspectiveCalibration(modelVersion = 'heuristic-fallback') {
    const now = Date.now();
    if (prospectiveCalibration?.modelVersion === modelVersion && now - prospectiveCalibration.updatedAt < CALIBRATION_TTL_MS) {
        return prospectiveCalibration;
    }
    const db = getDB();
    const rows = await new Promise((resolve, reject) => db.all(`
        SELECT prediction_score, outcome_rank
        FROM prediction_snapshots
        WHERE model_version = ? AND prediction_rank = 1
          AND settled_at IS NOT NULL AND outcome_rank IS NOT NULL
    `, [modelVersion], (error, result) => error ? reject(error) : resolve(result || [])));
    const bins = SCORE_BANDS.map(band => {
        const matches = rows.filter(row => Number(row.prediction_score) >= band.min && Number(row.prediction_score) < band.max);
        const wins = matches.filter(row => Number(row.outcome_rank) === 1).length;
        return {
            ...band,
            samples: matches.length,
            wins,
            probability: rows.length >= CALIBRATION_MIN_TOTAL && matches.length >= CALIBRATION_MIN_BAND
                ? wilsonLowerBound(wins, matches.length)
                : null
        };
    });
    prospectiveCalibration = { modelVersion, samples: rows.length, bins, updatedAt: now };
    return prospectiveCalibration;
}

/**
 * Calibration conservatrice sur les seuls favoris IA capturés avant course,
 * réglés officiellement et produits par la même version du modèle.
 * Retourne null tant que l'échantillon n'est pas suffisant.
 */
export function calibrateProbability(score) {
    const value = Number(score);
    if (!prospectiveCalibration || !Number.isFinite(value)) return null;
    const band = prospectiveCalibration.bins.find(item => value >= item.min && value < item.max);
    return band?.probability ?? null;
}


export function calculateKellyMise(cote, predictionScore, currentBankroll = BANKROLL_DEFAULT) {
    const odds = Number(cote);
    const bankroll = Number(currentBankroll);
    if (!Number.isFinite(odds) || odds <= 1) return { mise: 0, advice: 'COTE INVALIDE' };
    if (!Number.isFinite(bankroll) || bankroll < 1) return { mise: 0, advice: 'BANKROLL INSUFFISANTE' };

    // 1. Calcul des variables avec Calibration
    const b = odds - 1; // Cote nette
    const p = calibrateProbability(predictionScore);
    if (p === null) return { mise: 0, advice: 'CALIBRATION INSUFFISANTE', explanation: 'Pas encore assez de pronostics pré-course réglés pour estimer une probabilité fiable.' };
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
    const fractionReelle = Math.min(f * KELLY_FRACTION, MAX_BET_PERCENT);

    // 5. Calcul Mise Euro
    const miseConseillee = Math.floor(bankroll * fractionReelle);
    if (miseConseillee < 1) return { mise: 0, advice: 'MISE INFERIEURE AU MINIMUM', bankroll };

    return {
        mise: miseConseillee,
        percentage: (fractionReelle * 100).toFixed(2),
        advice: 'BET',
        bankroll,
        espérance: ((p * (odds - 1)) - q).toFixed(2) // Gain espéré par euro misé
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
export async function calculateKellyAdaptatif(participantOrCote, predictionScore, currentBankroll = 'shadow', tendances = null, currentPatterns = []) {
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
    if (!Number.isFinite(bankrollValue) || bankrollValue < 1) {
        return { mise: 0, advice: 'BANKROLL INSUFFISANTE' };
    }

    // Si pas de tendances, utiliser Kelly classique
    if (!tendances) {
        return calculateKellyMise(cote, predictionScore, bankrollValue);
    }

    if (!Number.isFinite(cote) || cote <= 1) return { mise: 0, advice: 'COTE INVALIDE' };

    // --- V45.1 : BOUCLIER ANTI-PIÈGES ---
    if (participant && participant.is_trap) {
        return { mise: 0, advice: 'TRAP DETECTED', explanation: 'Faux favori détecté. Capital protégé.' };
    }

    const b = cote - 1;
    const p = calibrateProbability(predictionScore);
    if (p === null) return { mise: 0, advice: 'CALIBRATION INSUFFISANTE', explanation: 'Pas encore assez de pronostics pré-course réglés pour estimer une probabilité fiable.' };
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
    const fractionReelleFinal = Math.min(f * fractionAdaptee, MAX_BET_PERCENT);
    if (!Number.isFinite(fractionReelleFinal) || fractionReelleFinal <= 0) {
        return { mise: 0, advice: 'MISE INFERIEURE AU MINIMUM' };
    }
    const miseConseillee = Math.floor(bankrollValue * fractionReelleFinal);
    if (miseConseillee < 1) return { mise: 0, advice: 'MISE INFERIEURE AU MINIMUM', bankroll: bankrollValue };

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

