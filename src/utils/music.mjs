const PERFORMANCE_TOKEN = /(DIST|DAI|DIS|ARR|RET|DA|[0-9]+[a-z]?|D|T|A|R)/gi;
const FAULT_TOKENS = new Set(['DIST', 'DAI', 'DIS', 'ARR', 'RET', 'DA', 'D', 'T', 'A', 'R']);

/** Extract PMU music tokens with longer fault codes matched before their prefixes. */
export function extractMusicPerformances(music) {
    if (typeof music !== 'string' || !music) return [];
    return music.replace(/\(\d+\)/g, '').match(PERFORMANCE_TOKEN) || [];
}

export function parseMusicPerformance(token) {
    const normalized = String(token || '').toUpperCase();
    if (FAULT_TOKENS.has(normalized)) return { value: normalized, type: '' };
    const match = normalized.match(/^(\d+)([APMHCRS])?$/);
    return match
        ? { value: match[1], type: (match[2] || '').toLowerCase() }
        : { value: normalized, type: '' };
}
