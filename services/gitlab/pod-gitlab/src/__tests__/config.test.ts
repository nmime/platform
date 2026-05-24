import { GitLabPodConfigError, loadGitLabPodConfig, validateGitLabPodConfig, type GitLabPodConfig } from '../config'

describe('GitLab pod configuration', () => {
  it('loads Huly delivery adapter settings from environment variables', () => {
    const config = loadGitLabPodConfig({
      GITLAB_WEBHOOK_SECRET_REQUIRED: 'false',
      GITLAB_BASE_URL: 'https://gitlab.example.com/',
      GITLAB_TOKEN: 'gitlab-token',
      GITLAB_TOKEN_TYPE: 'oauth',
      HULY_WEBHOOK_URL: 'https://huly.example.com/gitlab',
      HULY_TOKEN: 'webhook-token',
      HULY_MCP_BASE_URL: 'https://mcp.example.com/',
      HULY_MCP_TOKEN: 'mcp-token',
      HULY_API_BASE_URL: 'https://api.example.com',
      HULY_API_TOKEN: 'api-token',
      HULY_DEFAULT_WORKSPACE: 'demo'
    })

    expect(config.GitLabBaseURL).toBe('https://gitlab.example.com/')
    expect(config.GitLabToken).toBe('gitlab-token')
    expect(config.GitLabTokenType).toBe('oauth')
    expect(config.HulyWebhookURL).toBe('https://huly.example.com/gitlab')
    expect(config.HulyMcpBaseURL).toBe('https://mcp.example.com/')
    expect(config.HulyApiBaseURL).toBe('https://api.example.com')
    expect(config.HulyDefaultWorkspace).toBe('demo')
  })

  it('requires a webhook secret when enabled', () => {
    expect(() => loadGitLabPodConfig({ GITLAB_WEBHOOK_SECRET_REQUIRED: 'true' })).toThrow(GitLabPodConfigError)
  })

  it('accepts local development without a webhook secret when explicitly disabled', () => {
    const config = loadGitLabPodConfig({
      GITLAB_WEBHOOK_SECRET_REQUIRED: 'false',
      PORT: '3571',
      GITLAB_MAX_WEBHOOK_BODY_BYTES: '2048'
    })

    expect(config.Port).toBe(3571)
    expect(config.MaxWebhookBodyBytes).toBe(2048)
    expect(config.GitLabWebhookSecretRequired).toBe(false)
  })

  it('validates adapter URLs and readiness token requirements', () => {
    const config: GitLabPodConfig = {
      AllowedWorkspaces: ['*'],
      GitLabBaseURL: 'https://gitlab.com',
      GitLabReadinessProject: 'group/project',
      GitLabTokenType: 'pat',
      GitLabWebhookSecretRequired: false,
      HulyWebhookURL: 'not-a-url',
      LogPayloads: false,
      MaxWebhookBodyBytes: 2048,
      Port: 3570,
      ServiceID: 'gitlab-service'
    }

    expect(() => validateGitLabPodConfig(config)).toThrow(/HULY_WEBHOOK_URL.*GITLAB_TOKEN/)
  })
})
