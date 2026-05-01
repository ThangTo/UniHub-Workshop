FROM node:20-alpine AS build

WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN pnpm install --frozen-lockfile --filter @unihub/admin-web...

COPY apps/admin-web apps/admin-web
WORKDIR /repo/apps/admin-web

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm build

FROM nginx:1.27-alpine

COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin-web/dist /usr/share/nginx/html

EXPOSE 80
