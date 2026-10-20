import assert from 'node:assert/strict';
import {
    getModelCompatibilityReason,
    ML_FEATURE_SCHEMA_VERSION,
    ML_TRAINING_METHOD
} from '../ml/model_compatibility.mjs';

assert.equal(getModelCompatibilityReason(null), 'unverified-training-provenance');
assert.equal(getModelCompatibilityReason({ trainingMethod: ML_TRAINING_METHOD }), 'unsupported-feature-schema');
assert.equal(getModelCompatibilityReason({
    trainingMethod: ML_TRAINING_METHOD,
    featureSchemaVersion: ML_FEATURE_SCHEMA_VERSION - 1
}), 'unsupported-feature-schema');
assert.equal(getModelCompatibilityReason({
    trainingMethod: ML_TRAINING_METHOD,
    featureSchemaVersion: ML_FEATURE_SCHEMA_VERSION
}), null);

console.log('✓ Compatibilité ML — provenance et schéma de variables contrôlés');
