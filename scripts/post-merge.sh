#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --dir artifacts/api-server exec prisma generate --schema=prisma/schema.prisma
pnpm --dir artifacts/api-server exec prisma migrate deploy --schema=prisma/schema.prisma
pnpm --dir artifacts/api-server run db:setup-evidence-gc
