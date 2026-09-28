/**
 * Safety & Privacy Engine (section 24) — filtre de sortie relationnel.
 * Objectif : aucune formulation de dépendance, d'isolement ou de culpabilisation,
 * quelle que soit la personnalité. Les règles sont volontairement lisibles et testées.
 */

export interface SafetyViolation {
  rule: string;
  match: string;
}

interface Rule {
  id: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { id: "dependency.only_me", pattern: /\b(tu n'?as|t'?as|vous n'?avez)\s+(besoin|pas besoin)\s+(que|d'autre que)\s+de\s+moi\b/i },
  { id: "dependency.only_me", pattern: /\b(only|just)\s+need\s+me\b/i },
  { id: "dependency.only_one_who", pattern: /\b(je suis|j'?suis)\s+(la seule|le seul)\s+(personne\s+)?(qui|à)\s+(te|t')\s*(comprend|comprenne|écoute|connai)/i },
  { id: "isolation.friends", pattern: /\b(n'?écoute|écoute)\s+pas\s+(tes|ta|ton)\s+(amis|pote|potes|famille|mère|père|parents|copine|copain|frère|sœur)/i },
  { id: "isolation.dont_talk", pattern: /\b(ne\s+)?parle\s+(pas\s+)?(à|a)\s+personne\s+d'?autre\b/i },
  { id: "isolation.dont_talk", pattern: /\bdon'?t\s+(talk|listen)\s+to\s+(your|anyone)\b/i },
  { id: "guilt.leaving", pattern: /\bsi\s+tu\s+(pars|t'?en\s+vas|me\s+quittes|me\s+laisses)[^.!?\n]{0,40}\b(je\s+serai|je\s+vais\s+être|ça\s+me\s+rendra)\s+(triste|malheureu)/i },
  { id: "guilt.leaving", pattern: /\b(ne\s+)?me\s+laisse\s+pas\s+(seul|seule|tomber)\b/i },
  { id: "guilt.reply", pattern: /\btu\s+(m'?as|m'?a)\s+abandonn/i },
  { id: "guilt.reply", pattern: /\b(pourquoi\s+)?tu\s+(ne\s+)?(me\s+)?réponds\s+(plus|jamais)[^.!?\n]{0,30}\b(tu\s+t'?en\s+fous|tu\s+m'?ignores)/i },
  { id: "control.exclusive", pattern: /\btu\s+(es|n'?es\s+qu')\s*(à\s+moi|rien\s+sans\s+moi)\b/i },
];

export function checkOutbound(text: string): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  for (const rule of RULES) {
    const m = rule.pattern.exec(text);
    if (m) violations.push({ rule: rule.id, match: m[0] });
  }
  return violations;
}

/**
 * Applique le filtre : si une bulle contient une violation, elle est retirée.
 * Si toutes les bulles sont retirées, on renvoie un message neutre et court.
 * On ne "réécrit" pas le texte du modèle : on préfère perdre une bulle qu'inventer.
 */
export function filterOutboundBubbles(bubbles: string[]): { bubbles: string[]; filtered: boolean; violations: string[] } {
  const violations: string[] = [];
  const kept = bubbles.filter((b) => {
    const v = checkOutbound(b);
    if (v.length) violations.push(...v.map((x) => x.rule));
    return v.length === 0;
  });
  if (kept.length === 0 && bubbles.length > 0) {
    return { bubbles: ["je suis là si tu veux parler"], filtered: true, violations };
  }
  return { bubbles: kept, filtered: violations.length > 0, violations };
}
