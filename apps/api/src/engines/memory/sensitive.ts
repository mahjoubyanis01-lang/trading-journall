/**
 * Détection de catégories sensibles (RGPD art. 9 et assimilés). Un souvenir sensible n'est conservé
 * que si l'utilisateur l'a dit explicitement ET a activé `preferences.sensitiveMemory`.
 */
/** Motifs sans accents : le texte est replié (NFD, sans diacritiques) avant la détection. */
const CATEGORIES: { id: string; re: RegExp }[] = [
  { id: "health", re: /(?<![a-z])(maladie|malade|depress|anxi|therap|psy|medic|medoc|traitement|hopital|cancer|diabet|handicap|trouble|tdah|autis|bipolai|burn-?out|ordonnance|diagnos)/i },
  { id: "religion", re: /(?<![a-z])(religio|dieu|allah|musulman|chretien|juif|juive|bouddh|hindou|athee|priere|mosquee|eglise|synagogue|ramadan|careme)/i },
  { id: "sexuality", re: /(?<![a-z])(orientation sexuelle|homosexuel|gay|lesbienne|bisexuel|trans(?:genre)?|queer|lgbt)/i },
  { id: "politics", re: /(?<![a-z])(vote|parti politique|syndicat|militant|election|manif)/i },
  { id: "finance", re: /(?<![a-z])(salaire|dette|dettes|credit|banque|euros?|€|impots|faillite|pret|decouvert)/i },
  { id: "ethnicity", re: /(?<![a-z])(origine ethnique|ethnie|race)/i },
];

export function detectSensitive(text: string): string[] {
  const folded = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return CATEGORIES.filter((c) => c.re.test(folded)).map((c) => c.id);
}
