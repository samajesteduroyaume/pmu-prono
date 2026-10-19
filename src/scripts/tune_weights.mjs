import { isMainModule } from '../utils/isMainModule.mjs';

if (isMainModule(import.meta.url)) {
    console.error(
        'Optimisation annulée : le tuner historique réévaluait les courses avec des variables recalculées après le départ. ' +
        'Il ne peut pas produire de poids fiables tant qu’un tuner prospectif basé sur des snapshots séparés n’est pas disponible.'
    );
    process.exitCode = 1;
}
