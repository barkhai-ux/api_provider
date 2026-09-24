# One-shot deploy job for the self-hosted Convex backend (see scripts/deploy.sh).
# Built on the pinned backend image: it already ships Node.js and the
# generate_key tool that derives the admin key from INSTANCE_SECRET.
FROM ghcr.io/get-convex/convex-backend:0cf49cbf8c4b7e22e631ceda9b5111f6cccbcd49

ENV NODE_ENV=production \
    npm_config_update_notifier=false \
    CONVEX_TELEMETRY_DISABLED=1 \
    PATH="/convex:$PATH"
WORKDIR /workspace

# Install only the Convex workspace's dependencies (npm workspaces need every
# workspace manifest present to read the lockfile).
COPY package.json package-lock.json ./
COPY apps/convex/package.json apps/convex/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/api-client/package.json packages/api-client/
RUN npm ci --workspace @geo-platform/convex --include=dev --ignore-scripts --no-audit --no-fund

COPY apps/convex apps/convex
WORKDIR /workspace/apps/convex
ENTRYPOINT []
CMD ["./scripts/deploy.sh"]
