# Multi-stage production build for Baileys Operator Engine
FROM node:20-alpine AS builder

WORKDIR /app

# Was `npm install` against no committed lockfile at all — every single
# build resolved fresh dependency versions within whatever semver ranges
# package.json allowed. Baileys (@whiskeysockets/baileys) is a fast-moving
# unofficial WhatsApp client with no stability guarantees between minor
# versions; a routine redeploy could silently pull in a breaking version
# with zero code change on your side. `npm ci` requires and strictly
# honors the committed package-lock.json, so a build only ever installs
# exactly what was tested.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package*.json ./
# --only=production is deprecated in favor of --omit=dev (same effect,
# current npm syntax).
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
