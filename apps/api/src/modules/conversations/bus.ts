import { EventEmitter } from "node:events";
import type { ConversationStreamEvent } from "@task/shared";

/**
 * Bus d'événements de conversation, en mémoire (un seul process).
 * Pour plusieurs instances API, remplacer par Redis pub/sub derrière la même interface.
 */
export class ConversationBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(conversationId: string, event: ConversationStreamEvent) {
    this.emitter.emit(conversationId, event);
  }

  subscribe(conversationId: string, handler: (event: ConversationStreamEvent) => void): () => void {
    this.emitter.on(conversationId, handler);
    return () => this.emitter.off(conversationId, handler);
  }

  /** Attend le prochain événement satisfaisant le prédicat (utile pour les tests). */
  waitFor(conversationId: string, predicate: (e: ConversationStreamEvent) => boolean, timeoutMs = 10_000): Promise<ConversationStreamEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error("timeout waiting for conversation event"));
      }, timeoutMs);
      const off = this.subscribe(conversationId, (e) => {
        if (predicate(e)) {
          clearTimeout(timer);
          off();
          resolve(e);
        }
      });
    });
  }
}
