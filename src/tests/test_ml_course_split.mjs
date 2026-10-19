import assert from 'node:assert/strict';
import { countChronologicalCourseSplits } from '../ml/course_split.mjs';

const courses = [];
for (let day = 1; day <= 30; day++) {
    const date = `2026-01-${String(day).padStart(2, '0')}`;
    for (let race = 0; race < 10; race++) courses.push({ date });
}

const counts = countChronologicalCourseSplits(courses);
assert.deepEqual(counts, { dates: 30, train: 210, validation: 40, test: 50, splittable: true });
assert.equal(countChronologicalCourseSplits(courses.slice(0, 29)).splittable, false);
console.log('✓ Découpage chronologique — readiness cohérente avec le dataset train/validation/test');
