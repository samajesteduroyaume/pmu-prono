/** Parse an optional day window; malformed values must not become all-history queries. */
export function parseDays(value, defaultDays = null) {
    if (value === undefined || value === null || value === '') return defaultDays;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3650) return undefined;
    return parsed;
}
