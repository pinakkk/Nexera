# Nexara — Implementation Checkpoint

> Snapshot of what is **actually built and working at runtime** vs. what is
> **written but inactive** vs. **not done**. Audited against the codebase, not
> the README. See [V2 architecture.md](V2%20architecture.md) for the Supabase
> migration spec.

Last audited: 2026-05-19

---

## ✅ Implemented & working at runtime

### Backend (FastAPI, `apps/api`)
- App factory, CORS, rate limiting (slowapi), request-id middleware,
  per-request user API-key injection (`user_keys.py`).
- **Persistence: MongoDB** via `app/db/mongo.py` (`MongoStore`). This is the
  only store actually used at runtime.
- Runs API: `POST /v1/runs`, `GET /v1/runs/{id}`, `GET /v1/runs/{id}/events`,
  `GET /v1/runs/{id}/stream` (SSE), `GET /v1/runs`, thread runs, delete, PDF.
- Sources API: file/URL ingest, `GET /v1/sources/{id}`.
- Memory API + service: store/recall/list/delete, thread summaries, trusted
  sources, URL-fetched dedup. **Recall = in-Python cosine over all rows**
  (works, not yet pgvector).
- Health, models, transcribe (STT), tts, vision routers.
- Orchestrator agent state machine: intake → plan → query → search →
  fetch/parse → index → retrieve → rerank → synthesize → evaluate → refine →
  finalize, with SSE event emission and Mongo persistence.
- 28 service modules: planner, query_generator, searcher (Bright Data +
  Tavily), fetcher, indexer, embedder (fastembed/ONNX 384-dim), retriever,
  reranker (flashrank), synthesizer, evaluator, verifier, refiner,
  research_gate, safety_guard, model_router, team_leader, academic,
  pdf_generator, persistent memory, event_bus, worker_pool.
- Auth: WorkOS JWT → `RequestActor` (`user_id` for signed-in,
  `session_id` for anonymous); BYO-API-key + anonymous modes.
- Startup readiness probe (`ensure_mongo_ready`) + integration checks.

### Frontend (Next.js 15 / React 19, `apps/web`)
- Research console, live trace timeline, report viewer, sources panel,
  history, projects, settings, memory pages.
- WorkOS AuthKit sign-in/up/callback; middleware.
- SSE client for live run streaming; API client (`lib/api.ts`).
- `/api/db/health` now **proxies the API `/health`** (Supabase-aware).
- No direct database access (correct for V2).

### Tooling / repo
- Makefile: dev, lint, test, `check-db`, `migrate`/`migration` (Alembic).
- `scripts/check_db.py` Supabase connectivity probe.
- Alembic configured; migration files **gitignored** (open-source rule).
- `.env.example` (root/api/web) Supabase-shaped.

---

## ⚠️ Written but INACTIVE (dead at runtime)

- **SQLAlchemy ORM** `app/db/models.py` (13 tables) — fully modeled but never
  hit; orchestrator is always built with `db_session=None`.
- **`app/db/database.py`** async engine — exists, unused by runtime (only
  `make check-db` will exercise it).
- **Knowledge graph** `services/knowledge_graph.py` — written against
  `AsyncSession` but a no-op because `db_session=None`.
- **Alembic versions** `001`–`004` — present on disk, untracked from git.
- Orchestrator raw-SQL `INSERT/UPDATE` fallbacks (`_db` branch) — dead unless
  KG/SQL session is enabled.

---

## ❌ Not done yet (V2 migration backlog)

Tracked in [V2 architecture.md](V2%20architecture.md) §8/§10.

- [ ] Implement `SupabaseStore` (drop-in for `MongoStore`, §5 signatures).
- [ ] Point runtime at Supabase; swap `ensure_mongo_ready` →
      `ensure_database_ready` in `main.py`.
- [ ] Add `Run.session_id` column + `fetched_urls` table to `models.py`
      (schema gaps vs. Mongo runtime).
- [ ] Enable `vector` extension; generate + apply baseline Alembic migration.
- [ ] Upgrade `memory.recall()` to a pgvector `ORDER BY embedding <=>` query.
- [ ] Update the 6 Mongo import sites + `db/__init__.py`; remove `pymongo`.
- [ ] Point pytest/`conftest.py` at a Supabase/Postgres test target.
- [ ] (Deferred, post-migration) Enable KG persistence by passing a real
      `db_session` into the orchestrator.

---

## Removed in this pass

- Prisma: `apps/web/prisma/schema.prisma`, `apps/web/lib/prisma.ts`,
  `prisma`/`@prisma/client` deps + scripts in `package.json`.
- `project.md` (superseded by V2 architecture.md).
- `mermaid-diagram.png` (replaced by the Mermaid block in V2 doc).
- `POSTGRES_URL` unused setting in `config.py`.
- Mongo/Prisma/Neon language in README, Makefile, `.env.example` files.
