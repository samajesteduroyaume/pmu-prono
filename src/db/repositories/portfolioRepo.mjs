import { getDB } from '../db.mjs';

export async function getBankroll(type = 'shadow') {
    const db = getDB();
    return new Promise((resolve, reject) => {
        db.get('SELECT balance FROM portfolio WHERE type = ?', [type], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.balance : 1000);
        });
    });
}

export async function updateBankroll(type = 'shadow', amount) {
    const db = getDB();
    return new Promise((resolve, reject) => {
        db.run('UPDATE portfolio SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE type = ?', [amount, type], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
