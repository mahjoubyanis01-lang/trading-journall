import type { RelationshipRow, UserRow } from "../../db/schema/index.js";
import { describeEmotion, type EmotionEstimate } from "../emotion/index.js";

/**
 * Context Engine (section 12/19). Construit la partie VOLATILE du system prompt :
 * heure locale, rythme de la relation, signaux émotionnels, mode (réponse / initiative).
 * Les souvenirs (phase 3) s'ajoutent ici.
 */
export interface ContextInput {
  user: UserRow;
  relationship: RelationshipRow;
  now?: Date;
  emotion?: EmotionEstimate | null;
  mode: { kind: "reply" } | { kind: "initiative"; reason: string };
  companionName: string;
  memories?: string[];
}

export function localTimeParts(now: Date, timeZone: string) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    fmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour ?? "12") % 24;
  const period = hour < 6 ? "nuit" : hour < 12 ? "matin" : hour < 18 ? "après-midi" : hour < 23 ? "soirée" : "nuit";
  return { weekday: parts.weekday ?? "", day: parts.day ?? "", month: parts.month ?? "", time: `${parts.hour}:${parts.minute}`, hour, period };
}

export function humanizeDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 2) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 14) return `il y a ${d} jour${d > 1 ? "s" : ""}`;
  const w = Math.round(d / 7);
  return `il y a ${w} semaine${w > 1 ? "s" : ""}`;
}

export function buildVolatileContext(input: ContextInput): string {
  const now = input.now ?? new Date();
  const t = localTimeParts(now, input.user.timezone);
  const lines: string[] = ["## Contexte du moment (change à chaque message)"];
  lines.push(`- Pour la personne, il est ${t.time}, ${t.weekday} ${t.day} ${t.month} (${t.period}).`);

  const r = input.relationship;
  if (r.interactionCount === 0) {
    lines.push("- C'est votre toute première conversation. Vous ne vous connaissez pas encore.");
  } else {
    lines.push(`- Vous avez déjà échangé ${r.interactionCount} fois.`);
    if (r.lastInteractionAt) lines.push(`- Dernier échange : ${humanizeDuration(now.getTime() - r.lastInteractionAt.getTime())}.`);
  }

  if (input.memories?.length) {
    lines.push("", "## Ce dont tu te souviens (utilise-le naturellement, sans réciter)");
    for (const m of input.memories) lines.push(`- ${m}`);
  }

  const emo = input.emotion ? describeEmotion(input.emotion) : null;
  if (emo) lines.push("", `## Ressenti\n- ${emo}`);

  lines.push("", "## Ce que tu fais maintenant");
  if (input.mode.kind === "reply") {
    lines.push("- Tu réponds au dernier message, comme dans une vraie discussion. Réagis à ce qui vient d'être dit, pas à tout l'historique.");
  } else {
    lines.push(`- Tu écris en premier, de toi-même. Raison interne : ${input.mode.reason}. Ne mentionne pas cette raison, sois naturel·le et court·e.`);
  }
  lines.push("- Ne signe pas, n'ajoute pas ton nom, pas de guillemets autour de tes messages.");
  return lines.join("\n");
}
