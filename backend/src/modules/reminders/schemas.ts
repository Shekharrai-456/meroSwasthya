import { z } from 'zod';

// REQ-REMIND-007. No documented request shape in Part A.4 (backend.md §9.6
// only describes it in prose as a "demo trick") - patientId in the body is
// the only piece of information the endpoint actually needs.
export const demoFireSchema = z.object({ patientId: z.uuid() });
export type DemoFireInput = z.infer<typeof demoFireSchema>;
