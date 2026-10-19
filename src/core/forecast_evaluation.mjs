import { getDB } from '../db/db.mjs';

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});

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
    const settled = rows.filter(row => row.outcome_rank !== null && row.outcome_rank !== undefined);
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

export async function getForecastEvaluation({ startDate, endDate } = {}) {
    if ((startDate !== undefined && startDate !== null && !isCalendarDate(startDate))
        || (endDate !== undefined && endDate !== null && !isCalendarDate(endDate))
        || (startDate && endDate && startDate > endDate)) {
        throw new RangeError('Période d’évaluation invalide : dates attendues au format AAAA-MM-JJ et dans l’ordre chronologique.');
    }
    const db = getDB();
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
    const modelVersions = [...new Set(snapshots.map(row => row.model_version).filter(Boolean))];
    const trainingEligibleCourses = courses.filter(rows =>
        rows.length > 0
        && rows.every(row => row.settled_at && row.outcome_rank !== null && row.outcome_rank !== undefined && hasValidFeatureVector(row))
        && rows.some(row => Number(row.outcome_rank) === 1)
    ).length;
    const topPicks = courses.map(rows => rows.find(row => Number(row.prediction_rank) === 1)).filter(Boolean);
    const marketPicks = courses.map(rows => rows.find(row => Number(row.market_rank) === 1)).filter(Boolean);
    // Comparer IA et favori marché sur exactement les mêmes courses. Sinon,
    // l'IA peut sembler meilleure ou pire simplement parce que des courses
    // sans cote exploitable n'entrent que dans son échantillon.
    const marketCourseIds = new Set(marketPicks.map(row => row.course_id));
    const matchedTopPicks = topPicks.filter(row => marketCourseIds.has(row.course_id));
    const topPickCourseIds = new Set(topPicks.map(row => row.course_id));
    const matchedMarketPicks = marketPicks.filter(row => topPickCourseIds.has(row.course_id));
    const settledCount = topPicks.filter(row => row.outcome_rank !== null && row.outcome_rank !== undefined).length;
    const calibration = [ '95+', '90–94', '80–89', '70–79', '60–69', '50–59', '0–49' ].map(band => {
        const group = topPicks.filter(row => scoreBand(Number(row.prediction_score) || 0) === band);
        const settled = group.filter(row => row.outcome_rank !== null && row.outcome_rank !== undefined);
        const wins = settled.filter(row => Number(row.outcome_rank) === 1).length;
        return { band, captured: group.length, settled: settled.length, wins, winRate: settled.length ? Number((wins * 100 / settled.length).toFixed(1)) : null, confidence95: wilsonInterval(wins, settled.length) };
    });
    const segment = (keyFn, labels) => labels.map(label => {
        const picks = topPicks.filter(row => keyFn(row) === label);
        const stat = summarize(picks, label);
        return { ...stat, segment: label };
    }).filter(item => item.courses);
    const disciplines = [...new Set(topPicks.map(row => row.discipline || 'Inconnue'))];
    const oddsLabels = ['< 3', '3–5', '5–10', '10+'];
    const oddsBucket = row => {
        const odds = Number(row.odds_at_prediction);
        if (!(odds > 0)) return 'Cote inconnue';
        if (odds < 3) return '< 3';
        if (odds < 5) return '3–5';
        if (odds < 10) return '5–10';
        return '10+';
    };
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
            summarize(matchedTopPicks, 'IA (meilleur score, courses comparables)'),
            summarize(matchedMarketPicks, 'Favori marché (cote capturée, mêmes courses)')
        ],
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
            capturedRunners: snapshots.length,
            trainingEligibleCourses,
            settledCourses: settledCount,
            pendingCourses: topPicks.length - settledCount,
            settlementCoverage: topPicks.length ? Number((settledCount * 100 / topPicks.length).toFixed(1)) : null,
            runnersWithoutOdds: snapshots.filter(row => !(Number(row.odds_at_prediction) > 0)).length,
            runnersWithoutFrozenFeatures: snapshots.filter(row => !row.feature_vector_json).length,
            topPicksWithoutOdds: missingOdds,
            topPicksWithoutForm: topPicks.filter(row => !row.has_form).length,
            topPicksWithoutDriver: topPicks.filter(row => !row.has_driver).length,
            legacyFinishedCoursesWithoutSnapshot: Number(legacy[0]?.count || 0),
            payoutMissingAmongWinningPicks: topPicks.filter(row => Number(row.outcome_rank) === 1 && !(Number(row.official_payout) > 0)).length,
            modelVersions,
            lastCaptureAt: snapshots.reduce((latest, row) => !latest || row.captured_at > latest ? row.captured_at : latest, null),
            lastSettlementAt: snapshots.reduce((latest, row) => row.settled_at && (!latest || row.settled_at > latest) ? row.settled_at : latest, null)
        }
    };
}
