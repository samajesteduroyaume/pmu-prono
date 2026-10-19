export const TRAIN_FRACTION = 0.70;
export const VALIDATION_FRACTION = 0.15;
export const MIN_CAPTURE_DATES = 30;
export const MIN_CAPTURED_COURSES = 120;

/** Split courses by date so a race day never leaks across dataset partitions. */
export function splitCourseGroups(courses) {
    const dates = [...new Set(courses.map(course => String(course.date || '')))].sort();
    if (dates.length < MIN_CAPTURE_DATES) {
        throw new Error(`Données prospectives insuffisantes : il faut au moins ${MIN_CAPTURE_DATES} dates distinctes pour séparer train, validation et test.`);
    }

    const trainEnd = Math.min(dates.length - 2, Math.max(1, Math.floor(dates.length * TRAIN_FRACTION)));
    const validationEnd = Math.min(dates.length - 1, Math.max(trainEnd + 1, Math.floor(dates.length * (TRAIN_FRACTION + VALIDATION_FRACTION))));
    const trainDates = new Set(dates.slice(0, trainEnd));
    const validationDates = new Set(dates.slice(trainEnd, validationEnd));
    const testDates = new Set(dates.slice(validationEnd));

    return {
        trainCourses: courses.filter(course => trainDates.has(String(course.date || ''))),
        validationCourses: courses.filter(course => validationDates.has(String(course.date || ''))),
        testCourses: courses.filter(course => testDates.has(String(course.date || '')))
    };
}

/** Same chronological split as training, for an honest readiness estimate. */
export function countChronologicalCourseSplits(courses) {
    const dates = [...new Set(courses.map(course => String(course.date || '')))].sort();
    if (dates.length < MIN_CAPTURE_DATES) {
        return { dates: dates.length, train: 0, validation: 0, test: 0, splittable: false };
    }
    const split = splitCourseGroups(courses);
    return {
        dates: dates.length,
        train: split.trainCourses.length,
        validation: split.validationCourses.length,
        test: split.testCourses.length,
        splittable: true
    };
}
