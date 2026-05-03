import { compareKellyStrategies } from '../src/ml/backtest.mjs';

async function run() {
    try {
        await compareKellyStrategies('2026-01-01', '2026-12-31', 1000);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
