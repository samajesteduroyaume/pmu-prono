import { z } from 'zod';

export const syncSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    days: z.number().int().min(1).max(365).optional().default(1)
});

export const portfolioUpdateSchema = z.object({
    type: z.enum(['shadow', 'reel']).default('shadow'),
    amount: z.number()
});
