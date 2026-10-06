# kritex-server

Backend API for the Kritex website. Currently handles contact/tender inquiry
submissions from the frontend; built on a stack (Express + TypeScript +
PostgreSQL + Prisma) meant to grow into the future ecommerce backend
(products, carts, orders, auth).

## Setup

```bash
cd server
cp .env.example .env
docker compose up -d          # starts Postgres on localhost:5432
npm install
npm run prisma:migrate        # creates the database schema
npm run dev                   # starts the API on http://localhost:4000
```

## Endpoints

- `GET /api/health` — health check
- `POST /api/queries` — public, submits a contact/tender inquiry
  ```json
  { "name": "...", "organization": "...", "email": "...", "requirements": "..." }
  ```
- `GET /api/queries` — admin only, lists submitted inquiries. Requires
  `Authorization: Bearer <ADMIN_API_KEY>` (set in `.env`).

## Data

`npm run prisma:studio` opens a browser UI to inspect the database.
