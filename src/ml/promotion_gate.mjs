export const MIN_PROMOTION_TEST_COURSES = 100;

/**
 * A candidate model can replace the deployed model only when its chronological
 * holdout contains enough common races and it beats both operational baselines.
 */
export function evaluateModelPromotion({
    matchedCourses,
    mlHitRate,
    heuristicHitRate,
    marketHitRate
}) {
    if (!Number.isInteger(matchedCourses) || matchedCourses < MIN_PROMOTION_TEST_COURSES) {
        return {
            promote: false,
            reason: `Échantillon de test trop petit (${Number(matchedCourses) || 0}/${MIN_PROMOTION_TEST_COURSES} courses comparables).`
        };
    }

    const rates = [mlHitRate, heuristicHitRate, marketHitRate];
    if (!rates.every(rate => Number.isFinite(rate) && rate >= 0 && rate <= 1)) {
        return { promote: false, reason: 'Métriques de comparaison absentes ou invalides.' };
    }

    if (!(mlHitRate > heuristicHitRate && mlHitRate > marketHitRate)) {
        return {
            promote: false,
            reason: 'Le Top 1 ML ne dépasse pas à la fois le pronostic heuristique archivé et le favori du marché sur les mêmes courses.'
        };
    }

    return { promote: true, reason: 'Le Top 1 ML dépasse les deux références sur le test chronologique commun.' };
}
