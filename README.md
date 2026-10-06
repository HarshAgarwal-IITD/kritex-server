# kritex-server

Backend API for the Kritex ecommerce site: NestJS 11 + Prisma 6 + PostgreSQL 16.
The storefront lives in the sibling repo `../kritex-website`, which also holds the
planning docs for both repos (`../kritex-website/docs/ecommerce/`).

## Requirements

- Node 22 LTS or newer, npm 10
- Docker (for Postgres)

## Setup

```bash
cp .env.example .env
docker compose up -d          # dev DB on :5433, test DB on :5434
npm install
npx prisma generate
npx prisma migrate deploy     # apply migrations to the dev DB
npm run start:dev             # http://localhost:4000/api/v1
```

Check it: `curl localhost:4000/api/v1/health` → `{"status":"ok"}`.
Swagger UI: <http://localhost:4000/api/docs> (JSON at `/api/docs-json`). Not served when `NODE_ENV=production`.

## Scripts

| Script                                 | What it does                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run start:dev`                    | Run with watch mode (pretty logs)                                                                                                                                                   |
| `npm run build` / `npm run start:prod` | Compile to `dist/` / run the compiled app                                                                                                                                           |
| `npm run lint` / `npm run lint:fix`    | ESLint (typescript-eslint, type-aware) + Prettier check                                                                                                                             |
| `npm run format`                       | Prettier write                                                                                                                                                                      |
| `npm run typecheck`                    | `tsc --noEmit`                                                                                                                                                                      |
| `npm test`                             | Jest unit specs (`src/**/*.spec.ts`), no DB needed                                                                                                                                  |
| `npm run test:e2e`                     | Jest + supertest e2e (`test/*.e2e-spec.ts`) against the test DB on :5434. Runs `prisma migrate deploy` first and truncates tables between tests. Override with `TEST_DATABASE_URL`. |
| `npm run openapi:export`               | Regenerate `openapi.json` (no DB needed)                                                                                                                                            |
| `npm run openapi:check`                | Fail if `openapi.json` is stale (runs in CI)                                                                                                                                        |
| `npm run prisma:migrate`               | `prisma migrate dev` (create a new migration)                                                                                                                                       |
| `npm run prisma:deploy`                | `prisma migrate deploy`                                                                                                                                                             |
| `npm run prisma:studio`                | Browse the DB                                                                                                                                                                       |

## Environment

See [`.env.example`](.env.example). Variables are validated with zod at boot
(`src/config/env.schema.ts`); the app exits with a readable error if any are invalid.

| Variable        | Default                   | Notes                                          |
| --------------- | ------------------------- | ---------------------------------------------- |
| `NODE_ENV`      | `development`             | `development` / `test` / `production`          |
| `PORT`          | `4000`                    |                                                |
| `DATABASE_URL`  | (required)                | `postgresql://…`                               |
| `CORS_ORIGIN`   | `http://localhost:8080`   | Comma-separated allowlist; credentials allowed |
| `ADMIN_API_KEY` | (required)                | Temporary admin auth, replaced in Stage 2      |
| `LOG_LEVEL`     | `info` (`silent` in test) | pino level                                     |
| `TRUST_PROXY`   | (unset)                   | Reverse-proxy hop count; `1` on Render         |

## Deploy (Render + Neon, free tier)

ADR-008 in `../kritex-website/docs/ecommerce/DECISIONS.md`. The image is built from `Dockerfile`
and runs `prisma migrate deploy` on every boot before starting.

1. **Neon** (neon.tech): create a project in **AWS Singapore (ap-southeast-1)** with a database named `kritex`.
   Copy the connection string (direct, not pooled), which looks like `postgresql://…neon.tech/kritex?sslmode=require`.
2. **Render** (render.com): New → Blueprint → this repo. It reads `render.yaml`, which sets up a free
   web service in Singapore that deploys the `ecommerce` branch. Enter `DATABASE_URL` (from Neon) and
   `CORS_ORIGIN` (the storefront origins, comma-separated). `ADMIN_API_KEY` is generated for you.
3. Check it: `curl https://<service>.onrender.com/api/v1/health` → `{"status":"ok"}`.
4. Seed the catalog once from your machine: `DATABASE_URL=<neon url> npm run import:products`
   (or `npx prisma db seed`).
5. Optional: point an UptimeRobot / cron-job.org check at `/api/v1/health` every 10 minutes so the
   free instance does not sleep.

Free-plan limits: the service sleeps after ~15 minutes idle (the next request takes ~30-60 s), and
`@nestjs/schedule` jobs only run while it is awake. Before taking real payments, switch `plan` to
`starter` and `branch` to `main`.

Test the image locally:

```bash
docker build -t kritex-server .
docker run --rm -p 4000:4000 -e DATABASE_URL=postgresql://kritex:kritex@host.docker.internal:5433/kritex \
  -e ADMIN_API_KEY=dev -e CORS_ORIGIN=http://localhost:8080 kritex-server
```

## API

Base path `/api/v1`. JSON in and out. Every error response has this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "path": "email", "code": "invalid_format", "message": "Invalid email address" }]
  }
}
```

`details` is optional. Common codes: `VALIDATION_ERROR` (400), `BAD_REQUEST` (400), `UNAUTHORIZED` (401),
`FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `TOO_MANY_REQUESTS` (429),
`INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503). Every response carries an `x-request-id` header.

| Method | Path              | Access                                  | Body / response                                                                                                                        |
| ------ | ----------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/health`  | public                                  | `200 { "status": "ok" }`; `503 SERVICE_UNAVAILABLE` if the DB is down                                                                  |
| POST   | `/api/v1/queries` | public, 5 req/min/IP                    | body `{ name: 1-200, organization?: ≤200 ("" → null), email: ≤200, requirements: 1-5000 }` (strings trimmed) → `201 { id, createdAt }` |
| GET    | `/api/v1/queries` | `Authorization: Bearer <ADMIN_API_KEY>` | `200 Query[]`, newest first                                                                                                            |

All other routes are rate limited to 100 req/min/IP.

## The OpenAPI contract (`openapi.json`)

The zod schemas in `src/<module>/dto/` (via `nestjs-zod`'s `createZodDto`) are the source of truth.
`@nestjs/swagger` builds the OpenAPI document from them, and `npm run openapi:export` writes it to
**`openapi.json` at the repo root, which is committed**. CI runs `npm run openapi:check` and fails if it is stale.

The website consumes it:

```bash
# in ../kritex-website
npm run api:gen   # openapi-typescript: ../kritex-server/openapi.json → src/lib/api/schema.d.ts
```

Requests there go through a typed `openapi-fetch` client. In CI/preview the website can generate from
`$API_URL/api/docs-json` instead.

Schema names: request DTOs appear as `<Name>Dto`; response DTOs (declared with `@ZodResponse`) appear as
`<Name>Dto_Output`, for example `CreateQueryResponseDto_Output` and `QueryDto_Output`.

**Rule:** any PR that changes the API regenerates and commits `openapi.json`. Changes inside `/api/v1` are
additive only (add fields or endpoints; never rename or remove them).

## Project layout

```
src/
  main.ts            bootstrap (rawBody, logger, swagger outside prod)
  app.setup.ts       prefix, helmet, CORS, shutdown hooks, OpenAPI builder (shared by main, tests, export)
  app.module.ts      registers every module (one line per domain module)
  config/            ConfigModule + zod env schema + AppConfigService
  prisma/            global PrismaModule / PrismaService
  common/            AppException, AllExceptionsFilter, guards, shared DTOs
  health/            GET /health
  queries/           contact / tender inquiries
test/                e2e specs + helpers (createTestApp, resetDatabase, resetThrottler)
scripts/             export-openapi.ts
prisma/              schema.prisma + migrations
```

## Docker

`docker-compose.yml` (project name `kritex-server`):

- `postgres`: dev DB on `localhost:5433` (named volume `kritex_postgres_data`)
- `postgres-test`: test DB on `localhost:5434` (tmpfs, wiped on restart)

## CI

`.github/workflows/ci.yml` on Node 22: `npm ci` → `prisma generate` → lint → typecheck → unit →
e2e (Postgres service container) → build → `openapi:check`.
