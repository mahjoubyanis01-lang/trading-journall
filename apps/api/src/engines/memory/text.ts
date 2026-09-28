/** Utilitaires texte : normalisation, tokenisation FR, similarité. */
const STOP = new Set(
  "le la les un une des du de d l et ou mais donc or ni car je tu il elle on nous vous ils elles me te se moi toi lui leur y en ne pas plus jamais que qui quoi dont ou ce cet cette ces mon ma mes ton ta tes son sa ses notre votre leur leurs a ai as au aux avec dans par pour sur sous chez vers est sont suis es etes sommes ete etre avoir fait faire va vais vas vont tres trop bien mal oui non si ca cela ceci c j m n s t qu the of to and in is it".split(" "),
);

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function tokenize(s: string): string[] {
  return fold(s)
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/[\s'-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Score d'affinité lexicale d'une requête vers un texte (0..1), avec préfixes (stem grossier). */
export function overlapScore(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0;
  const tt = tokenize(text);
  if (tt.length === 0) return 0;
  let hits = 0;
  for (const q of queryTokens) {
    const stem = q.slice(0, Math.max(4, q.length - 2));
    if (tt.some((t) => t === q || (q.length >= 5 && t.startsWith(stem)))) hits++;
  }
  return hits / queryTokens.length;
}
