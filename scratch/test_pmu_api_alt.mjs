import { fetchApi } from '../src/core/fetcher.mjs';
import { format } from 'date-fns';

async function main() {
    const today = format(new Date(), 'ddMMyyyy');
    const r = 1;
    const c = 1;
    const url = `https://online.turfinfo.api.pmu.fr/rest/client/61/programme/${today}/R${r}/C${c}/participants`; // No specialisation
    console.log(`Fetching ${url}...`);
    const data = await fetchApi(url);
    
    if (data && data.participants && data.participants.length > 0) {
        const p = data.participants[0];
        console.log("KEYS IN PARTICIPANT:", Object.keys(p).join(', '));
        if (p.performances) console.log("PERFORMANCES FOUND!");
        else console.log("PERFORMANCES STILL MISSING.");
    }
}

main().catch(console.error);
