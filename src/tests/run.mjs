import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmu-tests-'));
const testFiles = [
    'src/tests/test_dates.mjs',
    'src/tests/test_pattern_integration.mjs',
    'src/tests/test_inconsistencies.mjs',
    'src/tests/test_v32_engines.mjs',
    'src/tests/test_v33_shield.mjs',
    'src/tests/test_live_patterns.mjs',
    'src/tests/check_v30_logic.mjs'
];

let failures = 0;
try {
    for (const [index, testFile] of testFiles.entries()) {
        console.log(`\n===== ${testFile} (${index + 1}/${testFiles.length}) =====`);
        const result = spawnSync(process.execPath, [testFile], {
            cwd: projectRoot,
            env: { ...process.env, DB_PATH: path.join(tempDir, `test-${index + 1}.db`) },
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024
        });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.error || result.status !== 0) {
            failures++;
            console.error(`ÉCHEC: ${testFile}${result.error ? ` — ${result.error.message}` : ` — code ${result.status}`}`);
        }
    }
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log(`\n${testFiles.length - failures}/${testFiles.length} tests locaux réussis.`);
if (failures) process.exitCode = 1;
