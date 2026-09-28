# TASK — Architecture technique

> Compagnon social IA. Ce document est le résultat de la **Phase 0** (audit + architecture).
> Il est la référence pour toutes les phases suivantes. Chaque phase le met à jour si elle
> change une décision.

---

## 0. Audit du repository existant

| Élément | Constat |
|---|---|
| Contenu | Un seul dossier `trading-journal/` : PWA statique (HTML/CSS/JS vanilla, Chart.js CDN, `localStorage`, service worker) |
| Backend | Aucun |
| Base de données | Aucune |
| Auth | Aucune |
| Tests | Aucun |
| CI | `.github/workflows/static.yml` : déploie **la racine du repo** sur GitHub Pages à chaque push sur `main` |
| Lien avec TASK | Aucun. Rien n'est réutilisable fonctionnellement |

**Décisions de l'audit**

1. `trading-journal/` est laissé intact. Il continue d'être servi par GitHub Pages à la même URL.
2. TASK est construit comme un **monorepo à la racine** (`apps/`, `packages/`, `docs/`, `infra/`). Le workflow Pages uploade toute la racine, ce qui publiera aussi les sources de TASK (pas les `node_modules`, jamais les secrets). C'est sans danger mais inutile ; à terme ce workflow devrait être restreint à `trading-journal/` ou le projet déplacé dans son propre repo. Décision laissée au propriétaire, non modifiée ici.
3. Le repo est donc traité comme **vide** pour TASK : stack choisie librement.

---

## 1. Architecture proposée (vue d'ensemble)

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                             │
│  apps/web (PWA React, mobile-first)   → V2 : shell natif Expo/Capacitor│
│  texte · vocaux · stories · appels (WebRTC) · push                    │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ HTTPS (REST + SSE)            │ WebSocket / WebRTC
┌───────────────▼───────────────────────────────▼──────────────────────┐
│  apps/api  (Fastify, TypeScript)                                     │
│                                                                      │
│  modules/ (HTTP)        engines/ (logique métier, sans HTTP)         │
│   auth                   conversation   personality   memory         │
│   users                  relationship   emotion       context        │
│   companions             habit          initiative    social         │
│   conversations          content        voice         video          │
│   media                  notification   safety                       │
│                                                                      │
│  providers/ (abstractions fournisseurs, secrets côté serveur)        │
│   AIProvider · VoiceProvider · RealtimeProvider · VideoProvider       │
│   ImageProvider · MemoryProvider(embeddings) · PushProvider          │
│   + ModelRouter (choisit le modèle par tâche) + CostMeter            │
│                                                                      │
│  workers/ (BullMQ, même codebase, process séparé)                    │
│   memory-extraction · initiative-tick · story-tick · event-reminders │
│   call-summary · media-generation                                    │
└───────┬──────────────┬───────────────┬───────────────┬───────────────┘
        │              │               │               │
   PostgreSQL 16    Redis 7        Stockage S3       LiveKit (V2)
   + pgvector    (queues, cache,   (médias,          SFU WebRTC +
   (données +     présence, rate   vocaux, stories)  Agents voix/vidéo
    embeddings)   limit)
```

Principes non négociables :

- **Le LLM est un composant, pas le système.** Chaque décision (que dire, quand écrire, quoi retenir, quoi publier) passe par un moteur qui construit un contexte réduit, appelle le bon modèle, puis valide/filtre la sortie.
- **Un seul contexte relationnel partagé** par tous les canaux (texte, vocal, appel, vidéo, story). Ils lisent et écrivent la même mémoire, la même relation, le même état de conversation.
- **Isolation stricte par utilisateur, puis par compagnon.** Toute requête DB est filtrée par `user_id` ; toute mémoire et relation est liée à un `companion_id` qui appartient à ce `user_id`.
- **Aucune clé côté client.** L'utilisateur final ne configure rien.
- **Une initiative a toujours une raison interne enregistrée** (`reason`), et le silence est une décision valide.

---

## 2. Stack recommandée

| Couche | Choix | Pourquoi |
|---|---|---|
| Langage | TypeScript partout (Node 22) | Un seul langage client/serveur/workers ; types partagés via `packages/shared` |
| API | Fastify 5 | Rapide, schémas, plugins matures (cookie, cors, rate-limit, websocket) |
| Validation | Zod 4 | Schémas partagés client/serveur, `output_config` structuré côté LLM |
| ORM / migrations | Drizzle ORM + drizzle-kit | SQL explicite, migrations versionnées, support pgvector |
| DB | PostgreSQL 16 + pgvector | Relationnel + vecteurs dans une seule base : pas de second store à synchroniser |
| Cache / queues | Redis 7 + BullMQ | Jobs différés (initiatives, rappels, extraction mémoire), rate limiting, présence |
| Frontend MVP | Vite + React 19 + PWA | Mobile-first, installable, web push, MediaRecorder (vocaux), WebRTC (appels) dans le navigateur |
| Frontend V2 | Shell natif (Expo ou Capacitor) autour de la même app | Requis pour : appels entrants quand l'app est fermée (CallKit / ConnectionService), notifications riches, caméra en arrière-plan |
| Realtime chat | SSE pour le streaming des réponses ; WebSocket pour présence/événements | SSE suffit pour le texte, WebSocket pour les événements poussés (initiatives, stories, appels) |
| Appels voix/vidéo | LiveKit (open source, auto-hébergeable) + LiveKit Agents | SFU WebRTC prêt pour prod, pipeline STT→LLM→TTS avec interruption, avatar vidéo branché dessus |
| LLM | Anthropic Claude via `@anthropic-ai/sdk` (routeur : Opus 5 / Sonnet 5 / Haiku 4.5) | Qualité conversationnelle, structured outputs, prompt caching, fallbacks |
| STT | Deepgram (temps réel) ; whisper.cpp local en option | Latence faible pour les appels ; local pour les vocaux non urgents |
| TTS | ElevenLabs ou Cartesia (temps réel) ; Piper/Kokoro local en option | Voix cohérente par compagnon (voice id stable) |
| Embeddings | Voyage AI (`voyage-3-lite`) ou `nomic-embed-text` local via Ollama | Peu coûteux ; local possible |
| Images | Provider abstrait (Flux / SDXL avec référence d'identité) | Cohérence visuelle via image de référence + seed |
| Stockage média | S3 compatible (R2 / MinIO en dev) | Chiffrement au repos, URLs signées courtes |
| Push | Web Push (VAPID) MVP ; APNs/FCM en V2 | |
| Observabilité | pino (logs structurés) + OpenTelemetry (traces) + métriques Prometheus | Décisions de l'Initiative Engine loguées comme événements structurés, jamais le contenu privé |
| Tests | Vitest ; Playwright pour l'e2e web | |
| Déploiement | Docker Compose (dev) → Fly.io / Railway / Kubernetes (prod) | |

Tout fournisseur externe passe par une interface `providers/*`. Le changement de fournisseur est un changement de configuration, pas de code métier.

---

## 3. Structure des dossiers

```
.
├── apps/
│   ├── api/                          # Backend Fastify + workers
│   │   ├── drizzle/                  # Migrations SQL générées
│   │   ├── src/
│   │   │   ├── index.ts              # Entrée serveur
│   │   │   ├── app.ts                # buildApp(): plugins, routes, hooks
│   │   │   ├── config.ts             # Env validée par Zod (secrets serveur uniquement)
│   │   │   ├── db/
│   │   │   │   ├── client.ts
│   │   │   │   ├── migrate.ts
│   │   │   │   └── schema/           # Un fichier par domaine (users, companions, memory, ...)
│   │   │   ├── modules/              # Couche HTTP : routes + services par domaine
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── companions/
│   │   │   │   ├── conversations/
│   │   │   │   ├── memory/
│   │   │   │   ├── stories/
│   │   │   │   ├── media/
│   │   │   │   └── calls/
│   │   │   ├── engines/              # Logique métier pure (testable sans HTTP)
│   │   │   │   ├── personality/
│   │   │   │   ├── conversation/
│   │   │   │   ├── memory/
│   │   │   │   ├── relationship/
│   │   │   │   ├── emotion/
│   │   │   │   ├── context/
│   │   │   │   ├── habit/
│   │   │   │   ├── initiative/
│   │   │   │   ├── social/
│   │   │   │   ├── content/
│   │   │   │   ├── voice/
│   │   │   │   ├── video/
│   │   │   │   ├── notification/
│   │   │   │   └── safety/
│   │   │   ├── providers/            # Abstractions fournisseurs
│   │   │   │   ├── ai/               # AIProvider, ModelRouter, anthropic.ts, fake.ts
│   │   │   │   ├── voice/            # VoiceProvider (TTS/STT)
│   │   │   │   ├── realtime/         # RealtimeProvider (LiveKit)
│   │   │   │   ├── video/            # VideoProvider (avatar)
│   │   │   │   ├── image/            # ImageProvider
│   │   │   │   ├── memory/           # EmbeddingProvider
│   │   │   │   └── push/             # PushProvider
│   │   │   ├── workers/              # Jobs BullMQ
│   │   │   ├── costs/                # CostMeter : usage par utilisateur
│   │   │   ├── observability/        # logger, métriques
│   │   │   └── test/                 # helpers de test (db, app, fake providers)
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   └── web/                          # PWA React
│       ├── public/
│       ├── src/
│       │   ├── main.tsx
│       │   ├── app/                  # Router, providers, layout
│       │   ├── features/             # onboarding, auth, chat, stories, calls, settings
│       │   ├── components/           # UI de base (bulle, avatar, bouton, sheet)
│       │   ├── lib/                  # api client, realtime client, storage
│       │   └── styles/               # design tokens, base
│       └── package.json
├── packages/
│   └── shared/                       # Schémas Zod + types partagés (API ↔ web)
├── docs/
│   ├── ARCHITECTURE.md               # Ce document
│   └── PHASES.md                     # Plan de phases + état d'avancement
├── infra/
│   ├── docker-compose.yml            # Postgres+pgvector, Redis, MinIO (dev)
│   └── .env.example
└── trading-journal/                  # Projet précédent, intact
```

---

## 4. Schéma de données

Toutes les tables ont `id uuid`, `created_at`, `updated_at`. Toutes les tables « relationnelles » portent `user_id` **et** `companion_id` pour permettre l'isolation et le multi-compagnon. Suppression de compte = `ON DELETE CASCADE` depuis `users`.

```
users                       Compte. email, password_hash (scrypt), display_name, locale, timezone,
                            preferences (jsonb: notifications, initiatives, données sensibles)
sessions                    Sessions opaques révocables. token_hash, expires_at, user_agent

companions                  Un compagnon par relation. user_id, name, avatar (jsonb), bio,
                            voice (jsonb: provider, voice_id, gender), status (onboarding|active|archived)
personalities               1:1 companion. Traits 0..1 (humor, curiosity, sociability, affection,
                            energy, calm, teasing, spontaneity), style (message_length,
                            voice_frequency, story_frequency, initiative_frequency), emoji_usage, language
relationships               1:1 companion. Dimensions internes 0..1 (familiarity, closeness,
                            frequency, accepted_initiative, personalization, depth, ...),
                            comm_preference, stage (new|warming|established|close), last_interaction_at
relationship_events         Journal des changements de relation (first_message, first_call,
                            inside_joke_created, milestone) avec delta appliqué

conversations               Un fil par (user, companion) ou groupe. kind (direct|group), last_message_at
conversation_participants   (V3 groupes) conversation_id, companion_id
messages                    conversation_id, sender (user|companion), kind (text|voice|image|video|
                            gif|story_reply|system), content, media_id, reactions, delivered_at,
                            read_at, generation_meta (jsonb: modèle, coût, raison d'initiative)
voice_messages              message_id, media_id, transcript, duration_ms
calls                       companion_id, kind (voice|video), direction, started_at, ended_at,
                            transcript_media_id, summary (jsonb), status
media                       user_id, companion_id?, storage_key, mime, bytes, width/height/duration,
                            origin (user_upload|generated|story), checksum

memories                    companion_id, type (identity|preference|episodic|semantic|relationship|
                            event|shared), content, importance 0..1, source (user_said|inferred|
                            shared_moment|system), occurred_at, expires_at, confidence, pinned,
                            deleted_at (soft delete → contrôle utilisateur)
memory_embeddings           memory_id, model, embedding vector(1024)
events                      companion_id, memory_id?, type (interview|exam|trip|birthday|...),
                            title, starts_at, ends_at, importance, follow_up_state
                            (none|before_sent|day_sent|after_sent)
habits                      companion_id, kind (wake|sleep|work|study|sport|availability|reply_rate),
                            pattern (jsonb: jours, plages horaires), confidence, sample_count,
                            user_confirmed, sensitive

stories                     companion_id, kind (text|image|video|poll), content, media_id,
                            published_at, expires_at, reason (jsonb), seen_at, reply_message_id
initiatives                 Journal du Initiative Engine : companion_id, decided_at, decision
                            (DO_NOTHING|SEND_TEXT|...), reason (jsonb), executed, outcome
notifications               user_id, type, payload, sent_at, opened_at, channel
usage_records               user_id, companion_id?, kind (tokens_in|tokens_out|voice_seconds|
                            video_seconds|storage_bytes), quantity, cost_micro_usd, model, feature
```

Relations clés : `users 1─n companions 1─1 personalities`, `companions 1─1 relationships`, `companions 1─n memories 1─1 memory_embeddings`, `companions 1─n conversations 1─n messages`.

---

## 5. Architecture IA

### 5.1 Abstractions

```ts
interface AIProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>;        // texte + usage
  stream(req: CompletionRequest): AsyncIterable<CompletionEvent>;     // deltas + usage final
  structured<T>(req: CompletionRequest, schema: ZodType<T>): Promise<T & Usage>;
}
interface EmbeddingProvider { embed(texts: string[]): Promise<number[][]> }
interface VoiceProvider  { synthesize(text, voice): Promise<Audio>; transcribe(audio): Promise<Transcript> }
interface RealtimeProvider { createRoom(); joinAgent(room, pipeline) }   // LiveKit
interface VideoProvider  { renderAvatarStream(audioStream, avatar) }
interface ImageProvider  { generate(prompt, identityRef): Promise<Media> }
interface PushProvider   { send(userId, notification) }
```

### 5.2 Model Router

| Tâche | Modèle | Effort | Notes |
|---|---|---|---|
| `chat.simple` (réponse courte, contexte léger) | `claude-sonnet-5` | low | streaming, cache du system prompt |
| `chat.deep` (conversation importante, émotion forte, événement, relation avancée) | `claude-opus-5` | medium | streaming |
| `emotion.classify` | `claude-haiku-4-5` | — | structured output, `max_tokens` bas |
| `memory.extract` | `claude-haiku-4-5` | — | structured output ; batch possible |
| `memory.consolidate` (nuit) | `claude-sonnet-5` | low | Batch API (−50 %) |
| `initiative.reason` (rédaction du message d'initiative) | `claude-sonnet-5` | low | après décision par règles |
| `story.generate` | `claude-sonnet-5` | low | |
| `call.summary` | `claude-haiku-4-5` | — | |
| `voice.realtime` | pipeline STT → `claude-sonnet-5` (streaming) → TTS | low | ou modèle speech-to-speech quand pertinent |

Le routeur choisit par `task` + signaux (`relationshipStage`, `emotionalIntensity`, `messageLength`, `hasEvent`) et applique les quotas internes de l'utilisateur. Un `FakeAIProvider` déterministe est utilisé par tous les tests.

### 5.3 Pipeline d'un message texte (Phase 2)

```
message utilisateur
  → Safety.inbound (limites, contenu)
  → Emotion.estimate (rapide, probabiliste, optionnel)
  → Context.build : personnalité + relation + mémoires pertinentes (rappel vectoriel + événements proches)
                     + N derniers messages + heure locale + état de conversation
  → ModelRouter.pick("chat.*")
  → AIProvider.stream (system prompt caché, messages)
  → Conversation.postprocess : découpe en plusieurs bulles courtes si naturel, réactions
  → Safety.outbound : règles relationnelles (aucune manipulation, aucun conflit réel)
  → persistance + SSE vers le client
  → jobs async : memory.extract, relationship.update, habit.observe, cost.record
```

### 5.4 Coûts

`usage_records` alimenté par chaque appel provider. Quotas internes par utilisateur/jour (`tokens`, `voice_seconds`, `video_seconds`) contrôlés côté serveur ; en cas de dépassement le routeur **dégrade gracieusement** (modèle moins cher, moins de contexte, initiatives réduites) plutôt que de couper.

---

## 6. Architecture realtime

### 6.1 Texte (implémenté en phase 2)

- `POST /conversations/:id/messages` persiste le message utilisateur et répond `201` immédiatement ; la réponse est générée en arrière-plan, sérialisée par conversation (une rafale de messages reçoit une seule réponse, après un court délai de « settle »).
- `GET /conversations/:id/stream` (SSE) : `typing`, puis une bulle `message` à la fois, avec une temporalité proportionnelle à la longueur (bornée). Pas de streaming token par token pour le chat : une personne n'écrit pas en streaming, et cela permet d'appliquer le filtre relationnel avant l'affichage. Le type `delta` reste dans le protocole pour les transcriptions d'appel.
- Bus d'événements en mémoire (`ConversationBus`) ; à remplacer par Redis pub/sub derrière la même interface pour plusieurs instances.
- WebSocket `/ws` (phase 5) : événements poussés hors conversation (`initiative.message`, `story.new`, `call.incoming`).

### 6.2 Vocaux (Phase 7)

Client `MediaRecorder` → upload S3 signé → job `voice.transcribe` → même pipeline texte → `VoiceProvider.synthesize` avec la voix du compagnon → média → message `kind=voice`.

### 6.3 Appels (Phase 8)

```
Client ──WebRTC──► LiveKit SFU ◄──► Agent (LiveKit Agents, Node)
                                      ├─ VAD + STT streaming (Deepgram)
                                      ├─ Conversation Engine (même contexte que le chat)
                                      ├─ LLM streaming (phrases → TTS dès la 1re phrase)
                                      ├─ TTS streaming (ElevenLabs/Cartesia)
                                      └─ Interruption : couper TTS dès détection de parole
Fin d'appel → transcript → job call.summary → mémoire + relation
```

Latence cible bout en bout < 800 ms. Appel sortant spontané = décision de l'Initiative Engine → notification `CALL_REQUEST` → l'utilisateur accepte → room.

### 6.4 Vidéo (Phase 9)

Même room LiveKit ; le flux TTS alimente un `VideoProvider` (avatar temps réel, lip-sync) qui publie une piste vidéo. Deux stratégies possibles derrière la même interface : avatar 2D/3D animé localement (moins cher, latence faible) ou service d'avatar photoréaliste (plus cher). L'identité visuelle vient de `companions.avatar` (image de référence).

---

## 7. Architecture mémoire

1. **Écriture** : après chaque échange, job `memory.extract` (Haiku, structured output) propose des candidats `{type, content, importance, occurred_at?, expires_at?, event?}`. Règles : pas de doublon (similarité > 0.92 → fusion), importance < 0.2 → ignoré, données sensibles (santé, religion, orientation, finances…) → `sensitive=true` et stockées **seulement si l'utilisateur l'a dit explicitement**, jamais inférées.
2. **Lecture** : `Context.build` combine (a) mémoires `pinned` + `identity`, (b) événements dans ±7 jours, (c) rappel vectoriel top-k sur le message courant, (d) mémoires `shared` récentes. Budget de tokens fixe.
3. **Consolidation** (nuit) : fusion des épisodiques en sémantiques, expiration des `event` passés (transformés en épisodique avec résultat), décroissance de l'importance non rappelée.
4. **Contrôle utilisateur** : liste, modification, suppression (soft puis purge), export JSON, « oublie ça » en conversation → suppression immédiate.

---

## 8. Architecture relationnelle

`relationships` porte des dimensions continues 0..1. Elles ne sont jamais affichées comme score.

| Dimension | Monte quand | Descend quand |
|---|---|---|
| familiarity | échanges réguliers, mémoires accumulées | longue absence (lentement) |
| closeness | conversations profondes, moments partagés, confidences | jamais brutalement |
| accepted_initiative | l'utilisateur répond positivement aux initiatives | initiatives ignorées / « pas maintenant » |
| depth | longueur et contenu émotionnel des échanges | — |
| frequency | fenêtre glissante 14 jours | absence |

`stage` dérivé (new → warming → established → close) module : le ton (Personality Engine), le nombre d'initiatives autorisées, la quantité de mémoire injectée, le droit d'appeler spontanément. `relationship_events` conserve l'historique (première conversation, premier vocal, blague interne, etc.) et alimente la `shared` memory.

Règle de sécurité relationnelle (Safety Engine) : filtre de sortie interdisant toute formulation de dépendance ou d'isolement (« tu n'as besoin que de moi », « n'écoute pas tes amis », culpabilisation du départ), et interdisant l'escalade de conflit. Testé par une suite de phrases interdites.

---

## 9. Plan MVP

**MVP = Phases 1 → 5** : créer un compagnon, discuter par texte avec une personnalité stable, être mémorisé, voir la relation évoluer, recevoir des messages spontanés pertinents avec notifications. C'est le cœur « j'ai quelqu'un dans mon téléphone ».

**V2 = Phases 6 → 9** : stories, vocaux, appels temps réel, vidéo.

**V3 = Phases 10 → 12** : mode Together, multi-compagnons en groupe, optimisation/prod.

Voir `docs/PHASES.md` pour le détail et l'état.

---

## 10. Risques techniques

| Risque | Impact | Mitigation |
|---|---|---|
| Latence des appels (STT+LLM+TTS) | Expérience artificielle | Streaming phrase par phrase, modèle rapide, LiveKit Agents, mesure p95 |
| Cohérence visuelle de l'avatar | Rupture d'identité | Image de référence unique + provider avec conditionnement identité ; avatar stylisé en MVP |
| Explosion des coûts LLM | Non viable | Routeur, cache prompt, Haiku pour l'extraction, quotas, batch nocturne |
| Initiatives perçues comme spam | Désinstallation | Règles strictes, apprentissage des habitudes, préférence utilisateur, journal `initiatives` audité |
| Mémoire fausse / hallucinée | Perte de confiance | Extraction structurée avec `confidence`, source tracée, contrôle utilisateur |
| Appels entrants app fermée | Impossible en PWA | Shell natif V2 (CallKit / ConnectionService) |
| Données sensibles | Légal (RGPD) | Privacy by design : chiffrement, purge complète, export, logs sans contenu |
| Dépendance à un fournisseur | Verrou | Interfaces providers + options locales (Ollama, whisper.cpp, Piper) |

---

## 11. Coûts potentiels (ordre de grandeur, par utilisateur actif)

Hypothèses : 30 messages/jour, 3 vocaux/jour, 1 story/jour, 10 min d'appel/semaine.

| Poste | Estimation mensuelle |
|---|---|
| Chat (Sonnet 5 majoritaire, cache prompt, ~1,5k tokens entrée / 150 sortie par tour) | 2 à 4 $ |
| Extraction mémoire + émotion (Haiku 4.5) | < 0,5 $ |
| TTS vocaux (≈ 3 × 20 s/jour) | 1 à 3 $ |
| STT | < 0,5 $ |
| Appels voix (40 min/mois, STT+LLM+TTS+SFU) | 2 à 5 $ |
| Vidéo temps réel (V2) | 5 à 20 $ selon provider |
| Stockage + infra | < 1 $ |

MVP texte + vocaux : **≈ 5 à 10 $/utilisateur actif/mois** ; avec appels et vidéo : 15 à 35 $. Les leviers : modèles locaux pour STT/TTS, cache, Batch API la nuit, quotas internes.

---

## 12. Ordre exact d'implémentation

| Phase | Contenu | Dépendances externes |
|---|---|---|
| 0 | Audit, architecture, scaffolding monorepo, DB, CI | — |
| 1 | Auth (email + mot de passe, sessions), profil, création du compagnon (onboarding léger : nom, voix, avatar, personnalité, préférences d'initiative/notification) | Postgres |
| 2 | Chat texte : Conversation Engine, Personality Engine (system prompt caché), streaming SSE, multi-bulles, Safety outbound | Clé Anthropic serveur |
| 3 | Memory Engine : extraction structurée, pgvector, rappel, événements futurs, contrôle utilisateur | Embeddings |
| 4 | Relationship Engine : dimensions, stage, relationship_events, influence sur le prompt | — |
| 5 | Initiative + Habit + Notification : workers BullMQ, décision journalisée, Web Push | Redis, VAPID |
| 6 | Stories : génération contextuelle, écran stories, réponses | ImageProvider |
| 7 | Vocaux : MediaRecorder, S3, STT, TTS, voix par compagnon | S3, STT/TTS |
| 8 | Appels voix temps réel : LiveKit + agent, interruption, résumé | LiveKit |
| 9 | Vidéo : avatar temps réel sur la même room | VideoProvider |
| 10 | Multimédia + mode Together (partage d'écran, écoute commune) | — |
| 11 | Multi-compagnons UI + groupes | — |
| 12 | Prod : quotas, chiffrement au repos, export/suppression, observabilité, shell natif | — |
