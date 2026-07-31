import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Moteur de migrations simple pour SQLite
 */
export async function runMigrations(db) {
    logger.info('[DB] Lancement des migrations...');

    // 1. Créer la table d'historique des migrations
    await new Promise((resolve, reject) => {
        db.run(`CREATE TABLE IF NOT EXISTS migrations_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => err ? reject(err) : resolve());
    });

    // 2. Lire les fichiers SQL du dossier migrations
    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort(); // Exécution ordonnée par nom

    // 3. Récupérer les migrations déjà exécutées
    const executed = await new Promise((resolve, reject) => {
        db.all('SELECT name FROM migrations_history', (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.name));
        });
    });

    // 4. Exécuter les nouvelles migrations
    for (const file of files) {
        if (!executed.includes(file)) {
            logger.info(`[DB] Exécution de la migration : ${file}`);
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            
            try {
                // On utilise exec pour exécuter plusieurs statements SQL
                await new Promise((resolve, reject) => {
                    db.exec(sql, (err) => err ? reject(err) : resolve());
                });

                // Enregistrer le succès
                await new Promise((resolve, reject) => {
                    db.run('INSERT INTO migrations_history (name) VALUES (?)', [file], (err) => {
                        err ? reject(err) : resolve();
                    });
                });
                
                logger.success(`[DB] Migration réussie : ${file}`);
            } catch (err) {
                if (err.message && err.message.includes('duplicate column name')) {
                    logger.warn(`[DB] Colonne déjà existante (${file}), enregistrement de la migration.`);
                    await new Promise((resolve, reject) => {
                        db.run('INSERT INTO migrations_history (name) VALUES (?)', [file], (err) => {
                            err ? reject(err) : resolve();
                        });
                    });
                } else {
                    logger.error(`[DB] ÉCHEC de la migration ${file}: ${err.message}`);
                    throw err;
                }
            }
        }
    }

    logger.info('[DB] Toutes les migrations sont à jour.');
}
