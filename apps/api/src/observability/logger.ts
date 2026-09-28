import pino, { type Logger } from "pino";

/**
 * Logs structurés. Règle : jamais de contenu de message, de souvenir ou de transcript
 * dans les logs. On logue des identifiants, des décisions, des durées, des coûts.
 */
export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.content", "*.transcript"],
      censor: "[redacted]",
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
export type { Logger };
