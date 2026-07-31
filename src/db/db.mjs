import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/settings.mjs';
import { runMigrations } from './migrate.mjs';
import logger from '../utils/logger.mjs';

let db = null;

export function getDB() {
    if (!db) throw new Error('Database not initialized. Call initDB() first.');
    return db;
}

export async function initDB() {
    return new Promise((resolve, reject) => {
        const dbPath = process.env.DB_PATH || CONFIG.database.path;
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                logger.error(`Erreur d'ouverture de la DB: ${err.message}`);
                reject(err);
            } else {
                logger.info(`Base de données connectée: ${dbPath}`);
                db.run('PRAGMA foreign_keys = ON');
                runMigrations(db).then(resolve).catch(reject);
            }
        });
    });
}

export async function closeDB() {
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
