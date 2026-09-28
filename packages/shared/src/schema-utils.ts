import { z } from "zod";

/**
 * Zod 4 : `.partial()` conserve les `.default()` des champs, ce qui réinjecte des valeurs
 * par défaut dans un PATCH partiel. On construit donc explicitement :
 * - `withDefaults(shape, defaults)` : schéma complet (parse d'un objet vide → objet complet) ;
 * - `patchOf(shape)` : schéma de mise à jour (champs absents → absents).
 */
export function withDefaults<S extends z.ZodRawShape, D extends { [K in keyof S]: z.output<S[K]> }>(shape: S, defaults: D) {
  const out = {} as { [K in keyof S]: z.ZodDefault<S[K]> };
  for (const key of Object.keys(shape) as (keyof S)[]) {
    out[key] = (shape[key] as z.ZodType).default(defaults[key] as never) as unknown as z.ZodDefault<S[keyof S]>;
  }
  return z.object(out);
}

export function patchOf<S extends z.ZodRawShape>(shape: S) {
  const out = {} as { [K in keyof S]: z.ZodOptional<S[K]> };
  for (const key of Object.keys(shape) as (keyof S)[]) {
    out[key] = (shape[key] as z.ZodType).optional() as unknown as z.ZodOptional<S[keyof S]>;
  }
  return z.object(out);
}
