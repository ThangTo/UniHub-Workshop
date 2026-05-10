# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
RUN apk add --no-cache openssl

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json

RUN pnpm install --frozen-lockfile --filter @unihub/backend...

COPY apps/backend ./apps/backend

RUN pnpm --filter @unihub/backend exec prisma generate
RUN pnpm --filter @unihub/backend run build

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
RUN apk add --no-cache openssl wget

WORKDIR /repo

COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/backend ./apps/backend

WORKDIR /repo/apps/backend

EXPOSE 3000

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
