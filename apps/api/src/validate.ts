import type { ZodType } from "zod";
import { badRequest } from "./errors.js";

export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest("validation_error", "Données invalides", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}
