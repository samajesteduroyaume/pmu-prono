import { z } from 'zod';

const isCalendarDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const syncSchema = z.object({
    date: z.string().refine(isCalendarDate, 'Date invalide (YYYY-MM-DD)').optional(),
    days: z.number().int().min(1).max(365).optional().default(1)
});

export const portfolioUpdateSchema = z.object({
    type: z.enum(['shadow', 'reel']).default('shadow'),
    amount: z.number().finite()
});
