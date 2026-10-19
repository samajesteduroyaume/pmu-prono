import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const legacyModelDirectory = path.join(moduleDirectory, 'model');

// Keep the legacy location for existing direct installs. Deployments should
// set ML_MODEL_DIR to a persistent path (Docker Compose uses /app/data/ml-model).
export const MODEL_PATH = path.resolve(process.env.ML_MODEL_DIR || legacyModelDirectory);
