import sqlite3 from 'sqlite3';
import { CONFIG } from '../config/settings.mjs';
import logger from '../utils/logger.mjs';

let db = null;

async function createTables() {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT,
                heure TEXT,
                hippodrome TEXT,
                discipline TEXT,
                distance TEXT,
                statut TEXT,
                partants INTEGER,
                prix REAL,
                reunionNum TEXT,
                courseNum TEXT
            )
        `, (err) => {
            if (err) {
                logger.error(`Erreur création table: ${err.message}`);
                reject(err);
            } else {
                logger.info('Table courses créée/vérifiée');
                resolve();
            }
        });
    });
}

export async function initDB() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(CONFIG.database.path, (err) => {
            if (err) {
                logger.error(`Erreur d'ouverture de la DB: ${err.message}`);
                reject(err);
            } else {
                logger.info(`Base de données connectée: ${CONFIG.database.path}`);
                createTables().then(resolve).catch(reject);
            }
        });
    });
}

export async function insertCourses(courses) {
    if (!db) throw new Error('DB not initialized');
    
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT INTO courses (date, heure, hippodrome, discipline, distance, statut, partants, prix, reunionNum, courseNum)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        let inserted = 0;
        for (const c of courses) {
            stmt.run(
                c.date, c.heure, c.hippodrome, c.discipline, c.distance, c.statut, c.partants, c.prix, c.reunionNum, c.courseNum,
                (err) => {
                    if (err) {
                        logger.error(`Erreur insertion course: ${err.message}`);
                    } else {
                        inserted++;
                    }
                }
            );
        }
        
        stmt.finalize((err) => {
            if (err) {
                logger.error(`Erreur finalisation: ${err.message}`);
                reject(err);
            } else {
                logger.success(`${inserted} courses insérées`);
                resolve(inserted);
            }
        });
    });
}

export async function getAllCourses() {
    if (!db) throw new Error('DB not initialized');
    
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM courses', (err, rows) => {
            if (err) {
                logger.error(`Erreur récupération courses: ${err.message}`);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

export async function closeDB() {
    if (db) {
        return new Promise((resolve) => {
            db.close((err) => {
                if (err) {
                    logger.error(`Erreur fermeture DB: ${err.message}`);
                } else {
                    logger.info('Base de données fermée');
                }
                db = null;
                resolve();
            });
        });
    }
} 