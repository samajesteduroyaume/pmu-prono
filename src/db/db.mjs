import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/settings.mjs';
import { runMigrations } from './migrate.mjs';
import logger from '../utils/logger.mjs';

let db = null;
let dbInitPromise = null;

export function getDB() {
    if (!db) throw new Error('Database not initialized. Call initDB() first.');
    return db;
}

export function initDB() {
    if (dbInitPromise) return dbInitPromise;
    if (db) return Promise.resolve(db);

    dbInitPromise = new Promise((resolve, reject) => {
        const dbPath = process.env.DB_PATH || CONFIG.database.path;
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                logger.error(`Erreur d'ouverture de la DB: ${err.message}`);
                db = null;
                reject(err);
            } else {
                logger.info(`Base de données connectée: ${dbPath}`);
                db.run('PRAGMA foreign_keys = ON');
                db.run('PRAGMA journal_mode = WAL');
                db.run('PRAGMA busy_timeout = 5000');
                db.run('PRAGMA synchronous = NORMAL');
                runMigrations(db).then(resolve).catch(async (migrationError) => {
                    const failedDB = db;
                    db = null;
                    await new Promise(closeResolve => failedDB.close(() => closeResolve()));
                    reject(migrationError);
                });
            }
        });
    });
    return dbInitPromise.finally(() => {
        dbInitPromise = null;
    });
}

export async function closeDB() {
    if (dbInitPromise) {
        try { await dbInitPromise; } catch { /* Initialisation failure already cleaned up its connection. */ }
    }
    if (db) {
        return new Promise((resolve) => {
            db.close((err) => {
                if (err) logger.error(`Erreur fermeture DB: ${err.message}`);
                else logger.info('Base de données fermée');
                db = null;
                resolve();
            });
        });
    }
}
