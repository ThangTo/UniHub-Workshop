# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/mock-pg/package.json ./services/mock-pg/package.json

RUN pnpm install --frozen-lockfile --filter @unihub/mock-pg...

COPY services/mock-pg ./services/mock-pg

RUN pnpm --filter @unihub/mock-pg run build

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

WORKDIR /repo

COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/services/mock-pg ./services/mock-pg

WORKDIR /repo/services/mock-pg

EXPOSE 4000

CMD ["node", "dist/index.js"]
