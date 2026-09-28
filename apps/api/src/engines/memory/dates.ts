/**
 * Résolution de dates relatives en français ("vendredi", "demain", "dans 3 jours", "ce week-end",
 * "lundi prochain", "le 12", "12/10") vers une date locale. Filet de sécurité derrière le modèle,
 * qui reçoit déjà la date du jour et doit renvoyer une date ISO quand il le peut.
 */
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

function fold(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Composantes de date locales (année, mois 1-12, jour, jour de semaine 0-6) dans un fuseau. */
export function localParts(now: Date, timeZone: string) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric", weekday: "short" });
  }
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "Sun");
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), weekday };
}

/** Construit une Date UTC "à midi" du jour local demandé (évite les décalages de fuseau sur les dates entières). */
export function dateAtNoonUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDays(y: number, m: number, d: number, n: number) {
  const t = dateAtNoonUTC(y, m, d);
  t.setUTCDate(t.getUTCDate() + n);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), weekday: t.getUTCDay() };
}

export function resolveRelativeDate(input: string, now: Date, timeZone: string): Date | null {
  let s = fold(input).replace(/^(?:le |ce )?(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(?=\d)/, "le "); // "vendredi 28 septembre" → "le 28 septembre"
  s = s.replace(/\s+(?:a|à|vers)\s+\d{1,2}\s*h(?:\d{2})?$/, ""); // "… à 14h"
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2}))?/.exec(s);
  if (iso) {
    const d = dateAtNoonUTC(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const today = localParts(now, timeZone);
  const mk = (p: { year: number; month: number; day: number }) => dateAtNoonUTC(p.year, p.month, p.day);

  if (/^(aujourd ?hui|ce soir|ce matin|cet apres-?midi|tout a l heure)$/.test(s)) return mk(today);
  if (/^demain/.test(s)) return mk(addDays(today.year, today.month, today.day, 1));
  if (/^apres-?demain/.test(s)) return mk(addDays(today.year, today.month, today.day, 2));
  const inDays = /^dans (\d+) jours?$/.exec(s);
  if (inDays) return mk(addDays(today.year, today.month, today.day, Number(inDays[1])));
  const inWeeks = /^dans (\d+) semaines?$/.exec(s);
  if (inWeeks) return mk(addDays(today.year, today.month, today.day, 7 * Number(inWeeks[1])));
  if (/^(ce )?week-?end$/.test(s)) {
    const delta = (6 - today.weekday + 7) % 7;
    return mk(addDays(today.year, today.month, today.day, delta));
  }
  const wd = /^(?:le |ce )?(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)( prochain| prochaine)?$/.exec(s);
  if (wd) {
    const target = DAYS.indexOf(wd[1]!);
    let delta = (target - today.weekday + 7) % 7;
    if (wd[2]) delta = delta === 0 ? 7 : delta; // "lundi prochain" un lundi = dans 7 jours
    return mk(addDays(today.year, today.month, today.day, delta));
  }
  const dm = /^(?:le )?(\d{1,2})(?:er)?(?: (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre))?(?: (\d{4}))?$/.exec(s);
  if (dm) {
    const day = Number(dm[1]);
    let month = dm[2] ? MONTHS.indexOf(dm[2]) + 1 : today.month;
    let year = dm[3] ? Number(dm[3]) : today.year;
    if (!dm[2] && day < today.day) month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (!dm[3] && dm[2] && (month < today.month || (month === today.month && day < today.day))) year += 1;
    return mk({ year, month, day });
  }
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (slash) {
    let year = slash[3] ? Number(slash[3]) : today.year;
    if (year < 100) year += 2000;
    const month = Number(slash[2]);
    const day = Number(slash[1]);
    if (!slash[3] && (month < today.month || (month === today.month && day < today.day))) year += 1;
    return mk({ year, month, day });
  }
  return null;
}

export function formatLocalDate(d: Date, timeZone: string, locale = "fr-FR"): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Première expression de date relative trouvée dans un texte libre (« vendredi j'ai un entretien » → « vendredi »). */
export function findRelativeDateInText(text: string): string | null {
  const s = fold(text);
  const m = /(?<![a-z])(apres-?demain|demain|ce week-?end|dans \d+ (?:jours?|semaines?)|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?: prochain)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|le \d{1,2}(?: (?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre))?)(?![a-z])/.exec(s);
  return m ? m[1]! : null;
}
