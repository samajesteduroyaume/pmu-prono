import * as tf from '@tensorflow/tfjs-node';

console.log('--- VÉRIFICATION TENSORFLOW.JS HW ---');
console.log('Backend actuel:', tf.getBackend());

// tfjs-node-gpu exposes more info if installed
try {
    const info = tf.engine().backend;
    console.log('Détails Backend:', info ? 'Actif' : 'Non détecté');
} catch (e) {
    console.log('Erreur lecture backend:', e.message);
}

console.log('Num GPUs:', tf.engine().backendName === 'tensorflow' ? 'Utilise le backend C++ TensorFlow (CPU par défaut)' : 'Autre backend');
