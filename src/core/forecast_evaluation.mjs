import { getDB } from '../db/db.mjs';
import { ML_FEATURE_SCHEMA_VERSION } from '../ml/model_compatibility.mjs';

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});

const isSettledSnapshot = row => Boolean(row.settled_at)
    && row.outcome_rank !== null && row.outcome_rank !== undefined;

function wilsonInterval(wins, total) {
    if (!total) return null;
    const z = 1.96;
    const p = wins / total;
    const denominator = 1 + z * z / total;
    const center = (p + z * z / (2 * total)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)].map(value => Number((value * 100).toFixed(1)));
}

function summarize(rows, label) {
    const settled = rows.filter(isSettledSnapshot);
    const wins = settled.filter(row => Number(row.outcome_rank) === 1);
    const payoutsComplete = wins.every(row => Number.isFinite(Number(row.official_payout)) && Number(row.official_payout) > 0);
    const returns = payoutsComplete ? wins.reduce((sum, row) => sum + Number(row.official_payout), 0) : null;
    return {
        label,
        courses: rows.length,
        settled: settled.length,
        pending: rows.length - settled.length,
        wins: wins.length,
        winRate: settled.length ? Number((wins.length * 100 / settled.length).toFixed(1)) : null,
        confidence95: wilsonInterval(wins.length, settled.length),
        payoutCoverage: wins.length ? Number((wins.filter(row => Number(row.official_payout) > 0).length * 100 / wins.length).toFixed(1)) : null,
        roi: settled.length && payoutsComplete ? Number((((returns - settled.length) / settled.length) * 100).toFixed(1)) : null,
        roiStatus: !settled.length ? 'aucun résultat réglé' : !wins.length ? 'aucun gagnant' : payoutsComplete ? 'rapports officiels complets' : 'rapports officiels incomplets'
    };
}

function rankedRunners(rows, rankField) {
    return rows
        .filter(row => Number.isInteger(Number(row[rankField])) && Number(row[rankField]) > 0)
        .sort((a, b) => Number(a[rankField]) - Number(b[rankField]) || Number(a.horse_number) - Number(b.horse_number));
}

function summarizeTopK(courses, rankField, k) {
    const eligible = courses.filter(course => course[rankField].length > 0);
    const hits = eligible.filter(course => course[rankField]
        .slice(0, k)
        .some(row => Number(row.outcome_rank) === 1)).length;
    return {
        courses: eligible.length,
        hits,
        hitRate: eligible.length ? Number((hits * 100 / eligible.length).toFixed(1)) : null,
        confidence95: wilsonInterval(hits, eligible.length)
    };
}

function winnerReciprocalRank(course, rankField) {
    const winnerIndex = course[rankField].findIndex(row => Number(row.outcome_rank) === 1);
    return winnerIndex < 0 ? null : 1 / (winnerIndex + 1);
}

function bootstrapMeanInterval(values, seed = 0x4d525231, replicates = 2000) {
    if (values.length < 2) return null;
    let state = seed >>> 0;
    const random = () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
    const means = new Array(replicates);
    for (let sample = 0; sample < replicates; sample++) {
        let total = 0;
        for (let i = 0; i < values.length; i++) {
            total += values[Math.floor(random() * values.length)];
        }
        means[sample] = total * 100 / values.length;
    }
    means.sort((a, b) => a - b);
    const percentile = value => {
        const position = (means.length - 1) * value;
        const lower = Math.floor(position);
        const fraction = position - lower;
        return means[lower] + (means[Math.min(lower + 1, means.length - 1)] - means[lower]) * fraction;
    };
    return [percentile(0.025), percentile(0.975)].map(value => Number(value.toFixed(1)));
}

function pairedBootstrapMeanDifferenceInterval(values, replicates = 2000) {
    return bootstrapMeanInterval(values, 0x4d525231, replicates);
}

function pairedBootstrapDifferenceInterval(courses, k, replicates = 2000) {
    if (courses.length < 2) return null;
    const differences = courses.map(course => {
        const predictionHit = course.prediction_rank.slice(0, k).some(row => Number(row.outcome_rank) === 1);
        const marketHit = course.market_rank.slice(0, k).some(row => Number(row.outcome_rank) === 1);
        return Number(predictionHit) - Number(marketHit);
    });
    return bootstrapMeanInterval(differences, (0x6d2b79f5 ^ k) >>> 0, replicates);
}

function scoreBand(score) {
    if (score >= 95) return '95+';
    if (score >= 90) return '90–94';
    if (score >= 80) return '80–89';
    if (score >= 70) return '70–79';
    if (score >= 60) return '60–69';
    if (score >= 50) return '50–59';
    return '0–49';
}

function hasValidFeatureVector(row) {
    try {
        const features = JSON.parse(row.feature_vector_json);
        return Array.isArray(features) && features.length === 15 && features.every(Number.isFinite);
    } catch {
        return false;
    }
}

function isCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function getForecastEvaluation({ startDate, endDate, database } = {}) {
    if ((startDate !== undefined && startDate !== null && !isCalendarDate(startDate))
        || (endDate !== undefined && endDate !== null && !isCalendarDate(endDate))
        || (startDate && endDate && startDate > endDate)) {
        throw new RangeError('Période d’évaluation invalide : dates attendues au format AAAA-MM-JJ et dans l’ordre chronologique.');
    }
    const db = database || getDB();
    const clauses = [];
    const params = [];
    if (startDate) { clauses.push('course_date >= ?'); params.push(startDate); }
    if (endDate) { clauses.push('course_date <= ?'); params.push(endDate); }
    const snapshots = await all(db, `
        SELECT * FROM prediction_snapshots
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY course_date, COALESCE(scheduled_time, ''), prediction_rank
    `, params);
    const grouped = new Map();
    for (const row of snapshots) {
        if (!grouped.has(row.course_id)) grouped.set(row.course_id, []);
        grouped.get(row.course_id).push(row);
    }
    const courses = [...grouped.values()];
    const activeCourses = courses.map(rows => rows.filter(row => Number(row.is_non_runner) !== 1)).filter(rows => rows.length);
    const modelVersions = [...new Set(snapshots.map(row => row.model_version).filter(Boolean))];
    const trainingEligibleCourses = activeCourses.filter(rows =>
        rows.length > 0
            && rows.every(row => isSettledSnapshot(row) && hasValidFeatureVector(row))
        && rows.every(row => Number(row.feature_schema_version) === ML_FEATURE_SCHEMA_VERSION)
        && rows.some(row => Number(row.outcome_rank) === 1)
    ).length;
    const topPicks = activeCourses.map(rows => rows
        .filter(row => Number.isInteger(Number(row.prediction_rank)) && Number(row.prediction_rank) > 0)
        .reduce((best, row) => !best || Number(row.prediction_rank) < Number(best.prediction_rank) ? row : best, null))
        .filter(Boolean);
    const marketPicks = activeCourses.map(rows => rows
        .filter(row => Number.isInteger(Number(row.market_rank)) && Number(row.market_rank) > 0)
        .reduce((best, row) => !best || Number(row.market_rank) < Number(best.market_rank) ? row : best, null))
        .filter(Boolean);
    // Comparer IA et favori marché sur exactement les mêmes courses. Sinon,
    // l'IA peut sembler meilleure ou pire simplement parce que des courses
    // sans cote exploitable n'entrent que dans son échantillon.
    const marketCourseIds = new Set(marketPicks.map(row => row.course_id));
    const matchedTopPicks = topPicks.filter(row => marketCourseIds.has(row.course_id));
    const topPickCourseIds = new Set(topPicks.map(row => row.course_id));
    const matchedMarketPicks = marketPicks.filter(row => topPickCourseIds.has(row.course_id));
    const modelVersionCourses = new Map(modelVersions.map(version => [version, []]));
    let mixedModelVersionCourses = 0;
    let unattributedModelVersionCourses = 0;
    for (const rows of activeCourses) {
        const versions = new Set(rows.map(row => row.model_version).filter(Boolean));
        const version = versions.values().next().value;
        if (versions.size !== 1 || rows.some(row => row.model_version !== version)) {
            if (versions.size > 0) mixedModelVersionCourses++;
            else unattributedModelVersionCourses++;
            continue;
        }
        modelVersionCourses.get(version)?.push(rows);
    }
    const consistentVersionCourseIds = new Set([...modelVersionCourses.values()].flatMap(groups => groups.map(rows => rows[0].course_id)));
    const evaluationTopPicks = topPicks.filter(row => consistentVersionCourseIds.has(row.course_id));
    const fullySettledCourseIds = new Set(activeCourses
        .filter(rows => consistentVersionCourseIds.has(rows[0].course_id)
            && rows.every(isSettledSnapshot))
        .map(rows => rows[0].course_id));
    const settledMatchedTopPicks = matchedTopPicks.filter(row => fullySettledCourseIds.has(row.course_id));
    const settledMatchedMarketPicks = matchedMarketPicks.filter(row => fullySettledCourseIds.has(row.course_id));
    const comparableSettledCourses = activeCourses
        .filter(rows => fullySettledCourseIds.has(rows[0].course_id))
        .map(rows => ({
            courseId: rows[0].course_id,
            runnerCount: rows.length,
            prediction_rank: rankedRunners(rows, 'prediction_rank'),
            market_rank: rankedRunners(rows, 'market_rank')
        }))
        .filter(course => course.prediction_rank.length === course.runnerCount
            && course.market_rank.length === course.runnerCount);
    const rankingComparison = [1, 3, 5].map(topK => {
        const prediction = summarizeTopK(comparableSettledCourses, 'prediction_rank', topK);
        const market = summarizeTopK(comparableSettledCourses, 'market_rank', topK);
        return {
            topK,
            comparableCourses: comparableSettledCourses.length,
            prediction,
            market,
            differencePoints: prediction.hitRate === null || market.hitRate === null
                ? null
                : Number((prediction.hitRate - market.hitRate).toFixed(1)),
            differenceConfidence95: pairedBootstrapDifferenceInterval(comparableSettledCourses, topK)
        };
    });
    const winnerRankCourses = comparableSettledCourses.filter(course =>
        winnerReciprocalRank(course, 'prediction_rank') !== null
        && winnerReciprocalRank(course, 'market_rank') !== null);
    const predictionMrr = winnerRankCourses.map(course => winnerReciprocalRank(course, 'prediction_rank'));
    const marketMrr = winnerRankCourses.map(course => winnerReciprocalRank(course, 'market_rank'));
    const mrrDifferences = winnerRankCourses.map(course =>
        winnerReciprocalRank(course, 'prediction_rank') - winnerReciprocalRank(course, 'market_rank'));
    const meanMrr = values => values.length
        ? Number((values.reduce((sum, value) => sum + value, 0) * 100 / values.length).toFixed(1))
        : null;
    const winnerRankComparison = {
        comparableCourses: winnerRankCourses.length,
        predictionMeanReciprocalRank: meanMrr(predictionMrr),
        predictionConfidence95: bootstrapMeanInterval(predictionMrr, 0x4d525232),
        marketMeanReciprocalRank: meanMrr(marketMrr),
        marketConfidence95: bootstrapMeanInterval(marketMrr, 0x4d525233),
        differencePoints: mrrDifferences.length
            ? Number((mrrDifferences.reduce((sum, value) => sum + value, 0) * 100 / mrrDifferences.length).toFixed(1))
            : null,
        differenceConfidence95: pairedBootstrapMeanDifferenceInterval(mrrDifferences)
    };
    const modelVersionBreakdown = modelVersions.map(modelVersion => {
        const versionCourses = modelVersionCourses.get(modelVersion) || [];
        const settled = versionCourses
            .filter(rows => rows.every(isSettledSnapshot))
            .map(rows => ({
                courseId: rows[0].course_id,
                runnerCount: rows.length,
                prediction_rank: rankedRunners(rows, 'prediction_rank'),
                market_rank: rankedRunners(rows, 'market_rank')
            }));
        const comparable = settled.filter(course => course.prediction_rank.length === course.runnerCount
            && course.market_rank.length === course.runnerCount);
        const byTopK = k => ({
            prediction: summarizeTopK(comparable, 'prediction_rank', k),
            market: summarizeTopK(comparable, 'market_rank', k)
        });
        const top1 = byTopK(1);
        const top3 = byTopK(3);
        const top5 = byTopK(5);
        return {
            modelVersion,
            capturedCourses: versionCourses.length,
            settledCourses: versionCourses.filter(rows => rows.every(isSettledSnapshot)).length,
            comparableSettledCourses: comparable.length,
            predictionTop1: top1.prediction,
            predictionTop3: top3.prediction,
            predictionTop5: top5.prediction,
            marketTop1: top1.market,
            top1DifferencePoints: top1.prediction.hitRate === null || top1.market.hitRate === null
                ? null
                : Number((top1.prediction.hitRate - top1.market.hitRate).toFixed(1)),
            top1DifferenceConfidence95: pairedBootstrapDifferenceInterval(comparable, 1)
        };
    });
    const settledCount = topPicks.filter(isSettledSnapshot).length;
    const calibration = [ '95+', '90–94', '80–89', '70–79', '60–69', '50–59', '0–49' ].map(band => {
        const group = evaluationTopPicks.filter(row => scoreBand(Number(row.prediction_score) || 0) === band);
        const settled = group.filter(isSettledSnapshot);
        const wins = settled.filter(row => Number(row.outcome_rank) === 1).length;
        return { band, captured: group.length, settled: settled.length, wins, winRate: settled.length ? Number((wins * 100 / settled.length).toFixed(1)) : null, confidence95: wilsonInterval(wins, settled.length) };
    });
    const segment = (keyFn, labels) => labels.map(label => {
        const picks = evaluationTopPicks.filter(row => keyFn(row) === label);
        const stat = summarize(picks, label);
        return { ...stat, segment: label };
    }).filter(item => item.courses);
    const disciplines = [...new Set(evaluationTopPicks.map(row => row.discipline || 'Inconnue'))];
    const oddsLabels = ['< 3', '3–5', '5–10', '10+'];
    const oddsBucket = row => {
        const odds = Number(row.odds_at_prediction);
        if (!(odds > 0)) return 'Cote inconnue';
        if (odds < 3) return '< 3';
        if (odds < 5) return '3–5';
        if (odds < 10) return '5–10';
        return '10+';
    };
    const dateFilters = `${startDate ? 'AND c.date >= ?' : ''} ${endDate ? 'AND c.date <= ?' : ''}`;
    const finishedCourseCounts = await all(db, `
        SELECT substr(c.date, 1, 7) AS month,
               COUNT(DISTINCT c.id) AS finished_courses,
               COUNT(DISTINCT CASE WHEN ps.course_id IS NOT NULL THEN c.id END) AS captured_finished_courses
        FROM courses c
        LEFT JOIN prediction_snapshots ps ON ps.course_id = c.id
        WHERE COALESCE(c.ordre_arrivee, '') <> '' ${dateFilters}
        GROUP BY substr(c.date, 1, 7)
        ORDER BY month
    `, [ ...(startDate ? [startDate] : []), ...(endDate ? [endDate] : []) ]);
    const finishedCourses = finishedCourseCounts.reduce((sum, row) => sum + Number(row.finished_courses || 0), 0);
    const capturedFinishedCourses = finishedCourseCounts.reduce((sum, row) => sum + Number(row.captured_finished_courses || 0), 0);
    const capturedCoursesByMonth = new Map();
    for (const rows of activeCourses) {
        const month = String(rows[0].course_date || '').slice(0, 7);
        if (!capturedCoursesByMonth.has(month)) capturedCoursesByMonth.set(month, []);
        capturedCoursesByMonth.get(month).push(rows);
    }
    const monthlyTrend = finishedCourseCounts.map(monthRow => {
        const capturedGroups = capturedCoursesByMonth.get(monthRow.month) || [];
        const settledGroups = capturedGroups.filter(rows => rows.every(isSettledSnapshot));
        const comparableGroups = settledGroups
            .filter(rows => consistentVersionCourseIds.has(rows[0].course_id))
            .map(rows => ({
                courseId: rows[0].course_id,
                runnerCount: rows.length,
                prediction_rank: rankedRunners(rows, 'prediction_rank'),
                market_rank: rankedRunners(rows, 'market_rank')
            }))
            .filter(course => course.prediction_rank.length === course.runnerCount
                && course.market_rank.length === course.runnerCount);
        const top1 = summarizeTopK(comparableGroups, 'prediction_rank', 1);
        const top3 = summarizeTopK(comparableGroups, 'prediction_rank', 3);
        const top5 = summarizeTopK(comparableGroups, 'prediction_rank', 5);
        const marketTop1 = summarizeTopK(comparableGroups, 'market_rank', 1);
        const predictionFlatStake = summarize(comparableGroups.map(course => course.prediction_rank[0]), 'IA Top 1');
        const marketFlatStake = summarize(comparableGroups.map(course => course.market_rank[0]), 'Favori marché');
        return {
            month: monthRow.month,
            finishedCourses: Number(monthRow.finished_courses || 0),
            capturedFinishedCourses: Number(monthRow.captured_finished_courses || 0),
            captureCoverage: Number(monthRow.finished_courses)
                ? Number((Number(monthRow.captured_finished_courses || 0) * 100 / Number(monthRow.finished_courses)).toFixed(1))
                : null,
            settledCapturedCourses: settledGroups.length,
            settlementCoverage: capturedGroups.length
                ? Number((settledGroups.length * 100 / capturedGroups.length).toFixed(1))
                : null,
            comparableSettledCourses: comparableGroups.length,
            predictionTop1: top1,
            predictionTop3: top3,
            predictionTop5: top5,
            marketTop1,
            predictionTop1Roi: predictionFlatStake.roi,
            predictionTop1PayoutCoverage: predictionFlatStake.payoutCoverage,
            marketTop1Roi: marketFlatStake.roi,
            marketTop1PayoutCoverage: marketFlatStake.payoutCoverage,
            top1DifferencePoints: top1.hitRate === null || marketTop1.hitRate === null
                ? null
                : Number((top1.hitRate - marketTop1.hitRate).toFixed(1)),
            top1DifferenceConfidence95: pairedBootstrapDifferenceInterval(comparableGroups, 1)
        };
    });
    const legacy = await all(db, `
        SELECT COUNT(*) AS count FROM courses c
        WHERE COALESCE(c.ordre_arrivee, '') <> ''
          ${startDate ? 'AND c.date >= ?' : ''} ${endDate ? 'AND c.date <= ?' : ''}
          AND NOT EXISTS (SELECT 1 FROM prediction_snapshots ps WHERE ps.course_id = c.id)
    `, [ ...(startDate ? [startDate] : []), ...(endDate ? [endDate] : []) ]);
    const missingOdds = topPicks.filter(row => !(Number(row.odds_at_prediction) > 0)).length;
    return {
        period: { startDate: startDate || null, endDate: endDate || null },
        methodology: 'Pronostics immuables capturés avant le départ. Les courses antérieures à leur activation ne sont pas reconstituées.',
        comparison: [
            summarize(settledMatchedTopPicks, 'IA (meilleur score, courses comparables entièrement réglées)'),
            summarize(settledMatchedMarketPicks, 'Favori marché (cote capturée, mêmes courses)')
        ],
        rankingComparison,
        winnerRankComparison,
        modelVersionBreakdown,
        monthlyTrend,
        uncertainty: {
            interval: 'Wilson 95 % par course réglée',
            differenceInterval: 'Bootstrap apparié percentile 95 %, 2 000 réplications déterministes, rééchantillonnées par course',
            comparison: 'L’intervalle de l’écart décrit son incertitude; il ne constitue pas à lui seul une preuve de supériorité durable.'
        },
        comparisonCoverage: {
            coursesWithBothPicks: matchedTopPicks.length,
            iaPicks: topPicks.length,
            marketPicks: marketPicks.length
        },
        scoreBands: calibration,
        byDiscipline: segment(row => row.discipline || 'Inconnue', disciplines),
        byOdds: segment(oddsBucket, [...oddsLabels, 'Cote inconnue']),
        quality: {
            capturedCourses: courses.length,
            finishedCourses,
            capturedFinishedCourses,
            finishedCourseCaptureCoverage: finishedCourses
                ? Number((capturedFinishedCourses * 100 / finishedCourses).toFixed(1))
                : null,
            capturedRunners: snapshots.length,
            nonRunnerSnapshots: snapshots.filter(row => Number(row.is_non_runner) === 1).length,
            trainingEligibleCourses,
            settledCourses: settledCount,
            pendingCourses: topPicks.length - settledCount,
            settlementCoverage: topPicks.length ? Number((settledCount * 100 / topPicks.length).toFixed(1)) : null,
            runnersWithoutOdds: snapshots.filter(row => !(Number(row.odds_at_prediction) > 0)).length,
            runnersWithoutFrozenFeatures: snapshots.filter(row => !row.feature_vector_json).length,
            runnersWithIncompatibleFeatureSchema: snapshots.filter(row => Number(row.feature_schema_version) !== ML_FEATURE_SCHEMA_VERSION).length,
            topPicksWithoutOdds: missingOdds,
            topPicksWithoutForm: topPicks.filter(row => !row.has_form).length,
            topPicksWithoutDriver: topPicks.filter(row => !row.has_driver).length,
            legacyFinishedCoursesWithoutSnapshot: Number(legacy[0]?.count || 0),
            payoutMissingAmongWinningPicks: topPicks.filter(row => Number(row.outcome_rank) === 1 && !(Number(row.official_payout) > 0)).length,
            modelVersions,
            mixedModelVersionCourses,
            unattributedModelVersionCourses,
            lastCaptureAt: snapshots.reduce((latest, row) => !latest || row.captured_at > latest ? row.captured_at : latest, null),
            lastSettlementAt: snapshots.reduce((latest, row) => row.settled_at && (!latest || row.settled_at > latest) ? row.settled_at : latest, null)
        }
    };
}
