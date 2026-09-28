/**
 * Emotional Intelligence Engine (section 8) — estimateur heuristique de premier niveau.
 * Il ne diagnostique rien : il produit des états PROBABILISTES à partir de signaux faibles
 * (lexique, ponctuation, longueur) pour (a) router vers un modèle plus attentif et
 * (b) donner au modèle une indication prudente. Un classifieur LLM (tâche emotion.classify)
 * pourra le remplacer/compléter pour les messages ambigus.
 */
export type EmotionalState = "neutral" | "positive" | "tired" | "stressed" | "sad" | "angry";
export type EmotionEstimate = { states: Record<EmotionalState, number>; intensity: number; cues: string[] };

/** `\b` ignore les lettres accentuées : on utilise des lookarounds Unicode. */
const W = (alts: string) => new RegExp(`(?<!\\p{L})(?:${alts})(?!\\p{L})`, "iu");

const LEXICON: { state: EmotionalState; weight: number; re: RegExp }[] = [
  { state: "positive", weight: 0.5, re: W("trop bien|génial|super|content|contente|heureux|heureuse|hâte|excellent|parfait|mdr+|lol|ptdr|haha+|jsuis chaud|kiff") },
  { state: "positive", weight: 0.3, re: /[😂🤣😍❤️🥰😁😊🎉🔥]/u },
  { state: "tired", weight: 0.6, re: W("crevé|crevée|épuisé|épuisée|fatigué|fatiguée|pas dormi|insomnie|mort de fatigue|plus d'énergie|k\\.?o\\.?") },
  { state: "stressed", weight: 0.6, re: W("stress|stressé|stressée|angoiss\\p{L}*|anxieu\\p{L}*|paniqu\\p{L}*|pression|deadline|j'?y arrive pas|trop de trucs|débordé|débordée") },
  { state: "sad", weight: 0.7, re: W("triste|déprim\\p{L}*|seul|seule|pleur\\p{L}*|nul|nulle|à quoi bon|j'en peux plus|vide|abandonn\\p{L}*|personne ne") },
  { state: "sad", weight: 0.4, re: /[😢😭💔🙁😞]/u },
  { state: "angry", weight: 0.6, re: W("énervé|énervée|furax|vénère|rage|ça me saoule|marre|putain|fait chier|insupportable") },
  { state: "angry", weight: 0.3, re: /[😡🤬]/u },
];

export function estimateEmotion(text: string): EmotionEstimate {
  const scores: Record<EmotionalState, number> = { neutral: 0.5, positive: 0, tired: 0, stressed: 0, sad: 0, angry: 0 };
  const cues: string[] = [];
  for (const { state, weight, re } of LEXICON) {
    const m = re.exec(text);
    if (m) {
      scores[state] += weight;
      cues.push(m[0]);
    }
  }
  const exclam = (text.match(/!/g) ?? []).length;
  const caps = text.length > 12 && text === text.toUpperCase() && /[A-Z]/.test(text);
  const ellipsis = /\.{3}|…/.test(text);
  if (exclam >= 2) {
    scores.positive += 0.15;
    scores.angry += 0.1;
  }
  if (caps) scores.angry += 0.25;
  if (ellipsis) {
    scores.tired += 0.1;
    scores.sad += 0.1;
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const states = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.round((v / total) * 100) / 100])) as Record<EmotionalState, number>;
  // La fatigue seule n'est pas un signal fort ; tristesse, stress et colère le sont.
  const negative = states.sad + states.stressed + states.angry + states.tired * 0.5;
  const intensity = Math.min(1, Math.max(negative, states.positive) * 1.2);
  return { states, intensity: Math.round(intensity * 100) / 100, cues };
}

/** Rendu prudent pour le prompt : jamais présenté comme une certitude. */
export function describeEmotion(e: EmotionEstimate): string | null {
  const ranked = Object.entries(e.states)
    .filter(([k]) => k !== "neutral")
    .sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top || top[1] < 0.3) return null;
  const labels: Record<EmotionalState, string> = { neutral: "neutre", positive: "de bonne humeur", tired: "fatigué·e", stressed: "stressé·e", sad: "pas bien", angry: "agacé·e" };
  return `Signal faible et incertain : la personne semble peut-être ${labels[top[0] as EmotionalState]} (probabilité ~${Math.round(top[1] * 100)}%). N'affirme rien, adapte juste ton ton et, si c'est naturel, demande.`;
}
