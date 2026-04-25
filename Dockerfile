FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM oven/bun:1.2.15-alpine
WORKDIR /app

# Runtime dependencies for frontend + edge proxy.
RUN apk add --no-cache nodejs npm caddy

# Backend deps and sources.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY tsconfig.json ./

# Frontend runtime and build output.
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --omit=dev
COPY --from=frontend-build /app/frontend/.next ./frontend/.next
COPY --from=frontend-build /app/frontend/public ./frontend/public
COPY --from=frontend-build /app/frontend/next.config.mjs ./frontend/next.config.mjs

COPY Caddyfile ./Caddyfile
COPY start-all.sh ./start-all.sh
RUN chmod +x ./start-all.sh

EXPOSE 8080

CMD ["/app/start-all.sh"]
