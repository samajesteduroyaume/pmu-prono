/**
 * PMU Elite Punter - Database Entry Point (Legacy Proxy)
 * V29.1 Modernized Structure
 */

import { initDB, closeDB } from '../db/db.mjs';
import * as courseRepo from '../db/repositories/courseRepo.mjs';
import * as statRepo from '../db/repositories/statRepo.mjs';
import * as pariRepo from '../db/repositories/pariRepo.mjs';
import * as portfolioRepo from '../db/repositories/portfolioRepo.mjs';

// Export core functions
export { initDB, closeDB };

// Proxy all repository functions
export const {
    insertCourses,
    getAllCourses,
    getCourseParticipants,
    getCourseQuinte,
    getDisciplines,
    getParticipantId,
    getChevauxEnRetardDeGain
} = courseRepo;

export const {
    getIAPerformanceStats,
    getAdvancedStats,
    getPalmaresStats,
    getPerformanceParDiscipline,
    getDriverStats,
    getSynergyScore,
    getOptimizationSample,
    getTendancesCumulees
} = statRepo;

export const {
    getHistoriqueParis,
    getSequenceActuelle,
    recordShadowBet,
    getShadowPerformance,
    recordCoteHistorique,
    getCotesHistorique
} = pariRepo;

export const {
    getBankroll,
    updateBankroll
} = portfolioRepo;
