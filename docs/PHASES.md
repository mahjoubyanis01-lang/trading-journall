# TASK — Plan de phases et état

Légende : ✅ fait et testé · 🟡 en cours · ⬜ à faire · 🔌 nécessite une infra/clé externe

| Phase | Contenu | État | Notes |
|---|---|---|---|
| 0 | Audit du repo, architecture (`docs/ARCHITECTURE.md`), monorepo pnpm, Postgres+pgvector, migrations Drizzle, CI de tests | ✅ | |
| 1 | Auth (email + mot de passe scrypt, sessions opaques révocables, cookie httpOnly), profil + préférences, création/édition/suppression du compagnon (nom, surnom, voix, avatar, personnalité, permissions), relation initiale, conversation directe, onboarding web | ✅ | Suppression de compte en cascade ; isolation par utilisateur testée |
| 2 | Chat texte : Conversation Engine, Context Engine (heure locale, rythme de la relation, signaux émotionnels prudents), premier contact à l'initiative du compagnon, réponses multi-bulles avec temporalité, coalescence des rafales, filtre relationnel (Safety), SSE temps réel, non-lus, suivi des coûts, écran de chat web | ✅ code + tests + e2e navigateur | 🔌 `ANTHROPIC_API_KEY` côté serveur pour une vraie conversation ; non exercé contre l'API réelle dans cet environnement (provider factice) |
| 2 bis | LLM local par défaut (fournisseur OpenAI-compatible : Ollama, llama.cpp, vLLM), Hermes Agent via son API server, routeur par slots chat/fast/deep, warmup, coût 0 local | ✅ vérifié en réel sur Ollama | Hermes Agent non installé ici : contrat HTTP couvert par le mock ; Ollama testé en réel (qwen2.5:0.5b sur CPU) |
| 3 | Memory Engine + cerveau.md : extraction structurée (modèle rapide), clés uniques, doublons, sensible sous contrôle, dates relatives FR, événements futurs, rappel lexical, rendu prompt borné + écran Cerveau (édition, épinglage, oubli) | ✅ | pgvector/embeddings : plus tard, derrière la même fonction de rappel |
| 3 bis | Détection d'humeur (heuristique + LLM rapide, probabiliste) et auto-calibration (état courant, référence, style de l'utilisateur, changement inhabituel) injectée dans le prompt | ✅ | |
| 4 | Relationship Engine : mise à jour des dimensions, stage, relationship_events | ⬜ | |
| 5 | Initiative + Habit + Notification Engine : workers BullMQ, journal des décisions, Web Push | ⬜ | 🔌 Redis, VAPID |
| 6 | Stories | ⬜ | 🔌 ImageProvider |
| 7 | Messages vocaux (STT/TTS) | ⬜ | 🔌 S3, STT, TTS |
| 8 | Appels voix temps réel | ⬜ | 🔌 LiveKit |
| 9 | Appels vidéo + avatar | ⬜ | 🔌 VideoProvider |
| 10 | Multimédia + mode Together | ⬜ | |
| 11 | Multi-compagnons UI + groupes | ⬜ | Le modèle de données est déjà multi-compagnon |
| 12 | Prod : quotas, chiffrement, export, observabilité, shell natif | ⬜ | |

## Vérifications faites

- `pnpm test` : 54 tests API (auth, compagnons, isolation entre utilisateurs, personnalité, sécurité relationnelle, routeur, moteur de conversation, émotion, conversations + SSE) et 2 tests `shared`.
- `pnpm typecheck` : `shared`, `api`, `web`.
- `pnpm --filter @task/web build` : bundle PWA.
- Scénario Playwright (Chromium mobile 390×844) : onboarding complet → premier contact → envoi → réponse → profil → accueil → rechargement avec session persistante, sans erreur JS.

## Ce qui est réel vs. ce qui ne l'est pas

- Le fournisseur local (`apps/api/src/providers/ai/openai-compatible.ts`) a été exercé contre un vrai Ollama (`qwen2.5:0.5b`, CPU) : streaming, JSON structuré, warmup, puis l'application complète en navigateur. Les modèles recommandés (Hermes 3 8B / 3B) n'ont pas été téléchargés ici (taille) : ils se configurent par variables d'environnement.
- Hermes Agent est intégré par son API server OpenAI-compatible ; le contrat (streaming, keepalive, événements `hermes.tool.progress`) est couvert par un serveur mock, pas par une instance Hermes réelle dans cet environnement.
- Le fournisseur IA Anthropic (`apps/api/src/providers/ai/anthropic.ts`) est une vraie implémentation (streaming, cache prompt, structured outputs, routeur de modèles). Il n'a **pas** été exercé contre l'API dans cet environnement (aucune clé). Les tests utilisent `FakeAIProvider`, qui renvoie des réponses scriptées et ne prétend pas converser.
- Le catalogue de voix (`apps/api/src/modules/companions/catalog.ts`) est une liste d'identifiants internes ; la synthèse vocale arrive en phase 7.
- L'avatar est stylisé (couleur + initiale) ; l'image de référence arrive avec ImageProvider.

## Commandes

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d     # ou Postgres/Redis locaux
cp infra/.env.example apps/api/.env
pnpm db:migrate
pnpm dev                                              # api :3000 + web :5173
pnpm test
pnpm typecheck
```
