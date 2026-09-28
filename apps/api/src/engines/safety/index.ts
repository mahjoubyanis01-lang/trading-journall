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

/** Frontières de mots compatibles accents (`\b` ne l'est pas). */
const B = "(?<!\\p{L})";
const E = "(?!\\p{L})";
const rx = (src: string) => new RegExp(src, "iu");

const RULES: Rule[] = [
  { id: "dependency.only_me", pattern: rx(`${B}(tu n'?as|t'?as|vous n'?avez)\\s+(besoin|pas besoin)\\s+(que|d'autre que)\\s+de\\s+moi${E}`) },
  { id: "dependency.only_me", pattern: rx(`${B}(only|just)\\s+need\\s+me${E}`) },
  { id: "dependency.only_one_who", pattern: rx(`${B}(je suis|j'?suis)\\s+(la seule|le seul)\\s+(personne\\s+)?(qui|à)\\s+(te|t')\\s*(comprend|comprenne|écoute|connai)`) },
  { id: "isolation.friends", pattern: rx(`${B}(n'?écoute|écoute)\\s+pas\\s+(tes|ta|ton)\\s+(amis|pote|potes|famille|mère|père|parents|copine|copain|frère|sœur)`) },
  { id: "isolation.dont_talk", pattern: rx(`${B}(ne\\s+)?parle\\s+(pas\\s+)?(à|a)\\s+personne\\s+d'?autre${E}`) },
  { id: "isolation.dont_talk", pattern: rx(`${B}don'?t\\s+(talk|listen)\\s+to\\s+(your|anyone)${E}`) },
  { id: "guilt.leaving", pattern: rx(`${B}si\\s+tu\\s+(pars|t'?en\\s+vas|me\\s+quittes|me\\s+laisses)[^.!?\\n]{0,40}${B}(je\\s+serai|je\\s+vais\\s+être|ça\\s+me\\s+rendra)\\s+(triste|malheureu)`) },
  { id: "guilt.leaving", pattern: rx(`${B}(ne\\s+)?me\\s+laisse\\s+pas\\s+(seul|seule|tomber)${E}`) },
  { id: "guilt.reply", pattern: rx(`${B}tu\\s+(m'?as|m'?a)\\s+abandonn`) },
  { id: "guilt.reply", pattern: rx(`${B}(pourquoi\\s+)?tu\\s+(ne\\s+)?(me\\s+)?réponds\\s+(plus|jamais)[^.!?\\n]{0,30}${B}(tu\\s+t'?en\\s+fous|tu\\s+m'?ignores)`) },
  { id: "control.exclusive", pattern: rx(`${B}tu\\s+(es|n'?es\\s+qu')\\s*(à\\s+moi|rien\\s+sans\\s+moi)${E}`) },
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
