# One-shot deploy job for the self-hosted Convex backend (see scripts/deploy.sh).
# Built on the pinned backend image: it already ships Node.js and the
# generate_key tool that derives the admin key from INSTANCE_SECRET.
FROM ghcr.io/get-convex/convex-backend:0cf49cbf8c4b7e22e631ceda9b5111f6cccbcd49

ENV NODE_ENV=production \
    npm_config_update_notifier=false \
    CONVEX_TELEMETRY_DISABLED=1 \
    PATH="/convex:$PATH"
WORKDIR /workspace
# The npm bundled with the base image carries known advisories (tar, pacote,
# sigstore); use the current npm 11 release instead.
# (Installed with a separate npm 11 process: npm cannot replace itself in place.)
RUN npx --yes npm@11 install --global npm@11 --no-audit --no-fund --loglevel=error \
 && npm cache clean --force

# Install only the Convex workspace's dependencies (npm workspaces need every
# workspace manifest present to read the lockfile).
COPY package.json package-lock.json ./
COPY apps/convex/package.json apps/convex/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/api-client/package.json packages/api-client/
RUN npm ci --workspace @geo-platform/convex --include=dev --ignore-scripts --no-audit --no-fund

COPY apps/convex apps/convex
# Run the deploy job as an unprivileged user. The Convex CLI writes only its
# config/cache under HOME.
RUN useradd --system --uid 10001 --home-dir /home/deploy --create-home deploy \
 && chown -R deploy:deploy /workspace/apps/convex
ENV HOME=/home/deploy
USER deploy
WORKDIR /workspace/apps/convex
ENTRYPOINT []
CMD ["./scripts/deploy.sh"]
