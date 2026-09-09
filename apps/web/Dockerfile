FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined at build time, so the downloads flag must be
# present here for the docker (self-hosted) build to enable the worker tools.
ARG NEXT_PUBLIC_ENABLE_DOWNLOADS=1
ENV NEXT_PUBLIC_ENABLE_DOWNLOADS=$NEXT_PUBLIC_ENABLE_DOWNLOADS
# Set to "0" on low-RAM self-host deployments (e.g. 1GB free-tier VPS) to hide
# the worker-side bg-remove tool, which loads an ONNX model into memory.
ARG NEXT_PUBLIC_ENABLE_HEAVY_WORKER_TOOLS=1
ENV NEXT_PUBLIC_ENABLE_HEAVY_WORKER_TOOLS=$NEXT_PUBLIC_ENABLE_HEAVY_WORKER_TOOLS
# Emit .next/standalone for the runner stage below.
ENV NEXT_OUTPUT_STANDALONE=1
RUN pnpm --filter @furinakit/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p /data/storage && chown -R nextjs:nodejs /data/storage
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV STORAGE_PATH=/data/storage
ENV REDIS_URL=redis://redis:6379/0
CMD ["node", "apps/web/server.js"]
