# syntax=docker/dockerfile:1

# Debian slim plus OpenSSL: Prisma's query engine links against it (alpine and bare slim lack it)
FROM node:22-slim AS base
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Build stage
FROM base AS build-stage

ARG NODE_OPTIONS
ENV NODE_OPTIONS=$NODE_OPTIONS

# next.config.js reads these at build time to allow the upload host in images.remotePatterns;
# they are not secrets (the AWS keys stay in .env and only reach the running container)
ARG AWS_REGION
ARG AWS_S3_BUCKET
ARG NEXT_PUBLIC_S3_PUBLIC_URL
ENV AWS_REGION=$AWS_REGION \
    AWS_S3_BUCKET=$AWS_S3_BUCKET \
    NEXT_PUBLIC_S3_PUBLIC_URL=$NEXT_PUBLIC_S3_PUBLIC_URL

# postinstall runs `prisma generate`, which needs the schema
COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN --mount=type=cache,id=messenger-npm,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

COPY . .

RUN --mount=type=cache,id=messenger-next,target=/app/.next/cache,sharing=locked \
    npm run build

# Keeps the generated Prisma client and the prisma CLI (a dependency, for `prisma db push` at deploy)
RUN npm prune --omit=dev --no-audit --no-fund

# Production stage
FROM base AS prod-stage

ENV NODE_ENV=production
# Listen on every interface inside the container so the port mapping reaches the server
ENV HOSTNAME=0.0.0.0

# The custom server (server.ts: Next + socket.io) runs from source through tsx, so it needs the app
# source next to .next; .next/cache must be writable for next/image
COPY --from=build-stage --chown=node:node /app ./

USER node

EXPOSE 3000

# /api/health answers 200 once the database is reachable and socket.io is up (the deploy job waits for
# "healthy"). PORT comes from the env file at run time; node 22 has fetch built in
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# tsx as a loader keeps a single node process, so SIGTERM from `docker stop` reaches the server
CMD ["node", "--import", "tsx", "server.ts"]
