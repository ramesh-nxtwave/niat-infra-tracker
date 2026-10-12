# NIAT InfraTracker

A command-center web app for NIAT field teams to track infrastructure readiness across partner universities — checklists, evidence photos, audit logs, and role-based access for admins, zonal managers, and APMs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port from `PORT` env, default 8080)
- `pnpm --filter @workspace/infra-tracker run dev` — run the frontend (Vite dev server)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run db:push` — push Prisma schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (auto-set by Replit)

### Seed / Reset
```bash
cd artifacts/api-server && pnpm dlx tsx src/scripts/seed.ts
```
Seeds 73 checklist items across 4 modules + admin user `admin@niat.ac.in / Admin@123`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **API**: Express 5 + Prisma 5.22.0 + PostgreSQL (Replit managed)
- **Auth**: JWT (`jsonwebtoken`) + `bcryptjs` — NO Supabase
- **Uploads**: `multer`, stored in `artifacts/api-server/uploads/`, served at `/api/uploads/:filename`
- **Frontend**: React 18 + Vite, React Router v6
- **Validation**: Zod (`zod/v4`)

## Where things live

| Path | Purpose |
|------|---------|
| `artifacts/api-server/src/routes/` | All Express route handlers |
| `artifacts/api-server/src/lib/auth.ts` | JWT sign/verify, `requireAuth`, `requireRole` middleware |
| `artifacts/api-server/prisma/schema.prisma` | Source-of-truth DB schema |
| `artifacts/api-server/src/scripts/seed.ts` | Checklist seed + admin user |
| `artifacts/infra-tracker/src/context/AuthContext.jsx` | JWT auth, `authFetch` helper, user/RBAC state |
| `artifacts/infra-tracker/src/context/DataContext.jsx` | All university/space/checklist data via `authFetch` |
| `artifacts/infra-tracker/src/utils/imageUtils.js` | Photo upload + history via `/api/upload` |
| `artifacts/infra-tracker/src/utils/auditLogger.js` | Audit log writes via `POST /api/dashboard/audit` |

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | public | email+password → JWT |
| GET | `/api/auth/me` | any | current user from token |
| GET/POST | `/api/users` | admin | list / create users |
| PUT/DELETE | `/api/users/:id` | admin | update / delete user |
| GET/POST | `/api/universities` | any | list / create universities |
| GET/PUT/DELETE | `/api/universities/:id` | any | university CRUD |
| GET/POST | `/api/universities/:id/classrooms` | any | classroom list / create |
| PATCH | `/api/universities/:id/status` | any | update checklist item status |
| GET/POST | `/api/universities/:id/updates` | any | daily updates |
| POST | `/api/upload` | any | multer file upload |
| GET | `/api/evidence` | any | list evidence photos |
| GET | `/api/evidence/photo-history/:statusId` | any | photo history for a status |
| GET | `/api/dashboard` | any | stats summary |
| GET | `/api/dashboard/audit` | admin | audit log list |
| POST | `/api/dashboard/audit` | any | write audit log entry |
| POST | `/api/evidence-gc/dry-run` | admin | bounded, durable evidence retention preview |
| POST | `/api/evidence-gc/apply` | admin | explicitly apply a matching dry-run |
| GET | `/api/evidence-gc/runs/:runId` | admin | inspect durable GC outcomes |
| GET | `/api/healthz` | public | health check |

## Architecture decisions

- **Prisma 5.22 (not v7)** — Prisma 7 broke datasource URL syntax in Replit's build environment; 5.22 is stable and `prisma db push` runs cleanly.
- **bcryptjs (not native bcrypt)** — native bcrypt requires build scripts that Replit's sandbox blocks; bcryptjs is pure JS.
- **JWT in localStorage** — token key `niat_token`, user cache key `niat_user`; `authFetch` in AuthContext automatically attaches the Bearer header.
- **Supabase fully removed** — `config/supabase.js` is a null-export stub; `@supabase/supabase-js` removed from package.json; all data flows through `/api`.
- **multer uploads** — files land in `artifacts/api-server/uploads/` and are served as static assets at `/api/uploads/:filename`.

## Product

- **Login** with email + password, JWT-based session
- **Dashboard** — university completion stats, audit log
- **Universities** — add/edit/delete universities with zone, APM, POC, target date
- **Checklist** — 73 items across 4 modules (Model Classroom, 5.0 Lab, Staff Room, Overall Classroom); status: Done / In-Progress / Blocker / Yet to start / No info
- **Evidence Board** — upload photos per checklist status, view photo history per item
- **Access Management** — admin-only user CRUD with role assignment (admin / zonal_manager / apm)
- **University Updates** — daily free-text progress updates per university

## User preferences

- Use Prisma 5 (not Drizzle, not Supabase) for all DB access
- No external auth providers — JWT only
- Keep seeded admin: `admin@niat.ac.in / Admin@123`

## Gotchas

- After any schema change: `cd artifacts/api-server && npx prisma db push --schema=prisma/schema.prisma` then restart the API server
- After any route change: restart the API server (it builds with esbuild before starting)
- `prisma generate` must run before `prisma db push` if the client is out of sync: `npx prisma generate --schema=prisma/schema.prisma`
- The Vite frontend proxies `/api` — in dev the proxy target is the `VITE_API_URL` env or falls back to relative (works via Replit's reverse proxy)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Prisma schema: `artifacts/api-server/prisma/schema.prisma`
- Seed script: `artifacts/api-server/src/scripts/seed.ts`
