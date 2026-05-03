import { fetchCourseParticipants } from '../src/core/fetcher.mjs';
import { format } from 'date-fns';

async function main() {
    const today = format(new Date(), 'ddMMyyyy');
    const r = 1;
    const c = 1;
    console.log(`Fetching details for R${r}C${c} on ${today}...`);
    const data = await fetchCourseParticipants(today, r, c);
    
    if (data && data.participants && data.participants.length > 0) {
        const p = data.participants[0];
        console.log("SAMPLE PARTICIPANT DATA:");
        console.log(JSON.stringify(p, null, 2));
    } else {
        console.log("No data found or no participants.");
    }
}

main().catch(console.error);
