import { fetchApi } from '../src/core/fetcher.mjs';
import { format } from 'date-fns';

async function main() {
    const today = format(new Date(), 'ddMMyyyy');
    const r = 1;
    const c = 1;
    const url = `https://online.turfinfo.api.pmu.fr/rest/client/61/programme/${today}/R1/C1`;
    const data = await fetchApi(url);
    
    if (data) {
        console.log("TOP KEYS:", Object.keys(data).join(', '));
        // Common PMU structure is { programme: { ... }, ... } or { participants: [...] }
        const p = data.participants || (data.programme && data.programme.participants);
        if (p) {
             console.log("Participants found!");
             console.log("Sample keys:", Object.keys(p[0]).join(', '));
        } else {
             console.log("Still no participants found.");
        }
    }
}

main().catch(console.error);
