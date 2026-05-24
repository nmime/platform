# Huly GitLab integration pod

This directory contains a ready-to-run external GitLab pod for Huly/Platform:

- `gitlab`: shared TypeScript DTOs and mappers for GitLab projects, issues, notes/comments, labels, users, and statuses. Mappers emit stable external IDs such as `gitlab:project:<id>` and `gitlab:issue:<projectId>:<iid>`.
- `pod-gitlab`: HTTP service that verifies GitLab webhooks, normalizes project/issue/comment/label/user/status sync events, and POSTs them to configured Huly delivery adapters.

## Quick start

```bash
cp services/gitlab/pod-gitlab/.env.example services/gitlab/pod-gitlab/.env
# edit .env: set GITLAB_WEBHOOK_SECRET and at least one Huly adapter for persistence
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build --to @hcengineering/gitlab --to @hcengineering/pod-gitlab
cd services/gitlab/pod-gitlab
node --env-file=.env lib/index.js
```

Local webhook smoke test without a secret:

```bash
cd services/gitlab/pod-gitlab
GITLAB_WEBHOOK_SECRET_REQUIRED=false rushx run-local
curl -X POST http://localhost:3570/api/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Gitlab-Event: Issue Hook' \
  -d '{"object_kind":"issue","project":{"id":1,"name":"Demo","path_with_namespace":"acme/demo","web_url":"https://gitlab.com/acme/demo"},"user":{"id":2,"username":"dev","name":"Dev"},"object_attributes":{"id":9,"iid":3,"project_id":1,"title":"Demo issue","description":"Created from curl","state":"opened","url":"https://gitlab.com/acme/demo/-/issues/3","action":"open"},"labels":[{"id":5,"title":"backend","color":"#4287f5"}]}'
```

## GitLab setup

Create a project or group webhook in GitLab:

- URL: `https://<public-pod-host>/api/webhook` (or `https://<public-pod-host>/api/v1/webhook/gitlab`)
- Secret token: value of `GITLAB_WEBHOOK_SECRET`
- Events: Issue events, Comments, Project events, Label events, and User events as needed.

A GitLab token is not required for receiving webhooks. Set `GITLAB_TOKEN` with `read_api` scope to enable readiness checks and the API-helper endpoints below.

## Huly delivery adapters

Configure one or more adapters. For every valid webhook, the pod posts the normalized payload to each configured adapter and includes `Authorization: Bearer <token>` when the matching token env var is set.

1. `HULY_WEBHOOK_URL` + optional `HULY_TOKEN`: POST to the exact configured URL.
2. `HULY_MCP_BASE_URL` + optional `HULY_MCP_TOKEN`: POST to `${HULY_MCP_BASE_URL}/tools/huly_gitlab_upsert`.
3. `HULY_API_BASE_URL` + optional `HULY_API_TOKEN`: POST to `${HULY_API_BASE_URL}/api/integrations/gitlab/upsert`.

If no adapter is configured, the service still starts and logs `gitlab.delivery.no-adapter`. If GitLab payload verification/parsing succeeds but any configured adapter fails, the webhook response is HTTP 502.

## HTTP endpoints

Health/readiness:

- `GET /health`
- `GET /healthz`
- `GET /livez`
- `GET /ready`
- `GET /readyz`
- `GET /readiness`

Webhook ingestion:

- `POST /api/webhook`
- `POST /api/v1/webhook/gitlab`

API helpers (GET; protected by `SERVER_SECRET` when set):

- `GET /api/v1/projects?search=<text>&membership=true&owned=false&simple=true`
- `GET /api/v1/projects/:project/issues?state=opened&labels=backend&search=text`
- `GET /api/v1/projects/:project/labels`
- `GET /api/v1/users?search=<text>&username=<name>&active=true`

For `:project`, pass a numeric GitLab project ID or URL-encode a path, e.g. `group%2Fproject`.

## Docker

```bash
node common/scripts/install-run-rush.js bundle --to @hcengineering/pod-gitlab
cd services/gitlab/pod-gitlab
docker build -t huly-gitlab-pod .
docker run --rm -p 3570:3570 --env-file .env huly-gitlab-pod
```

## Build/test

```bash
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build --to @hcengineering/gitlab --to @hcengineering/pod-gitlab
node common/scripts/install-run-rush.js test --to @hcengineering/gitlab --to @hcengineering/pod-gitlab
```
