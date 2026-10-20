export const ML_FEATURE_SCHEMA_VERSION = 2;
export const ML_TRAINING_METHOD = 'immutable-pre-race-feature-snapshots';

/** Return a status reason when a saved model cannot safely consume current features. */
export function getModelCompatibilityReason(metadata) {
    if (metadata?.trainingMethod !== ML_TRAINING_METHOD) return 'unverified-training-provenance';
    if (metadata?.featureSchemaVersion !== ML_FEATURE_SCHEMA_VERSION) return 'unsupported-feature-schema';
    return null;
}
