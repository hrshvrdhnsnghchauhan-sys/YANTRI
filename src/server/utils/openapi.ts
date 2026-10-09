/**
 * Zod → OpenAPI schema generation (issue 19).
 *
 * Converts the runtime validation schemas into OpenAPI component schemas so the
 * published spec can never drift from what the API actually accepts. Generation
 * is best-effort: on any failure it returns {} and the hand-written schemas in
 * swagger.ts remain the fallback.
 */
import { z } from "zod";
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import {
  memoryCreateSchema,
  reminderCreateSchema,
  recordCreateSchema,
  recordPatchSchema,
  profileCreateSchema,
  registerSchema,
  loginSchema,
  tavilySearchSchema,
  googleEventSchema,
  googleEmailSchema,
} from "./validation";

extendZodWithOpenApi(z);

export function generateZodSchemas(): Record<string, unknown> {
  try {
    const registry = new OpenAPIRegistry();
    registry.register("MemoryCreate", memoryCreateSchema);
    registry.register("ReminderCreate", reminderCreateSchema);
    registry.register("UserRecordCreate", recordCreateSchema);
    registry.register("UserRecordPatch", recordPatchSchema);
    registry.register("UserProfile", profileCreateSchema);
    registry.register("RegisterInput", registerSchema);
    registry.register("LoginInput", loginSchema);
    registry.register("TavilySearch", tavilySearchSchema);
    registry.register("GoogleEventCreate", googleEventSchema);
    registry.register("GoogleEmailSend", googleEmailSchema);

    const generator = new OpenApiGeneratorV3(registry.definitions);
    const doc = generator.generateComponents() as any;
    return doc?.components?.schemas ?? {};
  } catch {
    return {};
  }
}
