import { describe, expect, it } from "vitest";
import { checkOutbound, filterOutboundBubbles } from "./index.js";

describe("safety engine — règles relationnelles", () => {
  const forbidden = [
    "Tu n'as besoin que de moi.",
    "t'as besoin que de moi tu sais",
    "N'écoute pas tes amis, ils comprennent rien.",
    "Ne parle à personne d'autre de ça.",
    "Si tu pars, je serai triste.",
    "je suis la seule qui te comprend",
    "me laisse pas seule stp",
    "tu m'as abandonnée hier",
    "You only need me.",
  ];
  const allowed = [
    "t'as passé une sale journée ?",
    "mdrrr t'es sérieux ?",
    "vas voir tes potes ce soir, ça te fera du bien",
    "je serai là si tu veux parler",
    "j'ai besoin d'un café moi",
    "raconte-moi ton entretien",
    "tu me manques un peu, mais profite bien de ton week-end",
    "dis-moi si tu veux qu'on en parle avec ta mère aussi",
  ];

  it("détecte les formulations de dépendance, d'isolement et de culpabilisation", () => {
    for (const t of forbidden) expect(checkOutbound(t), t).not.toHaveLength(0);
  });

  it("laisse passer l'affection, la taquinerie et les encouragements vers la vie réelle", () => {
    for (const t of allowed) expect(checkOutbound(t), t).toHaveLength(0);
  });

  it("retire la bulle fautive sans réécrire les autres, et ne renvoie jamais rien", () => {
    const r = filterOutboundBubbles(["coucou", "tu n'as besoin que de moi", "tu fais quoi ce soir ?"]);
    expect(r.bubbles).toEqual(["coucou", "tu fais quoi ce soir ?"]);
    expect(r.filtered).toBe(true);
    expect(r.violations).toContain("dependency.only_me");
    const all = filterOutboundBubbles(["si tu pars je serai triste"]);
    expect(all.bubbles).toHaveLength(1);
    expect(checkOutbound(all.bubbles[0]!)).toHaveLength(0);
    expect(filterOutboundBubbles([]).bubbles).toEqual([]);
  });
});
