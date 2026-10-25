import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const quantumRoot = process.env.PMU_QUANTIC_ROOT || path.resolve(process.cwd(), '../pmu-quantic');
const dbPath = process.env.PMU_DB_PATH || path.resolve(process.cwd(), 'data/pmu.db');

export function forecastQuantumProgram(date) {
    const bundledPython = path.join(quantumRoot, '.venv', 'bin', 'python');
    const python = process.env.PMU_QUANTIC_PYTHON || (existsSync(bundledPython) ? bundledPython : 'python3');
    return new Promise((resolve, reject) => {
        const child = spawn(python, ['-m', 'quantum_pmu.sync_forecast', '--date', date, '--db', dbPath], {
            cwd: quantumRoot,
            env: { ...process.env, PMU_DB_PATH: dbPath, PYTHONPATH: quantumRoot },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => child.kill('SIGTERM'), 60000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            stdout += chunk;
            if (stdout.length > 128 * 1024) child.kill('SIGTERM');
        });
        child.stderr.on('data', chunk => {
            stderr += chunk;
            if (stderr.length > 128 * 1024) child.kill('SIGTERM');
        });
        child.once('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once('close', code => {
            clearTimeout(timeout);
            if (code !== 0) return reject(new Error(stderr.trim() || `forecast process exited with code ${code}`));
            try {
                resolve(JSON.parse(stdout));
            } catch {
                reject(new Error('Quantum forecast returned invalid JSON.'));
            }
        });
    });
}
