import { z } from 'zod';

const isCalendarDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const paginationInteger = (defaultValue, max) => z.union([z.string(), z.number()])
    .transform(value => {
        if (value === '') return defaultValue;
        if (typeof value === 'string' && !/^\d+$/.test(value)) return Number.NaN;
        return Number(value);
    })
    .refine(value => Number.isSafeInteger(value) && value >= 1 && value <= max, {
        message: `Doit être un entier entre 1 et ${max}`
    });

export const getCoursesQuerySchema = z.object({
    date: z.string().optional().transform(val => {
        if (!val || val === 'null' || val === 'undefined') return undefined;
        return val;
    }).refine(val => !val || val === 'all' || isCalendarDate(val), {
        message: "Format de date invalide (YYYY-MM-DD ou 'all')"
    }),
    discipline: z.string().max(50).optional(),
    hippodrome: z.string().max(100).optional(),
    page: paginationInteger(1, Math.floor(Number.MAX_SAFE_INTEGER / 500)).optional().default(1),
    limit: paginationInteger(50, 500).optional().default(50)
});

export const courseIdParamSchema = z.object({
    id: z.union([z.string(), z.number()]).transform(val => {
        const text = String(val);
        return /^\d+$/.test(text) ? Number(text) : Number.NaN;
    }).refine(val => Number.isSafeInteger(val) && val > 0, {
        message: "ID de course invalide"
    })
});

