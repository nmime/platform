import { createDeliveryPayload, createGitLabDelivery, deliverGitLabSyncEvents, GitLabDeliveryError } from '../delivery'
import type { GitLabPodConfig } from '../config'
import type { GitLabWebhookEnvelope } from '../webhook'

const baseConfig: GitLabPodConfig = {
  AllowedWorkspaces: ['*'],
  GitLabBaseURL: 'https://gitlab.com',
  GitLabTokenType: 'pat',
  GitLabWebhookSecretRequired: false,
  LogPayloads: false,
  MaxWebhookBodyBytes: 1024 * 1024,
  Port: 3570,
  ServiceID: 'gitlab-service'
}

describe('Huly delivery adapters', () => {
  it('builds exact webhook, MCP, and API targets', () => {
    const delivery = createGitLabDelivery({
      ...baseConfig,
      HulyWebhookURL: 'https://huly.example.com/custom/gitlab',
      HulyToken: 'webhook-token',
      HulyMcpBaseURL: 'https://mcp.example.com/',
      HulyMcpToken: 'mcp-token',
      HulyApiBaseURL: 'https://api.example.com',
      HulyApiToken: 'api-token',
      HulyDefaultWorkspace: 'demo'
    })

    expect(delivery.targets).toEqual([
      { adapter: 'webhook', url: 'https://huly.example.com/custom/gitlab', token: 'webhook-token' },
      { adapter: 'mcp', url: 'https://mcp.example.com/tools/huly_gitlab_upsert', token: 'mcp-token' },
      { adapter: 'api', url: 'https://api.example.com/api/integrations/gitlab/upsert', token: 'api-token' }
    ])
    expect(delivery.workspace).toBe('demo')
  })

  it('posts normalized payloads with bearer tokens and reports failures', async () => {
    const envelope: GitLabWebhookEnvelope = {
      event: 'Issue Hook',
      eventUuid: 'event-1',
      tokenValid: true,
      payload: { object_kind: 'issue' }
    }
    const calls: Array<{ url: string, authorization?: string, body: string }> = []

    await deliverGitLabSyncEvents(
      {
        targets: [{ adapter: 'webhook', url: 'https://huly.example.com/gitlab', token: 'secret' }],
        workspace: 'demo',
        fetch: async (url, init) => {
          calls.push({ url, authorization: init.headers.Authorization, body: init.body })
          return { ok: true, status: 202, statusText: 'Accepted', text: async () => '' }
        }
      },
      envelope,
      []
    )

    expect(calls[0].url).toBe('https://huly.example.com/gitlab')
    expect(calls[0].authorization).toBe('Bearer secret')
    expect(JSON.parse(calls[0].body)).toMatchObject({ source: 'gitlab', workspace: 'demo', records: [] })

    await expect(
      deliverGitLabSyncEvents(
        {
          targets: [{ adapter: 'api', url: 'https://api.example.com/api/integrations/gitlab/upsert' }],
          fetch: async () => ({ ok: false, status: 503, statusText: 'Unavailable', text: async () => 'down' })
        },
        envelope,
        []
      )
    ).rejects.toThrow(GitLabDeliveryError)
  })

  it('creates Huly payloads with records and event metadata', () => {
    const payload = createDeliveryPayload(
      { workspace: 'demo' },
      { event: 'Issue Hook', eventUuid: 'event-1', tokenValid: true, payload: {} },
      []
    )

    expect(payload.source).toBe('gitlab')
    expect(payload.workspace).toBe('demo')
    expect(payload.event.name).toBe('Issue Hook')
    expect(payload.event.eventUuid).toBe('event-1')
    expect(payload.records).toEqual([])
  })
})
