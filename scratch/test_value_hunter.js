import { detectOpportunities } from '../src/core/value_hunter.mjs';
import { initDB } from '../src/core/db.mjs';

async function test() {
    await initDB();
    const date = '2026-04-27';
    console.log(`Running Value Hunter for ${date}...`);
    const opps = await detectOpportunities(date);
    
    if (opps.length > 0) {
        console.log(`\nFound ${opps.length} opportunities:`);
        opps.forEach(o => {
            console.log(`- ${o.nom} (Cote: ${o.cote}, Score IA: ${o.score}, Edge: ${o.edge}%, Recommendation: ${o.signal_gate.recommendation})`);
        });
    } else {
        console.log("\nNo opportunities found for today.");
    }
}

test().catch(console.error);
