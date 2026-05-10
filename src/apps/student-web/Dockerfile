FROM node:20-alpine AS build

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/student-web/package.json ./apps/student-web/package.json

RUN pnpm install --frozen-lockfile --filter @unihub/student-web...

COPY apps/student-web ./apps/student-web

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm --filter @unihub/student-web run build

FROM nginx:1.27-alpine

COPY apps/student-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/student-web/dist /usr/share/nginx/html

EXPOSE 80
