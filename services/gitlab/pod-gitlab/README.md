# @hcengineering/pod-gitlab

External Huly GitLab integration service. It accepts GitLab webhooks, verifies `X-Gitlab-Token`, normalizes project/issue/comment/label/user/status sync events with `@hcengineering/gitlab`, and forwards them to configured Huly delivery adapters.

## Run locally

```bash
cp .env.example .env
# edit .env: set GITLAB_WEBHOOK_SECRET and HULY_WEBHOOK_URL or HULY_MCP_BASE_URL or HULY_API_BASE_URL
node ../../../common/scripts/install-run-rush.js update
node ../../../common/scripts/install-run-rush.js build --to @hcengineering/gitlab --to @hcengineering/pod-gitlab
node --env-file=.env lib/index.js
```

For local smoke tests without a webhook secret:

```bash
GITLAB_WEBHOOK_SECRET_REQUIRED=false rushx run-local
curl http://localhost:3570/health
curl -X POST http://localhost:3570/api/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Gitlab-Event: Issue Hook' \
  -d '{"object_kind":"issue","object_attributes":{"id":1,"iid":1,"project_id":1,"title":"Smoke","state":"opened","url":"https://gitlab.com/acme/demo/-/issues/1"}}'
```

## Endpoints

- `GET /health`, `/healthz`, `/livez`
- `GET /ready`, `/readyz`, `/readiness`
- `POST /api/webhook`
- `POST /api/v1/webhook/gitlab`
- `GET /api/v1/projects`
- `GET /api/v1/projects/:project/issues`
- `GET /api/v1/projects/:project/labels`
- `GET /api/v1/users`

## Delivery adapters

- `HULY_WEBHOOK_URL` posts to the exact URL.
- `HULY_MCP_BASE_URL` posts to `${HULY_MCP_BASE_URL}/tools/huly_gitlab_upsert`.
- `HULY_API_BASE_URL` posts to `${HULY_API_BASE_URL}/api/integrations/gitlab/upsert`.

Set `HULY_TOKEN`, `HULY_MCP_TOKEN`, or `HULY_API_TOKEN` to send `Authorization: Bearer ...`. If no adapter is configured the service logs `gitlab.delivery.no-adapter`; adapter failures return HTTP 502 for otherwise valid GitLab webhooks.

## Docker

```bash
node ../../../common/scripts/install-run-rush.js bundle --to @hcengineering/pod-gitlab
docker build -t huly-gitlab-pod .
docker run --rm -p 3570:3570 --env-file .env huly-gitlab-pod
```
