/**
 * GESTION DE BANKROLL & KELLY CRITERION v1.0
 */

export const DEFAULT_BANKROLL = 1000; // Capital de départ par défaut

/**
 * Calcule la mise suggérée selon le Critère de Kelly
 * Formule : f* = (p*b - q) / b
 * p = probabilité de gagner (Score IA)
 * q = probabilité de perdre (1 - p)
 * b = cote brute - 1
 */
export function calculerMiseKelly(scoreIA, cote, bankroll = DEFAULT_BANKROLL, fractional = 0.25) {
    if (!cote || cote <= 1) return 0;

    const p = scoreIA / 100;
    const q = 1 - p;
    const b = cote - 1;

    // Formule de Kelly
    let f = (p * b - q) / b;

    // Si l'avantage est négatif, on ne parie pas
    if (f <= 0) return 0;

    // Kelly Fractionnaire (plus prudent)
    f = f * fractional;

    // Mise finale
    const mise = bankroll * f;

    return {
        mise: parseFloat(mise.toFixed(2)),
        percentage: parseFloat((f * 100).toFixed(2)),
        advantage: parseFloat(((p * b - q) * 100).toFixed(2)) // "L'avantage" ou la Value du pari
    };
}

/**
 * Kelly Dynamique avec GAP de confiance
 * Prend en compte l'écart entre la probabilité IA et la probabilité du marché
 */
export function calculerMiseDynamique(scoreIA, cote, bankroll = DEFAULT_BANKROLL) {
    const marketProb = (1 / cote) * 100;
    const gap = scoreIA - marketProb;

    // Si l'IA est moins confiante que le marché, on s'abstient
    if (gap <= 0) return { mise: 0, gap: gap.toFixed(1), advice: 'AUCUNE VALUE' };

    // Appliquer Kelly
    const kelly = calculerMiseKelly(scoreIA, cote, bankroll);

    let advice = 'PRUDENCE';
    if (gap > 20) advice = 'CONFIANCE FORTE (VALUE)';
    else if (gap > 10) advice = 'CONFIANCE MOYENNE';

    return {
        ...kelly,
        gap: gap.toFixed(1),
        advice: advice
    };
}
