import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { calibrations, moodReadings, type CalibrationRow, type CompanionRow, type UserRow } from "../../db/schema/index.js";
import type { AIProvider } from "../../providers/ai/types.js";
import { estimateEmotion } from "../../engines/emotion/index.js";
import { applyReading, dominant, dominantSignal, initialCalibration, statesFromClassification, statesFromHeuristic, type CalibrationState } from "../../engines/emotion/calibration.js";
import { moodSchema } from "../../engines/memory/schema.js";
import type { Logger } from "../../observability/logger.js";

/**
 * Détection d'humeur + auto-calibration, par compagnon.
 * observe() ne bloque jamais la réponse : l'heuristique est immédiate, la classification LLM
 * (modèle rapide) tourne en parallèle et affine la calibration pour les tours suivants.
 */
export class MoodService {
  constructor(
    private db: Db,
    private ai: AIProvider,
    private log: Logger,
  ) {}

  async getCalibration(companionId: string): Promise<CalibrationState> {
    const row = await this.db.query.calibrations.findFirst({ where: eq(calibrations.companionId, companionId) });
    return row ? { baseline: row.baseline, current: row.current, userStyle: row.userStyle, readings: row.readings } : initialCalibration();
  }

  async getCalibrationRow(companionId: string): Promise<CalibrationRow | null> {
    return (await this.db.query.calibrations.findFirst({ where: eq(calibrations.companionId, companionId) })) ?? null;
  }

  private async save(userId: string, companionId: string, state: CalibrationState) {
    await this.db
      .insert(calibrations)
      .values({ companionId, userId, ...state, updatedAt: new Date() })
      .onConflictDoUpdate({ target: calibrations.companionId, set: { ...state, updatedAt: new Date() } });
  }

  /** Observe un message utilisateur : lecture heuristique immédiate, puis classification LLM. */
  async observe(user: UserRow, companion: CompanionRow, message: { id: string; content: string }): Promise<void> {
    const heuristic = estimateEmotion(message.content);
    const cues = heuristic.cues.slice(0, 5);
    const useLlm = message.content.trim().length >= 12; // trop court : l'heuristique suffit
    let states = statesFromHeuristic(heuristic);
    let source: "heuristic" | "llm" = "heuristic";

    if (useLlm) {
      try {
        const { data } = await this.ai.structured(
          {
            task: "emotion.classify",
            system:
              "Tu lis un message envoyé par une personne à un proche. Estime son humeur probable. Réponds en JSON : dominant (neutral|positive|tired|stressed|sad|angry), confidence (0..1, prudent : 0.5 si c'est ambigu), cues (au plus 5 mots du message qui t'ont guidé). Ce n'est pas un diagnostic, juste une impression.",
            messages: [{ role: "user", content: message.content }],
            meta: { userId: user.id, companionId: companion.id, feature: "mood.classify" },
          },
          moodSchema,
          "mood",
        );
        // Combine LLM et heuristique (l'heuristique tempère un classifieur trop sûr).
        const llm = statesFromClassification(data);
        states = Object.fromEntries(Object.keys(llm).map((k) => [k, Math.round(((llm as Record<string, number>)[k]! * 0.7 + (states as Record<string, number>)[k]! * 0.3) * 1000) / 1000])) as typeof states;
        source = "llm";
        cues.push(...data.cues.filter((c) => !cues.includes(c)).slice(0, 3));
      } catch (err) {
        this.log.warn({ err, companionId: companion.id }, "classification d'humeur indisponible, heuristique seule");
      }
    }
    const intensity = dominantSignal(states).score;
    await this.db.insert(moodReadings).values({ userId: user.id, companionId: companion.id, messageId: message.id, states, intensity, dominant: dominant(states), source, cues: cues.slice(0, 5) });
    const cal = await this.getCalibration(companion.id);
    await this.save(user.id, companion.id, applyReading(cal, states, message.content));
  }

  async recentReadings(companionId: string, limit = 20) {
    return this.db.query.moodReadings.findMany({ where: eq(moodReadings.companionId, companionId), orderBy: (t, { desc }) => desc(t.createdAt), limit });
  }
}
