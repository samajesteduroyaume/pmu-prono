import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isMainModule(moduleUrl, argvPath = process.argv[1]) {
    return Boolean(argvPath) && path.resolve(fileURLToPath(moduleUrl)) === path.resolve(argvPath);
}
