/**
 * Découpe une réponse en plusieurs bulles sur les séparateurs « --- » (ligne seule),
 * en tolérant les variantes. Ignore les bulles vides. Retire un éventuel préfixe
 * « Nom : » ou des guillemets englobants que certains modèles ajoutent.
 */
export function splitBubbles(text: string, companionName?: string): string[] {
  const parts = text.split(/\r?\n[ \t]*-{3,}[ \t]*(?:\r?\n|$)/);
  const out: string[] = [];
  for (let p of parts) {
    p = p.trim();
    if (companionName) {
      const prefix = new RegExp(`^${escapeRegExp(companionName)}\\s*[:：]\\s*`, "i");
      p = p.replace(prefix, "");
    }
    if (/^["«“].*["»”]$/s.test(p) && p.length > 2) p = p.slice(1, -1).trim();
    if (p.length > 0) out.push(p);
  }
  return out;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Délai « naturel » entre deux bulles : proportionnel à la longueur, borné. */
export function bubbleDelayMs(text: string, factor = 1): number {
  return Math.min(1800, 350 + text.length * 25) * factor;
}
