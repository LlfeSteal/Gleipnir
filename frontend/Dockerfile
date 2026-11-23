# Stage 1: build the React app
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: lightweight nginx runtime, as a non-root user (uid 101) listening on 8080
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# Turned into /etc/nginx/conf.d/default.conf at startup, with GLEIPNIR_BACKEND_URL substituted
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# Address of the backend (the docker compose service name)
ENV GLEIPNIR_BACKEND_URL=http://backend:8080
EXPOSE 8080
# busybox wget is in the alpine image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
