# Next.js website (standalone output). Build context: repository root.
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 npm_config_update_notifier=false
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/convex/package.json apps/convex/
COPY packages/types/package.json packages/types/
COPY packages/api-client/package.json packages/api-client/
# npm may place some packages in workspace-level node_modules (version
# conflicts); create the folders so the COPY steps below always succeed.
RUN mkdir -p apps/web/node_modules packages/api-client/node_modules packages/types/node_modules \
 && npm ci --workspace @geo-platform/web --include=dev --no-audit --no-fund

FROM base AS build
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
ARG NEXT_PUBLIC_MAP_STYLE_URL=https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/resources/styles/root.json
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL \
    NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/convex ./apps/convex
COPY apps/web ./apps/web
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/api-client/node_modules ./packages/api-client/node_modules
COPY --from=deps /repo/packages/types/node_modules ./packages/types/node_modules
RUN npm run build --workspace @geo-platform/web

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# PORT may be overridden by the host (Render sets 10000). HOSTNAME is forced to
# 0.0.0.0 at start because some platforms set it to the container's name.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node apps/web/server.js"]
