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
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
                .replace(/--.*$/gm, '');
            const statements = sql.split(';').map(statement => statement.trim()).filter(Boolean);

            try {
                await new Promise((resolve, reject) => db.run('BEGIN IMMEDIATE', error => error ? reject(error) : resolve()));
                for (const statement of statements) {
                    // Les anciennes bases ont parfois une colonne sans son
                    // entrée migrations_history. Ignorer uniquement l'ALTER
                    // correspondant si cette colonne existe déjà.
                    const alterColumn = statement.match(/^ALTER\s+TABLE\s+["`\[]?([\w]+)["`\]]?\s+ADD\s+COLUMN\s+["`\[]?([\w]+)["`\]]?/i);
                    if (alterColumn) {
                        const [, tableName, columnName] = alterColumn;
                        const columns = await new Promise((resolve, reject) => {
                            db.all(`PRAGMA table_info("${tableName}")`, (error, rows) => error ? reject(error) : resolve(rows || []));
                        });
                        if (columns.some(column => column.name === columnName)) continue;
                    }
                    await new Promise((resolve, reject) => db.exec(statement, error => error ? reject(error) : resolve()));
                }
                await new Promise((resolve, reject) => {
                    db.run('INSERT INTO migrations_history (name) VALUES (?)', [file], error => error ? reject(error) : resolve());
                });
                await new Promise((resolve, reject) => db.run('COMMIT', error => error ? reject(error) : resolve()));
                
                logger.success(`[DB] Migration réussie : ${file}`);
            } catch (err) {
                await new Promise(resolve => db.run('ROLLBACK', () => resolve()));
                logger.error(`[DB] ÉCHEC de la migration ${file}: ${err.message}`);
                throw err;
            }
        }
    }

    logger.info('[DB] Toutes les migrations sont à jour.');
}
