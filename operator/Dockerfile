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

# busybox wget (node:20-alpine) does NOT support GNU wget's --no-verbose /
# --tries long flags — the check exited non-zero on every run, leaving the
# container permanently "unhealthy" in plain Docker deployments (Render
# ignores Docker HEALTHCHECK and uses its own health path, which is why
# production never noticed). Use busybox-compatible short flags.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -T 4 -O /dev/null http://localhost:3001/health || exit 1

# Don't run the WhatsApp engine as root.
USER node

CMD ["node", "dist/index.js"]
