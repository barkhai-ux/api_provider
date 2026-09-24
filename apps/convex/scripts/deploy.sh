#!/usr/bin/env bash
# Deploys the Convex functions and configures the deployment. Two targets:
#
#   Convex Cloud: set CONVEX_DEPLOY_KEY (Dashboard > Settings > Deploy keys),
#                 or CONVEX_DEPLOYMENT (e.g. dev:happy-otter-123) after
#                 `npx convex login` on this machine. With CONVEX_DEPLOYMENT,
#                 CONVEX_PROD=true targets the project's production deployment.
#   Self-hosted:  set CONVEX_SELF_HOSTED_URL plus either
#                 CONVEX_SELF_HOSTED_ADMIN_KEY or INSTANCE_NAME + INSTANCE_SECRET
#                 (the admin key is then derived with the backend's generate_key).
#
# Always required: API_KEY_PEPPER, GATEWAY_SECRET, SITE_URL.
# Optional: SITE_API_KEY, RATE_LIMIT_PER_MINUTE, USAGE_RETENTION_DAYS,
# EMAIL_BACKEND, EMAIL_FROM, RESEND_API_KEY, ENVIRONMENT (default production),
# and for development only SEED_DEMO_ACCOUNT=true with DEMO_EMAIL,
# DEMO_PASSWORD, DEMO_API_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${API_KEY_PEPPER:?API_KEY_PEPPER is required}"
: "${GATEWAY_SECRET:?GATEWAY_SECRET is required}"
: "${SITE_URL:?SITE_URL (the website origin) is required}"
ENVIRONMENT="${ENVIRONMENT:-production}"

PUSH=(deploy --yes)
# Extra flags for `convex env` and `convex run` (selects the production deployment).
TARGET=()
if [[ -n "${CONVEX_DEPLOY_KEY:-}" ]]; then
  # The Convex CLI prefers self-hosted settings when present; drop them.
  unset CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
  export CONVEX_DEPLOY_KEY
  echo "Target: Convex Cloud (deploy key)"
elif [[ -n "${CONVEX_DEPLOYMENT:-}" ]]; then
  unset CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
  export CONVEX_DEPLOYMENT
  if [[ "${CONVEX_PROD:-false}" == "true" ]]; then
    # `convex deploy` always targets the project's production deployment.
    TARGET=(--prod)
    echo "Target: Convex Cloud production deployment of ${CONVEX_DEPLOYMENT}'s project (CLI login)"
  else
    # Development deployments are pushed with `convex dev --once`.
    [[ "$CONVEX_DEPLOYMENT" == dev:* ]] && PUSH=(dev --once --typecheck try)
    echo "Target: Convex Cloud ${CONVEX_DEPLOYMENT} (CLI login)"
  fi
else
  : "${CONVEX_SELF_HOSTED_URL:?Set CONVEX_DEPLOY_KEY (Convex Cloud) or CONVEX_SELF_HOSTED_URL (self-hosted)}"
  if [[ -z "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ]]; then
    : "${INSTANCE_NAME:?INSTANCE_NAME is required to derive the admin key}"
    : "${INSTANCE_SECRET:?INSTANCE_SECRET is required to derive the admin key}"
    CONVEX_SELF_HOSTED_ADMIN_KEY="$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")"
  fi
  export CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
  echo "Target: self-hosted Convex at ${CONVEX_SELF_HOSTED_URL}"
  echo "Waiting for Convex..."
  for _ in $(seq 1 60); do
    curl -fsS "${CONVEX_SELF_HOSTED_URL}/version" >/dev/null 2>&1 && break
    sleep 1
  done
fi

convex() { npx --no-install convex "$@"; }
convex_env() { convex env "$1" "${TARGET[@]}" "${@:2}"; }

# Session signing keys: generated once and kept, so restarts do not sign everyone out.
if [[ -z "$(convex_env get JWT_PRIVATE_KEY 2>/dev/null)" ]]; then
  echo "Generating Convex Auth signing keys..."
  mapfile -t keys < <(node scripts/generate-auth-keys.mjs)
  convex_env set JWT_PRIVATE_KEY -- "${keys[0]}" >/dev/null
  convex_env set JWKS -- "${keys[1]}" >/dev/null
fi

set_env() {
  local name="$1" value="${2:-}"
  if [[ -n "$value" ]]; then
    convex_env set "$name" -- "$value" >/dev/null
  fi
}
set_env SITE_URL "$SITE_URL"
set_env ENVIRONMENT "$ENVIRONMENT"
set_env API_KEY_PEPPER "$API_KEY_PEPPER"
set_env GATEWAY_SECRET "$GATEWAY_SECRET"
set_env SITE_API_KEY "${SITE_API_KEY:-}"
set_env RATE_LIMIT_PER_MINUTE "${RATE_LIMIT_PER_MINUTE:-100}"
set_env USAGE_RETENTION_DAYS "${USAGE_RETENTION_DAYS:-30}"
set_env EMAIL_BACKEND "${EMAIL_BACKEND:-console}"
set_env EMAIL_FROM "${EMAIL_FROM:-}"
set_env RESEND_API_KEY "${RESEND_API_KEY:-}"
if [[ "$ENVIRONMENT" != "production" && "${SEED_DEMO_ACCOUNT:-false}" == "true" ]]; then
  set_env DEMO_EMAIL "${DEMO_EMAIL:-}"
  set_env DEMO_PASSWORD "${DEMO_PASSWORD:-}"
  set_env DEMO_API_KEY "${DEMO_API_KEY:-}"
fi

echo "Deploying Convex functions..."
convex "${PUSH[@]}"

convex run "${TARGET[@]}" platform:ensureSiteKey
if [[ "$ENVIRONMENT" != "production" && "${SEED_DEMO_ACCOUNT:-false}" == "true" ]]; then
  echo "Seeding DEVELOPMENT-ONLY demo account..."
  convex run "${TARGET[@]}" platform:seedDevelopment
fi
echo "Convex deployment ready."
