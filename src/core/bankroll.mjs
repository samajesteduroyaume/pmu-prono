/**
 * Module de Bankroll Management
 * Implémente le Kelly Criterion pour optimiser les mises
 */

/**
 * Calcule la mise optimale selon le Kelly Criterion
 * @param {number} cote - Cote du cheval (ex: 3.5)
 * @param {number} probaIA - Probabilité estimée par l'IA (0-1)
 * @param {number} bankroll - Capital disponible
 * @param {number} kellyFraction - Fraction du Kelly à utiliser (0.25 = conservateur)
 * @returns {object} Détails de la mise recommandée
 */
export function calculerMiseOptimale(cote, probaIA, bankroll, kellyFraction = 0.25) {
    // Conversion du score IA (0-100) en probabilité (0-1)
    const proba = probaIA > 1 ? probaIA / 100 : probaIA;

    // Edge = avantage du parieur
    // Edge = (cote × probabilité) - 1
    const edge = (cote * proba) - 1;

    // Si pas d'avantage, ne pas parier
    if (edge <= 0) {
        return {
            mise: 0,
            edge: edge,
            roi_attendu: 0,
            recommandation: 'SKIP',
            raison: 'Pas d\'avantage statistique'
        };
    }

    // Kelly Fraction = edge / (cote - 1)
    const kellyFull = edge / (cote - 1);

    // Kelly conservateur (25% du Kelly complet pour réduire la variance)
    const kellyConservateur = kellyFull * kellyFraction;

    // Mise brute
    let mise = bankroll * kellyConservateur;

    // Limites de sécurité
    const MISE_MIN = 2; // 2€ minimum
    const MISE_MAX_PERCENT = 0.05; // Max 5% du capital
    const MISE_MAX = bankroll * MISE_MAX_PERCENT;

    // Application des limites
    if (mise < MISE_MIN) {
        return {
            mise: 0,
            edge: edge,
            roi_attendu: edge * 100,
            recommandation: 'SKIP',
            raison: 'Mise calculée trop faible'
        };
    }

    mise = Math.min(mise, MISE_MAX);

    // ROI attendu = edge × 100
    const roiAttendu = edge * 100;

    // Gain potentiel
    const gainPotentiel = mise * (cote - 1);

    // Recommandation
    let recommandation = 'STANDARD';
    if (edge > 0.5) recommandation = 'FORTE';
    if (edge > 1) recommandation = 'TRÈS FORTE';

    return {
        mise: Math.round(mise * 100) / 100,
        edge: Math.round(edge * 1000) / 1000,
        roi_attendu: Math.round(roiAttendu * 100) / 100,
        gain_potentiel: Math.round(gainPotentiel * 100) / 100,
        kelly_fraction: kellyFraction,
        recommandation,
        raison: `Edge de ${(edge * 100).toFixed(1)}%`
    };
}

/**
 * Calcule le bankroll optimal après une série de paris
 * @param {number} bankrollInitial
 * @param {array} resultats - [{mise, cote, gagne: boolean}]
 * @returns {object} Évolution du capital
 */
export function simulerEvolutionBankroll(bankrollInitial, resultats) {
    let capital = bankrollInitial;
    const evolution = [capital];

    for (const resultat of resultats) {
        if (resultat.gagne) {
            capital += resultat.mise * (resultat.cote - 1);
        } else {
            capital -= resultat.mise;
        }
        evolution.push(capital);
    }

    const gainTotal = capital - bankrollInitial;
    const roiReel = (gainTotal / bankrollInitial) * 100;

    return {
        capital_final: Math.round(capital * 100) / 100,
        gain_total: Math.round(gainTotal * 100) / 100,
        roi_reel: Math.round(roiReel * 100) / 100,
        evolution
    };
}

/**
 * Analyse de risque d'une mise
 * @param {number} mise
 * @param {number} bankroll
 * @returns {string} Niveau de risque
 */
export function analyserRisque(mise, bankroll) {
    const ratio = mise / bankroll;

    if (ratio < 0.01) return 'TRÈS FAIBLE';
    if (ratio < 0.02) return 'FAIBLE';
    if (ratio < 0.05) return 'MODÉRÉ';
    if (ratio < 0.10) return 'ÉLEVÉ';
    return 'TRÈS ÉLEVÉ';
}

/**
 * Exemple d'utilisation
 */
export function exempleUtilisation() {
    const bankroll = 1000; // 1000€ de capital
    const cote = 4.5;
    const scoreIA = 85; // Score IA de 85/100

    const recommandation = calculerMiseOptimale(cote, scoreIA, bankroll);

    console.log('=== BANKROLL MANAGEMENT ===');
    console.log(`Capital: ${bankroll}€`);
    console.log(`Cote: ${cote}`);
    console.log(`Score IA: ${scoreIA}/100`);
    console.log(`\nRecommandation: ${recommandation.recommandation}`);
    console.log(`Mise optimale: ${recommandation.mise}€`);
    console.log(`Edge: ${(recommandation.edge * 100).toFixed(2)}%`);
    console.log(`ROI attendu: ${recommandation.roi_attendu.toFixed(2)}%`);
    console.log(`Gain potentiel: ${recommandation.gain_potentiel}€`);
    console.log(`Risque: ${analyserRisque(recommandation.mise, bankroll)}`);
}

// Test si exécuté directement
if (import.meta.url === `file://${process.argv[1]}`) {
    exempleUtilisation();
}
