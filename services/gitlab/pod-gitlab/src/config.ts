//
// Copyright © 2026 Hardcore Engineering Inc.
//

import type { GitLabTokenType } from './client'

/** @public */
export interface GitLabPodConfig {
  AccountsURL?: string
  AllowedWorkspaces: string[]
  FrontURL?: string
  GitLabBaseURL: string
  GitLabReadinessProject?: string
  GitLabToken?: string
  GitLabTokenType: GitLabTokenType
  GitLabWebhookSecret?: string
  GitLabWebhookSecretRequired: boolean
  HulyApiBaseURL?: string
  HulyApiToken?: string
  HulyDefaultWorkspace?: string
  HulyMcpBaseURL?: string
  HulyMcpToken?: string
  HulyToken?: string
  HulyWebhookURL?: string
  LogPayloads: boolean
  MaxWebhookBodyBytes: number
  Port: number
  ServerSecret?: string
  ServiceID: string
}

/** @public */
export const envMap = {
  AccountsURL: 'ACCOUNTS_URL',
  AllowedWorkspaces: 'ALLOWED_WORKSPACES',
  FrontURL: 'FRONT_URL',
  GitLabBaseURL: 'GITLAB_BASE_URL',
  GitLabReadinessProject: 'GITLAB_READINESS_PROJECT',
  GitLabToken: 'GITLAB_TOKEN',
  GitLabTokenType: 'GITLAB_TOKEN_TYPE',
  GitLabWebhookSecret: 'GITLAB_WEBHOOK_SECRET',
  GitLabWebhookSecretRequired: 'GITLAB_WEBHOOK_SECRET_REQUIRED',
  HulyApiBaseURL: 'HULY_API_BASE_URL',
  HulyApiToken: 'HULY_API_TOKEN',
  HulyDefaultWorkspace: 'HULY_DEFAULT_WORKSPACE',
  HulyMcpBaseURL: 'HULY_MCP_BASE_URL',
  HulyMcpToken: 'HULY_MCP_TOKEN',
  HulyToken: 'HULY_TOKEN',
  HulyWebhookURL: 'HULY_WEBHOOK_URL',
  LogPayloads: 'GITLAB_LOG_PAYLOADS',
  MaxWebhookBodyBytes: 'GITLAB_MAX_WEBHOOK_BODY_BYTES',
  Port: 'PORT',
  ServerSecret: 'SERVER_SECRET',
  ServiceID: 'SERVICE_ID'
} as const

/** @public */
export class GitLabPodConfigError extends Error {
  readonly issues: string[]

  constructor (issues: string[]) {
    super(`Invalid GitLab pod configuration: ${issues.join('; ')}`)
    this.name = 'GitLabPodConfigError'
    this.issues = issues
  }

  toJSON (): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      issues: this.issues
    }
  }
}

/** @public */
export function loadGitLabPodConfig (env: Record<string, string | undefined> = defaultEnv()): GitLabPodConfig {
  const config: GitLabPodConfig = {
    AccountsURL: emptyToUndefined(env[envMap.AccountsURL]),
    AllowedWorkspaces: splitList(env[envMap.AllowedWorkspaces] ?? '*'),
    FrontURL: emptyToUndefined(env[envMap.FrontURL]),
    GitLabBaseURL: env[envMap.GitLabBaseURL] ?? 'https://gitlab.com',
    GitLabReadinessProject: emptyToUndefined(env[envMap.GitLabReadinessProject]),
    GitLabToken: emptyToUndefined(env[envMap.GitLabToken]),
    GitLabTokenType: parseTokenType(env[envMap.GitLabTokenType]),
    GitLabWebhookSecret: emptyToUndefined(env[envMap.GitLabWebhookSecret]),
    GitLabWebhookSecretRequired: parseBool(env[envMap.GitLabWebhookSecretRequired], true),
    HulyApiBaseURL: emptyToUndefined(env[envMap.HulyApiBaseURL]),
    HulyApiToken: emptyToUndefined(env[envMap.HulyApiToken]),
    HulyDefaultWorkspace: emptyToUndefined(env[envMap.HulyDefaultWorkspace]),
    HulyMcpBaseURL: emptyToUndefined(env[envMap.HulyMcpBaseURL]),
    HulyMcpToken: emptyToUndefined(env[envMap.HulyMcpToken]),
    HulyToken: emptyToUndefined(env[envMap.HulyToken]),
    HulyWebhookURL: emptyToUndefined(env[envMap.HulyWebhookURL]),
    LogPayloads: parseBool(env[envMap.LogPayloads], false),
    MaxWebhookBodyBytes: parsePositiveInt(env[envMap.MaxWebhookBodyBytes], 1024 * 1024),
    Port: parsePositiveInt(env[envMap.Port], 3570),
    ServerSecret: emptyToUndefined(env[envMap.ServerSecret]),
    ServiceID: env[envMap.ServiceID] ?? 'gitlab-service'
  }

  validateGitLabPodConfig(config, env)
  return config
}

/** @public */
export function validateGitLabPodConfig (
  config: GitLabPodConfig,
  rawEnv: Record<string, string | undefined> = {}
): void {
  const issues: string[] = []

  if (!isHttpUrl(config.GitLabBaseURL)) {
    issues.push(`${envMap.GitLabBaseURL} must be an absolute http(s) URL`)
  }

  validateOptionalUrl(config.HulyWebhookURL, envMap.HulyWebhookURL, issues)
  validateOptionalUrl(config.HulyMcpBaseURL, envMap.HulyMcpBaseURL, issues)
  validateOptionalUrl(config.HulyApiBaseURL, envMap.HulyApiBaseURL, issues)

  const rawTokenType = emptyToUndefined(rawEnv[envMap.GitLabTokenType])
  if (rawTokenType !== undefined && rawTokenType !== 'pat' && rawTokenType !== 'oauth' && rawTokenType !== 'job') {
    issues.push(`${envMap.GitLabTokenType} must be one of: pat, oauth, job`)
  }

  if (!Number.isInteger(config.Port) || config.Port < 1 || config.Port > 65535) {
    issues.push(`${envMap.Port} must be an integer between 1 and 65535`)
  }

  if (!Number.isInteger(config.MaxWebhookBodyBytes) || config.MaxWebhookBodyBytes < 1024) {
    issues.push(`${envMap.MaxWebhookBodyBytes} must be at least 1024 bytes`)
  }

  if (config.GitLabWebhookSecretRequired && config.GitLabWebhookSecret === undefined) {
    issues.push(`${envMap.GitLabWebhookSecret} is required when ${envMap.GitLabWebhookSecretRequired}=true`)
  }

  if (config.GitLabWebhookSecretRequired && config.GitLabWebhookSecret === 'change-me') {
    issues.push(`${envMap.GitLabWebhookSecret} must be changed from the example value`)
  }

  if (config.GitLabReadinessProject !== undefined && config.GitLabToken === undefined) {
    issues.push(`${envMap.GitLabToken} is required when ${envMap.GitLabReadinessProject} is set`)
  }

  if (config.ServiceID.trim() === '') {
    issues.push(`${envMap.ServiceID} must not be empty`)
  }

  if (issues.length > 0) {
    throw new GitLabPodConfigError(issues)
  }
}

function validateOptionalUrl (value: string | undefined, name: string, issues: string[]): void {
  if (value !== undefined && !isHttpUrl(value)) {
    issues.push(`${name} must be an absolute http(s) URL`)
  }
}

function parseTokenType (value: string | undefined): GitLabTokenType {
  if (value === 'oauth' || value === 'job' || value === 'pat') {
    return value
  }
  return 'pat'
}

function parsePositiveInt (value: string | undefined, fallback: number): number {
  if (value == null || value === '') {
    return fallback
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseBool (value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') {
    return fallback
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false
    default:
      return fallback
  }
}

function splitList (value: string): string[] {
  const result = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
  return result.length === 0 ? ['*'] : result
}

function emptyToUndefined (value: string | undefined): string | undefined {
  return value == null || value.trim() === '' ? undefined : value.trim()
}

function isHttpUrl (value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function defaultEnv (): Record<string, string | undefined> {
  return (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
}
