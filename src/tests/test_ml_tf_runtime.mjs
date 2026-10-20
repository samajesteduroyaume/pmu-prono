import assert from 'node:assert/strict';
import { loadTensorFlowBackend } from '../ml/tensorflow_runtime.mjs';

const tfStub = { sequential: () => null };
const nativeRuntime = await loadTensorFlowBackend(async specifier => {
    assert.equal(specifier, '@tensorflow/tfjs-node');
    return tfStub;
});
assert.equal(nativeRuntime.tf, tfStub);
assert.equal(nativeRuntime.backend, 'native');

const attempted = [];
const javascriptRuntime = await loadTensorFlowBackend(async specifier => {
    attempted.push(specifier);
    if (specifier === '@tensorflow/tfjs-node') throw new Error('native binding missing');
    return tfStub;
});
assert.deepEqual(attempted, ['@tensorflow/tfjs-node', '@tensorflow/tfjs']);
assert.equal(javascriptRuntime.tf, tfStub);
assert.equal(javascriptRuntime.backend, 'javascript');
assert.match(javascriptRuntime.nativeError.message, /native binding missing/);

await assert.rejects(
    loadTensorFlowBackend(async () => { throw new Error('backend unavailable'); }),
    /TensorFlow.js indisponible/
);

console.log('✓ Runtime TensorFlow — natif prioritaire et fallback JavaScript vérifiés');
