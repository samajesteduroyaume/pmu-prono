/** States meaning the horse did not start; post-start outcomes remain runners. */
export const NON_RUNNER_STATUSES = Object.freeze([
    'NON_PARTANT',
    'NON-PARTANT',
    'NON PARTANT',
    'FORFAIT',
    'NP'
]);

export const NON_RUNNER_STATUS_SQL = NON_RUNNER_STATUSES.map(status => `'${status}'`).join(', ');

export function isNonRunnerStatus(status) {
    return NON_RUNNER_STATUSES.includes(String(status || '').trim().toUpperCase());
}
