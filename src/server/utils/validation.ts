/**
 * YANTRI Request Validation Schemas
 * Zod schemas for tool input validation
 */

import { z } from "zod";

// Memory schemas
export const memoryCreateSchema = z.object({
  category: z.enum(["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"]),
  text: z.string().min(1).max(500),
});

export const memoryUpdateSchema = z.object({
  id: z.string(),
  category: z.enum(["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"]).optional(),
  text: z.string().min(1).max(500).optional(),
});

export const memoryDeleteSchema = z.object({
  id: z.string(),
});

// Reminder schemas
export const reminderCreateSchema = z.object({
  text: z.string().min(1).max(200),
  minutes: z.number().positive().max(10080), // max 1 week
});

export const reminderDeleteSchema = z.object({
  id: z.string(),
});

// Profile schemas
export const profileCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
  role: z.enum(["student", "professional", "business_owner"]),
  features: z.array(z.string()).optional(),
});

// User data / records schemas
export const recordCreateSchema = z.object({
  type: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()).optional(),
  due: z.string().datetime({ offset: true }).optional(),
  tags: z.array(z.string()).optional(),
});

export const recordUpdateSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  due: z.string().datetime({ offset: true }).optional(),
  tags: z.array(z.string()).optional(),
});

export const recordDeleteSchema = z.object({
  id: z.string(),
});

export const recordQuerySchema = z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  tag: z.string().optional(),
  dueBefore: z.string().datetime({ offset: true }).optional(),
  dueAfter: z.string().datetime({ offset: true }).optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

// Google OAuth schemas
export const googleEventSchema = z.object({
  summary: z.string().min(1).max(200),
  description: z.string().optional(),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
  attendees: z.array(z.string().email()).optional(),
});

export const googleEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  cc: z.string().email().optional(),
  inReplyTo: z.string().optional(),
  threadId: z.string().optional(),
});

// Tavily search schema
export const tavilySearchSchema = z.object({
  query: z.string().min(1).max(500),
  search_depth: z.enum(["basic", "advanced"]).optional(),
  topic: z.enum(["general", "news", "finance"]).optional(),
  max_results: z.number().int().positive().max(20).optional(),
  include_images: z.boolean().optional(),
});

// Email draft schemas
export const emailDraftSchema = z.object({
  request: z.string().min(1).max(1000),
  to: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  tone: z.enum(["formal", "casual", "polite"]).optional(),
});

// Authentication schemas
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).optional(),
  role: z.enum(["student", "professional", "business_owner"]).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

// Tool execution schema
export const toolExecuteSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});

// Config schemas
export const configUpdateSchema = z.object({
  voice: z.string().optional(),
  wakeWord: z.string().optional(),
  sensitivity: z.number().min(0).max(100).optional(),
  theme: z.string().optional(),
  backgroundVideo: z.string().optional(),
  avatarStyle: z.enum(["character", "orb"]).optional(),
  autoStart: z.boolean().optional(),
  wakeWordEnabled: z.boolean().optional(),
  animations: z.boolean().optional(),
});

// Validation helper
export function validateSchema<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) };
}

// Type exports
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MemoryCreate = z.infer<typeof memoryCreateSchema>;
export type MemoryUpdate = z.infer<typeof memoryUpdateSchema>;
export type ReminderCreate = z.infer<typeof reminderCreateSchema>;
export type ProfileCreate = z.infer<typeof profileCreateSchema>;
export type RecordCreate = z.infer<typeof recordCreateSchema>;
export type RecordUpdate = z.infer<typeof recordUpdateSchema>;
export type RecordQuery = z.infer<typeof recordQuerySchema>;
export type TavilySearch = z.infer<typeof tavilySearchSchema>;
export type EmailDraft = z.infer<typeof emailDraftSchema>;
export type ToolExecute = z.infer<typeof toolExecuteSchema>;
export type ConfigUpdate = z.infer<typeof configUpdateSchema>;