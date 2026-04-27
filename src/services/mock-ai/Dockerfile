# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY services/mock-ai/package.json ./services/mock-ai/
RUN pnpm install --filter "./services/mock-ai..." --frozen-lockfile=false

COPY services/mock-ai ./services/mock-ai
RUN pnpm --filter ./services/mock-ai run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /repo/services/mock-ai/package.json ./package.json
COPY --from=builder /repo/services/mock-ai/dist ./dist
COPY --from=builder /repo/services/mock-ai/node_modules ./node_modules

EXPOSE 4100
CMD ["node", "dist/index.js"]
