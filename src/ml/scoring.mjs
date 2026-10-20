/** Convert the balanced classifier output to the production 0–100 ranking scale. */
export function mlProbabilityToPoints(modelOutput, populationPrior) {
    if (!Number.isFinite(modelOutput) || modelOutput < 0 || modelOutput > 1
        || !Number.isFinite(populationPrior) || populationPrior <= 0 || populationPrior >= 1) return null;

    const sampledPrior = 0.5;
    const adjustedPositive = modelOutput * populationPrior / sampledPrior;
    const adjustedNegative = (1 - modelOutput) * (1 - populationPrior) / (1 - sampledPrior);
    const denominator = adjustedPositive + adjustedNegative;
    if (!Number.isFinite(denominator) || denominator <= 0) return null;
    const adjusted = adjustedPositive / denominator;
    if (!Number.isFinite(adjusted)) return null;

    let points;
    if (adjusted >= 0.45) points = 90 + ((adjusted - 0.45) / 0.55) * 10;
    else if (adjusted >= 0.35) points = 80 + ((adjusted - 0.35) / 0.10) * 10;
    else if (adjusted >= 0.25) points = 70 + ((adjusted - 0.25) / 0.10) * 10;
    else if (adjusted >= 0.15) points = 55 + ((adjusted - 0.15) / 0.10) * 15;
    else if (adjusted >= 0.08) points = 35 + ((adjusted - 0.08) / 0.07) * 20;
    else points = (adjusted / 0.08) * 35;
    return Math.max(0, Math.min(100, Math.round(points)));
}

export function combineHybridScores(mlPoints, heuristicPoints, { mlWeight, heuristicWeight }) {
    if (![mlPoints, heuristicPoints, mlWeight, heuristicWeight].every(Number.isFinite)
        || mlPoints < 0 || mlPoints > 100 || heuristicPoints < 0 || heuristicPoints > 100
        || mlWeight < 0 || heuristicWeight < 0 || mlWeight + heuristicWeight <= 0) return null;
    return Math.max(0, Math.min(100, Math.round(mlPoints * mlWeight + heuristicPoints * heuristicWeight)));
}
