# syntax=docker/dockerfile:1.7

# ---------- deps ----------
# Only needed to build the client. The server itself pulls in nothing from npm — see the runner stage.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- builder ----------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` is `tsc --noEmit && vite build`, so a type error fails the image rather than shipping.
# `npm run gen:data` is deliberately NOT run: src/data/generated/*.json is committed, and regenerating it here
# would let a new @pkmn/dex release silently change every drafted army between deploys.
RUN npm run build

# ---------- runner ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/app/data/pokemon-chess.db
ENV STATIC_DIR=/app/dist

# Node 24 specifically, on both counts. The server is started as `node server/main.ts` with no build step —
# TypeScript runs directly, which is unflagged from Node 23 — and it stores accounts in the built-in `node:sqlite`,
# which does not exist before 22.5. On Node 20 this image would fail two different ways at startup.

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 pokemon

# No node_modules. Verified by running the server from a tree containing only these paths: it served the client,
# answered the API, and created accounts in SQLite. `react` is client-only and `chess.js` is test-only, so the
# server's whole runtime graph is its own source plus node: builtins.
COPY --from=builder --chown=pokemon:nodejs /app/package.json ./package.json
COPY --from=builder --chown=pokemon:nodejs /app/server ./server
COPY --from=builder --chown=pokemon:nodejs /app/src ./src
COPY --from=builder --chown=pokemon:nodejs /app/dist ./dist

# The SQLite database lives here and is mounted as a Kamal volume, so it survives a deploy. Created with the right
# owner up front because the server runs unprivileged and would otherwise fail to create the file on a fresh volume.
RUN mkdir -p /app/data && chown pokemon:nodejs /app/data
VOLUME ["/app/data"]

USER pokemon
EXPOSE 8080
CMD ["node", "server/main.ts"]
