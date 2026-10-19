/**
 * PMU Elite Punter - Database Entry Point (Legacy Proxy)
 * V29.1 Modernized Structure
 */

import { getDB, initDB, closeDB } from '../db/db.mjs';
import * as courseRepo from '../db/repositories/courseRepo.mjs';
import * as statRepo from '../db/repositories/statRepo.mjs';
import * as pariRepo from '../db/repositories/pariRepo.mjs';
import * as portfolioRepo from '../db/repositories/portfolioRepo.mjs';

// Export core functions
export { getDB, initDB, closeDB };

// Proxy all repository functions
export const {
    insertCourses,
    getAllCourses,
    getCoursesPage,
    getAllCoursesWithResults,
    getCourseParticipants,
    getCourseQuinte,
    getCourseById,
    getParticipantId,
    getChevauxEnRetardDeGain,
    getHorseHistory
} = courseRepo;

export const {
    getIAPerformanceStats,
    getAdvancedStats,
    getPalmaresStats,
    getPerformanceParDiscipline,
    getSynergyScore,
    getTendancesCumulees,
    getEcuriesForm
} = statRepo;

export const {
    getHistoriqueParis,
    getSequenceActuelle,
    recordShadowBet,
    settleShadowBets,
    getShadowPerformance,
    recordCoteHistorique,
    getCotesHistorique
} = pariRepo;

export const {
    getBankroll,
    updateBankroll
} = portfolioRepo;
