# TASK — Plan de phases et état

Légende : ✅ fait et testé · 🟡 en cours · ⬜ à faire · 🔌 nécessite une infra/clé externe

| Phase | Contenu | État | Notes |
|---|---|---|---|
| 0 | Audit du repo, architecture (`docs/ARCHITECTURE.md`), monorepo pnpm, Postgres+pgvector, migrations Drizzle, CI de tests | ✅ | |
| 1 | Auth (email + mot de passe scrypt, sessions opaques révocables, cookie httpOnly), profil + préférences, création/édition/suppression du compagnon (nom, surnom, voix, avatar, personnalité, permissions), relation initiale, conversation directe, onboarding web | ✅ | Suppression de compte en cascade ; isolation par utilisateur testée |
| 2 | Chat texte : Conversation Engine, Context Engine (partie volatile), streaming SSE, multi-bulles, Safety outbound, suivi des coûts | 🟡 | 🔌 `ANTHROPIC_API_KEY` côté serveur pour une vraie conversation ; sans clé, provider factice |
| 3 | Memory Engine : extraction structurée, pgvector, rappel, événements futurs, contrôle utilisateur | ⬜ | 🔌 embeddings |
| 4 | Relationship Engine : mise à jour des dimensions, stage, relationship_events | ⬜ | |
| 5 | Initiative + Habit + Notification Engine : workers BullMQ, journal des décisions, Web Push | ⬜ | 🔌 Redis, VAPID |
| 6 | Stories | ⬜ | 🔌 ImageProvider |
| 7 | Messages vocaux (STT/TTS) | ⬜ | 🔌 S3, STT, TTS |
| 8 | Appels voix temps réel | ⬜ | 🔌 LiveKit |
| 9 | Appels vidéo + avatar | ⬜ | 🔌 VideoProvider |
| 10 | Multimédia + mode Together | ⬜ | |
| 11 | Multi-compagnons UI + groupes | ⬜ | Le modèle de données est déjà multi-compagnon |
| 12 | Prod : quotas, chiffrement, export, observabilité, shell natif | ⬜ | |

## Ce qui est réel vs. ce qui ne l'est pas

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
