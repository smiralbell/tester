FROM oven/bun:1.2.15-alpine

WORKDIR /app

# Install backend dependencies first for better cache reuse.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Backend sources and runtime config.
COPY src ./src
COPY tsconfig.json ./

EXPOSE 8000

CMD ["bun", "run", "start"]
