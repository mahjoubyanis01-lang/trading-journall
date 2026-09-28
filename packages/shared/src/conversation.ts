import { z } from "zod";

export const messageSenderSchema = z.enum(["user", "companion", "system"]);
export const messageKindSchema = z.enum(["text", "voice", "image", "video", "gif", "story_reply", "system"]);

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  sender: messageSenderSchema,
  kind: messageKindSchema,
  content: z.string(),
  mediaId: z.string().uuid().nullable(),
  /** Index de la bulle quand une réponse est découpée en plusieurs messages. */
  burstIndex: z.number().int().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type Message = z.infer<typeof messageSchema>;

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  kind: z.enum(["text"]).default("text"),
  /** Heure locale du client (ISO) pour le contexte temporel. */
  clientTime: z.string().datetime({ offset: true }).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const conversationSchema = z.object({
  id: z.string().uuid(),
  companionId: z.string().uuid(),
  kind: z.enum(["direct", "group"]),
  lastMessageAt: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  unreadCount: z.number().int(),
  createdAt: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;

/** Événements SSE émis par GET /conversations/:id/stream */
export type ConversationStreamEvent =
  | { type: "typing"; companionId: string }
  | { type: "delta"; messageId: string; text: string }
  | { type: "message"; message: Message }
  | { type: "error"; code: string; message: string };
