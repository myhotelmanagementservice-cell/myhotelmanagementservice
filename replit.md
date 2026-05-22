# Hotel Management System

A full-stack hotel management web app for managing rooms, guests, and bookings — with a live dashboard showing occupancy, revenue, and today's check-ins/outs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/hotel-management run dev` — run the frontend (port 18356)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, wouter, TanStack Query, shadcn/ui, Tailwind CSS
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/db/src/schema/` — Drizzle table definitions (rooms, guests, bookings)
- `artifacts/api-server/src/routes/` — Express route handlers (rooms, guests, bookings, dashboard)
- `artifacts/hotel-management/src/` — React frontend (pages, components)
- `lib/api-client-react/src/generated/` — Generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — Generated Zod schemas for server validation (do not edit)

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → typed hooks + Zod validators
- Single shared Express API server used by the frontend; no separate BFF layer
- Bookings automatically update room status (reserved on create, occupied on check-in, available on check-out)
- Dashboard endpoints compute aggregates in Postgres (no app-layer caching needed at this scale)
- Navy/teal + amber color theme via CSS custom properties in index.css

## Product

- **Dashboard** — real-time stats: total rooms, occupancy, revenue today/this month, check-ins/outs
- **Rooms** — CRUD for hotel rooms with type, status, price, floor, capacity, amenities
- **Guests** — searchable guest registry with contact info and ID details
- **Bookings** — full booking lifecycle: create → confirm → check-in → check-out → cancel

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Google Fonts `@import url(...)` must be the very first line in `index.css` — PostCSS will error otherwise
- After any OpenAPI spec change, always run `pnpm --filter @workspace/api-spec run codegen` before touching routes or hooks
- `pricePerNight` and `totalAmount` are stored as `numeric` in Postgres — cast to `Number()` before sending in JSON responses

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
