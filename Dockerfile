# re:Fresh — single image used for both the web app and the scraper scripts
# (docker compose exec app npm run scrape / reprocess / detect-variants / db:snapshot).
# Not using Next's "standalone" output on purpose: the scraper scripts run via
# tsx (a devDependency) and aren't traced by Next's build, so we keep the full
# node_modules tree instead of a pruned one.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# postgresql-client for pg_dump/pg_restore, used by npm run db:snapshot / db:restore
RUN apk add --no-cache postgresql-client

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

# Apply any pending migrations, then start the server. Safe to run on every
# boot: migrate deploy is a no-op when the schema is already up to date.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
