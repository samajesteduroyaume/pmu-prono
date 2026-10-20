/** Load the native CPU backend when available, otherwise use pure TensorFlow.js. */
export async function loadTensorFlowBackend(importer = specifier => import(specifier)) {
    let nativeError;
    try {
        return { tf: await importer('@tensorflow/tfjs-node'), backend: 'native' };
    } catch (error) {
        nativeError = error;
    }

    try {
        return { tf: await importer('@tensorflow/tfjs'), backend: 'javascript', nativeError };
    } catch (javascriptError) {
        const error = new Error(`TensorFlow.js indisponible (natif: ${nativeError?.message || 'échec'}; JavaScript: ${javascriptError.message}).`);
        error.cause = javascriptError;
        throw error;
    }
}
