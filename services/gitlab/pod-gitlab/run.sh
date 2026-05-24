#!/usr/bin/env bash
set -euo pipefail

export GITLAB_BASE_URL="${GITLAB_BASE_URL:-https://gitlab.com}"
export GITLAB_WEBHOOK_SECRET_REQUIRED="${GITLAB_WEBHOOK_SECRET_REQUIRED:-true}"
export PORT="${PORT:-3570}"
export SERVICE_ID="${SERVICE_ID:-gitlab-service}"

rush bundle --to @hcengineering/pod-gitlab
node "$@" bundle/bundle.js
