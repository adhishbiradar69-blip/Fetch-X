# Fetch-X frontend — build with Vite, serve with nginx (SPA + /api proxy)
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# VITE_API_URL defaults to '/api' — nginx below proxies /api to the backend
# service, so no build-time env is needed for the compose setup.
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
