FROM node:20-alpine AS build

WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/student-web/package.json apps/student-web/package.json
RUN pnpm install --frozen-lockfile --filter @unihub/student-web...

COPY apps/student-web apps/student-web
WORKDIR /repo/apps/student-web

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm build

FROM nginx:1.27-alpine

COPY apps/student-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/student-web/dist /usr/share/nginx/html

EXPOSE 80
