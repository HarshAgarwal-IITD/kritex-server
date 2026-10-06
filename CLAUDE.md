# kritex-server: agent guide

NestJS API for the Kritex ecommerce site. Planning docs for **both** repos live in
`../kritex-website/docs/ecommerce/` (PLAN, ARCHITECTURE, DECISIONS, TASKS, EXECUTION). Read the relevant
ADRs and your task in TASKS.md before starting. ADR-012 (NestJS) and ADR-013 (separate repos, OpenAPI
contract) apply to everything here.

## Stack

- NestJS 11 on `@nestjs/platform-express` (Nest 12 is blocked until `nestjs-zod` supports it)
- Prisma 6 + PostgreSQL 16 (docker compose: dev `:5433`, test `:5434`)
- Validation and contract: `zod` (pinned `~4.4`, see below) + `nestjs-zod` (`createZodDto`, global
  `ZodValidationPipe`, `ZodSerializerInterceptor`, `@ZodResponse`) + `@nestjs/swagger`
- `@nestjs/config` (zod-validated env, use `AppConfigService`), `nestjs-pino`, `@nestjs/throttler`,
  `@nestjs/schedule`, `@nestjs/event-emitter`, `helmet`
- Jest (`@swc/jest`) + `@nestjs/testing` + supertest; ESLint (typescript-eslint, flat) + Prettier
- npm only (no bun/pnpm/yarn). TypeScript strict.

## Commands

```bash
docker compose up -d && npx prisma migrate deploy && npm run start:dev
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build && npm run openapi:check
npm run openapi:export        # after any API change, then commit openapi.json
```

## Folder conventions

One Nest module per domain. Each looks like this:

```
src/<module>/
  <module>.module.ts
  <module>.controller.ts        public/customer routes (thin)
  <module>.service.ts           business logic
  dto/                          zod schemas + createZodDto classes (request AND response)
  admin/                        admin controllers for this domain (e.g. admin-<module>.controller.ts)
  *.spec.ts                     unit specs next to the code
```

- Shared code goes in `src/common/` (exceptions, filters, guards, decorators, shared DTOs, utils),
  `src/config/` and `src/prisma/`.
- `src/app.module.ts` is the only shared registration file: add **one import line per module**.
- e2e specs: `test/<area>.e2e-spec.ts`, using `createTestApp()`, `resetDatabase()` and
  `resetThrottler()` from `test/utils.ts`.
- Scaffold with `npx nest g module|controller|service <name>`, then add `dto/`.

## Cross-cutting rules (ARCHITECTURE.md §5)

- **NestJS:** controllers stay thin (parse → call service → return); business logic lives in services.
  Cross-module side effects go through `EventEmitter2` events (`order.paid`, `order.shipped`,
  `quote.responded`), not direct imports, wherever possible. Admin routes use `@Roles('STAFF','ADMIN')`.
  Every route is authenticated unless marked `@Public()` (from Stage 2. Until then the only protected
  route uses the temporary `AdminApiKeyGuard` in `src/common/guards/`).
- **Validation:** every body/query/param uses a `createZodDto` built from the module's zod schema in
  `dto/`. No unvalidated input. Declare responses with `@ZodResponse({ status, type })` so they are
  validated, stripped and documented. Document error responses with `@ApiResponse({ status, type: ErrorResponseDto })`.
- **Contract:** any API change regenerates and commits `openapi.json` (`npm run openapi:export`) in the
  same PR. CI fails if it is stale. **`/api/v1` changes are additive only**: add fields and endpoints,
  never rename or remove them. Give every route an explicit `operationId` (`@ApiOperation`).
- **Money:** integer paise end-to-end. Formatting happens only in the UI.
- **Prices are computed on the server.** The client never sends prices. Checkout recomputes everything.
- **Idempotency:** checkout and webhooks are idempotent (`Idempotency-Key` header; unique `providerPaymentId`).
- **Transactions:** stock reservation, order creation and coupon usage happen in one Prisma
  `$transaction` with `SELECT … FOR UPDATE` on variants.
- **Security:** helmet, throttler (global 100/min; stricter `@Throttle` on auth, checkout, queries,
  quotes), CORS allowlist with credentials, CSRF protection (SameSite=Lax + Origin check on mutating
  routes), webhook signature checks on `req.rawBody`, no secrets in the frontend, env validated at boot
  (add new vars to `src/config/env.schema.ts` and `.env.example`).
- **Logging:** `nestjs-pino` structured logs with a request id (`x-request-id`). Never log card/payment
  payloads beyond provider IDs. Auth/cookie headers are redacted. Sentry comes later.
- **Errors:** throw `new AppException(code, status, message, details?)`. The global
  `AllExceptionsFilter` maps it, zod validation errors (`VALIDATION_ERROR`), HttpExceptions
  (`NOT_FOUND`, `UNAUTHORIZED`, `TOO_MANY_REQUESTS`, …) and Prisma errors (P2002 → 409 `CONFLICT`,
  P2025 → 404 `NOT_FOUND`) to `{ "error": { "code", "message", "details"? } }`. Unknown errors become
  500 `INTERNAL_ERROR` with no internals leaked. Use UPPER_SNAKE_CASE codes.
- **Testing:** Jest unit specs with `@nestjs/testing` for tax, pricing, coupons and stock; supertest e2e
  in `test/` against the test DB. Write real assertions on the response shape.

## Gotchas

- **zod is pinned to `~4.4`.** zod 4.5+ emits `type: ["string","null"]` for nullable fields, which
  nestjs-zod 5.5 + @nestjs/swagger render as an _array_. `src/openapi.spec.ts` guards this. Don't bump
  zod without checking that spec.
- Use `z.string().trim().max(n).email()` (not `z.email().trim()`): zod 4 runs format checks before trim
  on `z.email()`.
- Response schema names in OpenAPI get an `_Output` suffix (`QueryDto_Output`). Don't add
  `.meta({ id })` to DTO root schemas: it collides with the class-derived names.
- Nest DI needs value imports for injected classes (decorator metadata). ESLint's
  `consistent-type-imports` already skips files with decorators. Don't hand-convert those to `import type`.
- `openapi:export` creates the app without `init()`, so `onModuleInit` hooks (Prisma connect) don't run.
  Don't put route registration in `onModuleInit`.
- Keep committed migrations unchanged. Add new ones with `npm run prisma:migrate`.
