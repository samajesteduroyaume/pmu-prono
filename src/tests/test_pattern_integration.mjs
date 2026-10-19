import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyserEtGenererAlertes } from '../core/alerts.mjs';
import { calculateKellyAdaptatif, refreshProspectiveCalibration } from '../core/kelly.mjs';
import { closeDB, getDB, initDB } from '../db/db.mjs';
import logger from '../utils/logger.mjs';

async function seedCalibration(db) {
    await new Promise((resolve, reject) => db.run('PRAGMA foreign_keys = OFF', error => error ? reject(error) : resolve()));
    const insert = `INSERT INTO prediction_snapshots (
        course_id, participant_id, horse_number, horse_name, course_date,
        captured_at, source, model_version, prediction_score, prediction_rank,
        outcome_rank, settled_at
    ) VALUES (?, ?, 1, ?, '2026-01-01', '2026-01-01T10:00:00.000Z', 'test', 'test-model', 95, 1, ?, '2026-01-01T12:00:00.000Z')`;
    for (let index = 1; index <= 100; index++) {
        await new Promise((resolve, reject) => db.run(
            insert,
            [index, index, `TEST HORSE ${index}`, index <= 60 ? 1 : 0],
            error => error ? reject(error) : resolve()
        ));
    }
}

async function testIntegration() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmu-pattern-test-'));
    const originalDbPath = process.env.DB_PATH;
    process.env.DB_PATH = path.join(tempDir, 'test.db');

    try {
        await initDB();
        const db = getDB();
        await seedCalibration(db);
        await refreshProspectiveCalibration('test-model');

        logger.header('TEST INTÉGRATION PATTERNS');
        const tendances = {
            drawdown: { currentPercent: 0.05 },
            sequence: { type: 'WIN', count: 2 },
            momentum: 75,
            tendance: { tendance: 'HAUSSIERE' }
        };
        const patternData = {
            goldenPatterns: [{ pattern: 'Trot + Vincennes', roi: 45.5, winRate: 35 }],
            dangerPatterns: [{ pattern: 'Galop + Chantilly', roi: -25, winRate: 10 }],
            stats: { total: 100, totalParis: 500 }
        };

        const alerts = analyserEtGenererAlertes(tendances, { totalParis: 100, roi: 12.5 }, patternData);
        assert.ok(alerts.some(alert => alert.title.includes('GOLDEN')), 'Une alerte Golden Pattern est attendue.');
        assert.ok(alerts.some(alert => alert.title.includes('ÉVITER')), 'Une alerte Danger Pattern est attendue.');

        const result = await calculateKellyAdaptatif(3, 95, 1000, tendances, [
            { type: 'GOLDEN_PATTERN', pattern: 'Trot + Vincennes', roi: 50 }
        ]);
        assert.equal(result.advice, 'BET ADAPTATIF', 'Kelly doit produire une mise après calibration suffisante.');
        assert.ok(result.adjustments.some(adjustment => adjustment.includes('Golden Pattern')),
            'Kelly doit inclure l’ajustement du Golden Pattern.');
        logger.success(`Intégration validée : ${result.adjustments.join(', ')}; mise ${result.mise} €.`);
    } finally {
        await closeDB();
        fs.rmSync(tempDir, { recursive: true, force: true });
        if (originalDbPath === undefined) delete process.env.DB_PATH;
        else process.env.DB_PATH = originalDbPath;
    }
}

testIntegration().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
