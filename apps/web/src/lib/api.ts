import type { Companion, Conversation, Message, UserPublic } from "@task/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: unknown } };
  if (!res.ok) {
    throw new ApiError(res.status, data.error?.code ?? "request_error", data.error?.message ?? "Erreur réseau", data.error?.details);
  }
  return data as T;
}

export const api = {
  auth: {
    me: () => request<{ user: UserPublic }>("GET", "/auth/me"),
    register: (input: { email: string; password: string; displayName?: string; timezone?: string; locale?: string }) =>
      request<{ user: UserPublic }>("POST", "/auth/register", input),
    login: (input: { email: string; password: string }) => request<{ user: UserPublic }>("POST", "/auth/login", input),
    logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  },
  users: {
    update: (input: Record<string, unknown>) => request<{ user: UserPublic }>("PATCH", "/users/me", input),
    deleteAccount: () => request<{ ok: true }>("DELETE", "/users/me"),
  },
  companions: {
    catalog: () =>
      request<{ presets: { id: string; label: string; description: string }[]; voices: { id: string; gender: string; label: string; description: string }[] }>(
        "GET",
        "/companions/catalog",
      ),
    list: () => request<{ companions: Companion[] }>("GET", "/companions"),
    get: (id: string) => request<{ companion: Companion }>("GET", `/companions/${id}`),
    create: (input: Record<string, unknown>) => request<{ companion: Companion }>("POST", "/companions", input),
    update: (id: string, input: Record<string, unknown>) => request<{ companion: Companion }>("PATCH", `/companions/${id}`, input),
    delete: (id: string) => request<{ ok: true }>("DELETE", `/companions/${id}`),
  },
  conversations: {
    list: () => request<{ conversations: Conversation[] }>("GET", "/conversations"),
    forCompanion: (companionId: string) => request<{ conversation: Conversation }>("GET", `/companions/${companionId}/conversation`),
    messages: (id: string, before?: string) => request<{ messages: Message[] }>("GET", `/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
    send: (id: string, content: string) =>
      request<{ message: Message }>("POST", `/conversations/${id}/messages`, { content, kind: "text", clientTime: new Date().toISOString() }),
    markRead: (id: string) => request<{ ok: true }>("POST", `/conversations/${id}/read`),
  },
};
