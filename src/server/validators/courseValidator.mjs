import { z } from 'zod';

export const getCoursesQuerySchema = z.object({
    date: z.string().optional().transform(val => {
        if (!val || val === 'null' || val === 'undefined') return undefined;
        return val;
    }).refine(val => !val || val === 'all' || /^\d{4}-\d{2}-\d{2}$/.test(val), {
        message: "Format de date invalide (YYYY-MM-DD ou 'all')"
    }),
    discipline: z.string().max(50).optional(),
    hippodrome: z.string().max(100).optional(),
    page: z.union([z.string(), z.number()]).optional().transform(val => {
        if (!val) return 1;
        const parsed = parseInt(String(val), 10);
        return isNaN(parsed) || parsed < 1 ? 1 : parsed;
    }),
    limit: z.union([z.string(), z.number()]).optional().transform(val => {
        if (!val) return 50;
        const parsed = parseInt(String(val), 10);
        return isNaN(parsed) || parsed < 1 ? 50 : Math.min(parsed, 500);
    })
});

export const courseIdParamSchema = z.object({
    id: z.union([z.string(), z.number()]).transform(val => parseInt(String(val), 10)).refine(val => !isNaN(val) && val > 0, {
        message: "ID de course invalide"
    })
});

