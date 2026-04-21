import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../../utils/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

let isOptimizing = false;

export async function optimize(req, res) {
    if (isOptimizing) {
        return res.status(429).json({ success: false, message: "Optimisation déjà en cours." });
    }

    isOptimizing = true;
    logger.header("Lancement de l'optimiseur de poids via API...");

    const scriptPath = path.join(PROJECT_ROOT, 'src/scripts/tune_weights.mjs');

    // On lance en arrière-plan car c'est long
    exec(`node ${scriptPath}`, (error, stdout, stderr) => {
        isOptimizing = false;
        if (error) {
            logger.error(`Erreur Optimiseur: ${error.message}`);
            return;
        }
        logger.success("Optimisation des poids terminée avec succès.");
    });

    res.json({ 
        success: true, 
        message: "L'optimiseur de poids a été lancé en arrière-plan. Cela peut prendre plusieurs minutes." 
    });
}

export function getStatus(req, res) {
    res.json({ isOptimizing });
}
