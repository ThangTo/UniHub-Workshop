# syntax=docker/dockerfile:1.7

# ---- builder ----
FROM node:20-alpine AS builder
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

WORKDIR /repo

# Copy workspace manifests for caching
COPY package.json pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/

# Install workspace deps for backend (best-effort: full install when packages/ later)
RUN pnpm install --filter "./apps/backend..." --frozen-lockfile=false

# Copy source
COPY apps/backend ./apps/backend

# Generate Prisma client + build
RUN pnpm --filter ./apps/backend exec prisma generate
RUN pnpm --filter ./apps/backend run build

# ---- runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
RUN apk add --no-cache wget

WORKDIR /app

# Copy built artifacts + node_modules
COPY --from=builder /repo/apps/backend/package.json ./package.json
COPY --from=builder /repo/apps/backend/dist ./dist
COPY --from=builder /repo/apps/backend/prisma ./prisma
COPY --from=builder /repo/apps/backend/node_modules ./node_modules
COPY --from=builder /repo/node_modules ./node_modules_root

EXPOSE 3000

CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
