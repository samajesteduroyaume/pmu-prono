import { initDB, recordCoteHistorique, getParticipantId } from '../core/db.mjs';
import { fetchApi, fetchCourseParticipants } from '../core/fetcher.mjs';
import CONFIG from '../config/settings.mjs';
import logger from '../utils/logger.mjs';
import { format } from 'date-fns';

/**
 * SMART MONEY TRACKER - ARCHITECT v27.1
 * Surveille les baisses de cotes en temps réel avant le départ.
 */

const TRK = CONFIG.engine_settings.tracking;

async function trackLiveOdds() {
    logger.header('ARCHITECT LIVE SONDE : Smart Money Tracker Actif');
    await initDB();

    while (true) {
        try {
            const now = new Date();
            const dateStr = format(now, 'ddMMyyyy');
            const todayISO = format(now, 'yyyy-MM-dd');
            
            logger.info(`Scan Architect du programme live (${format(now, 'HH:mm:ss')})...`);
            
            const programmeUrl = `https://online.turfinfo.api.pmu.fr/rest/client/61/programme/${dateStr}?specialisation=INTERNET`;
            const data = await fetchApi(programmeUrl);
            
            if (!data || !data.programme || !data.programme.reunions) {
                logger.warn('Aucun programme trouvé pour le tracking live.');
                await sleep(TRK.refresh_interval_ms);
                continue;
            }

            for (const reunion of data.programme.reunions) {
                if (!reunion.courses) continue;
                
                for (const course of reunion.courses) {
                    // Filtrage : On ne tracke que les courses à venir bientôt
                    const startTime = new Date(course.heureDepart);
                    const diffMin = (startTime - now) / (1000 * 60);

                    if (diffMin > -5 && diffMin < TRK.start_window_minutes) {
                        logger.info(`Tracking R${reunion.numOfficiel}C${course.numOrdre} (${course.libelle}) - Départ dans ${Math.round(diffMin)}min`);
                        
                        const detail = await fetchCourseParticipants(dateStr, reunion.numOfficiel, course.numOrdre);
                        if (detail && detail.participants) {
                            for (const p of detail.participants) {
                                if (p.cote) {
                                    const participantId = await getParticipantId(todayISO, reunion.numOfficiel, course.numOrdre, p.numero);
                                    if (participantId) {
                                        await recordCoteHistorique(participantId, p.cote);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            logger.info(`Scan Architect terminé. Prochaine mise à jour dans ${TRK.refresh_interval_ms / 60000} minutes.`);
        } catch (err) {
            logger.error(`Erreur ARCHITECT Live Sonde: ${err.message}`);
        }

        await sleep(TRK.refresh_interval_ms);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Auto-run
if (import.meta.url === `file://${process.argv[1]}`) {
    trackLiveOdds().catch(err => {
        console.error('Lancement Tracker fatal:', err);
        process.exit(1);
    });
}
