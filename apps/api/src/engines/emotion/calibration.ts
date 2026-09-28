import type { CalibrationRow, MoodStates, UserStyle } from "../../db/schema/index.js";
import type { Personality } from "@task/shared";
import type { EmotionalState, EmotionEstimate } from "./index.js";
import type { MoodClassification } from "../memory/schema.js";

/**
 * Auto-calibration (sections 8 et 4). Deux horloges :
 * - `current` : EMA rapide (α 0.5) des lectures d'humeur → ton du moment ;
 * - `baseline` : EMA lente (α 0.05) → ce qui est "normal" pour cette personne.
 * L'écart current − baseline pilote les ajustements et la détection de changement inhabituel.
 * `userStyle` : moyenne glissante de la façon d'écrire de la personne, pour l'imiter (longueur, emojis, minuscules).
 */

export const NEUTRAL: MoodStates = { neutral: 1, positive: 0, tired: 0, stressed: 0, sad: 0, angry: 0 };
export const EMPTY_STYLE: UserStyle = { avgMessageLength: 60, emojiRate: 0.2, exclamationRate: 0.2, questionRate: 0.3, lowercaseRate: 0.5, samples: 0 };

const STATES: EmotionalState[] = ["neutral", "positive", "tired", "stressed", "sad", "angry"];

export function statesFromClassification(c: MoodClassification): MoodStates {
  const conf = Math.max(0.35, Math.min(1, c.confidence));
  const rest = (1 - conf) / (STATES.length - 1);
  const out = {} as MoodStates;
  for (const s of STATES) out[s] = s === c.dominant ? conf : rest;
  return out;
}

export function statesFromHeuristic(e: EmotionEstimate): MoodStates {
  return { ...e.states };
}

export function ema(prev: MoodStates, next: MoodStates, alpha: number): MoodStates {
  const out = {} as MoodStates;
  for (const s of STATES) out[s] = round((prev[s] ?? 0) * (1 - alpha) + (next[s] ?? 0) * alpha);
  return out;
}

export function dominant(states: MoodStates): EmotionalState {
  return STATES.reduce((best, s) => (states[s] > states[best] ? s : best), "neutral" as EmotionalState);
}

/** État non neutre le plus probable (le neutre est le fond, pas un signal). */
export function dominantSignal(states: MoodStates): { state: EmotionalState; score: number } {
  let best: EmotionalState = "neutral";
  let score = 0;
  for (const s of STATES) {
    if (s === "neutral") continue;
    if (states[s] > score) {
      best = s;
      score = states[s];
    }
  }
  return { state: best, score };
}

/** Distance L1 entre deux distributions (0..2). */
export function distance(a: MoodStates, b: MoodStates): number {
  return round(STATES.reduce((sum, s) => sum + Math.abs((a[s] ?? 0) - (b[s] ?? 0)), 0));
}

export function styleSample(text: string): UserStyle {
  const emojis = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  return {
    avgMessageLength: text.length,
    emojiRate: emojis,
    exclamationRate: /!/.test(text) ? 1 : 0,
    questionRate: /\?/.test(text) ? 1 : 0,
    lowercaseRate: /^[a-zà-ÿ]/.test(text) ? 1 : 0,
    samples: 1,
  };
}

export function mergeStyle(prev: UserStyle, sample: UserStyle): UserStyle {
  const n = Math.min(prev.samples, 50); // fenêtre glissante approximative
  const w = n / (n + 1);
  const mix = (a: number, b: number) => round(a * w + b * (1 - w));
  return {
    avgMessageLength: mix(prev.avgMessageLength, sample.avgMessageLength),
    emojiRate: mix(prev.emojiRate, sample.emojiRate),
    exclamationRate: mix(prev.exclamationRate, sample.exclamationRate),
    questionRate: mix(prev.questionRate, sample.questionRate),
    lowercaseRate: mix(prev.lowercaseRate, sample.lowercaseRate),
    samples: prev.samples + 1,
  };
}

export type CalibrationState = Pick<CalibrationRow, "baseline" | "current" | "userStyle" | "readings">;

export function initialCalibration(): CalibrationState {
  return { baseline: { ...NEUTRAL }, current: { ...NEUTRAL }, userStyle: { ...EMPTY_STYLE }, readings: 0 };
}

export function applyReading(cal: CalibrationState, states: MoodStates, messageText?: string): CalibrationState {
  // Une lecture porteuse d'un signal déplace vite l'état courant (et remplace presque l'état neutre
  // initial) ; une lecture neutre ne fait que le laisser retomber doucement : un "ok" après un
  // message triste n'efface pas la tristesse.
  // Le signal est la masse du meilleur état non neutre : l'incertitude d'un classifieur
  // (probabilité étalée) ne doit pas passer pour un signal.
  const signal = dominantSignal(states).score;
  const alpha = signal > 0.3 ? (cal.readings < 3 ? 0.8 : 0.5) : 0.25;
  const current = ema(cal.current, states, alpha);
  // La référence n'intègre une lecture que lentement ; les premières lectures comptent plus (démarrage).
  const alphaBase = cal.readings < 5 ? 0.25 : 0.05;
  const baseline = ema(cal.baseline, states, alphaBase);
  const userStyle = messageText ? mergeStyle(cal.userStyle, styleSample(messageText)) : cal.userStyle;
  return { baseline, current, userStyle, readings: cal.readings + 1 };
}

export interface CalibrationOutput {
  /** Lignes injectées dans le contexte volatile. */
  lines: string[];
  /** Ajustements de style effectifs (pour la télémétrie et les tests). */
  adjustments: { messageLength: "shorter" | "same" | "longer"; emojis: "fewer" | "same" | "more"; energy: "lower" | "same" | "higher"; teasing: "off" | "same"; lowercase: boolean };
  unusual: boolean;
  delta: Partial<Record<EmotionalState, number>>;
}

/** Transforme l'état de calibration en consignes de ton et de format pour ce message. */
export function calibrate(cal: CalibrationState, personality: Personality, options: { heuristicNow?: EmotionEstimate | null } = {}): CalibrationOutput {
  // Humeur "de l'instant" : la lecture courante, infléchie par l'heuristique du message en cours
  // seulement si celle-ci porte un signal (un message neutre ne "dilue" pas une lecture récente).
  const h = options.heuristicNow;
  const now = h && h.intensity > 0.15 ? ema(cal.current, h.states, Math.min(0.5, h.intensity)) : cal.current;
  const delta: Partial<Record<EmotionalState, number>> = {};
  for (const s of STATES) delta[s] = round(now[s] - cal.baseline[s]);
  const { state: dom, score: domScore } = dominantSignal(now);
  const lines: string[] = [];
  const adj: CalibrationOutput["adjustments"] = { messageLength: "same", emojis: "same", energy: "same", teasing: "same", lowercase: false };

  const strong = domScore >= 0.4;
  if (dom === "sad" && strong) {
    lines.push("Elle semble ne pas aller fort : présence douce, pas de vannes, pas de conseils tout faits, une question simple si c'est naturel.");
    adj.teasing = "off";
    adj.energy = "lower";
  } else if (dom === "tired" && strong) {
    lines.push("Elle semble fatiguée : messages courts et calmes, pas d'enthousiasme forcé, pas de relance en cascade.");
    adj.messageLength = "shorter";
    adj.energy = "lower";
  } else if (dom === "stressed" && strong) {
    lines.push("Elle semble stressée : rassure sans minimiser, reste concret·ète, une seule question à la fois.");
    adj.energy = "lower";
    adj.teasing = "off";
  } else if (dom === "angry" && strong) {
    lines.push("Elle semble agacée : ne taquine pas, ne relativise pas à sa place, écoute d'abord.");
    adj.teasing = "off";
  } else if (dom === "positive" && strong) {
    lines.push("Elle est de bonne humeur : suis son énergie, tu peux être plus joueur·se.");
    adj.energy = "higher";
    adj.emojis = personality.style.emojiUsage === "none" ? "same" : "more";
  }

  // Changement inhabituel : écart net par rapport à sa référence, avec assez d'historique.
  const dist = distance(now, cal.baseline);
  const unusual = cal.readings >= 5 && dist >= 0.6 && dom !== "neutral";
  if (unusual) {
    const dir = (delta[dom] ?? 0) > 0 ? "plus" : "moins";
    lines.push(`Ce n'est pas son état habituel (${dir} ${labelOf(dom)} que d'ordinaire). Tu peux le remarquer avec délicatesse, sans insister ni poser de diagnostic.`);
  }

  // Miroir du style d'écriture (après quelques échantillons seulement).
  const st = cal.userStyle;
  if (st.samples >= 3) {
    if (st.avgMessageLength < 35 && personality.style.messageLength !== "short") {
      lines.push("Elle écrit très court : fais pareil, une phrase suffit souvent.");
      adj.messageLength = "shorter";
    } else if (st.avgMessageLength > 180 && personality.style.messageLength === "short") {
      lines.push("Elle écrit des messages développés : tu peux répondre un peu plus longuement quand le sujet le mérite.");
      adj.messageLength = "longer";
    }
    if (st.emojiRate < 0.1 && personality.style.emojiUsage !== "none") {
      lines.push("Elle n'utilise quasiment pas d'emojis : n'en mets pas, ou très rarement.");
      adj.emojis = "fewer";
    }
    if (st.lowercaseRate > 0.7) {
      lines.push("Elle écrit en minuscules, style texto : fais pareil.");
      adj.lowercase = true;
    }
  }
  return { lines, adjustments: adj, unusual, delta };
}

function labelOf(s: EmotionalState) {
  return { neutral: "neutre", positive: "joyeuse", tired: "fatiguée", stressed: "stressée", sad: "triste", angry: "agacée" }[s];
}
function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
