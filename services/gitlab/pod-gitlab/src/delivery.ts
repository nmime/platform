//
// Copyright © 2026 Hardcore Engineering Inc.
//

import type { GitLabPodConfig } from './config'
import type { GitLabSyncEvent } from './syncEvents'
import type { GitLabWebhookEnvelope } from './webhook'

/** @public */
export type HulyDeliveryAdapter = 'webhook' | 'mcp' | 'api'

/** @public */
export interface HulyDeliveryLogger {
  info: (message: string, fields?: Record<string, unknown>) => void
  error: (message: string, fields?: Record<string, unknown>) => void
}

/** @public */
export interface HulyDeliveryTarget {
  adapter: HulyDeliveryAdapter
  url: string
  token?: string
}

/** @public */
export interface HulyDeliveryRequestInit {
  method: 'POST'
  headers: Record<string, string>
  body: string
}

/** @public */
export interface HulyDeliveryResponseLike {
  ok: boolean
  status: number
  statusText: string
  text: () => Promise<string>
}

/** @public */
export type HulyDeliveryFetch = (url: string, init: HulyDeliveryRequestInit) => Promise<HulyDeliveryResponseLike>

/** @public */
export interface HulyDeliveryOptions {
  targets: HulyDeliveryTarget[]
  workspace?: string
  logger?: HulyDeliveryLogger
  fetch?: HulyDeliveryFetch
}

/** @public */
export interface HulyGitLabDeliveryPayload {
  source: 'gitlab'
  workspace?: string
  receivedAt: string
  event: {
    name: string
    eventUuid?: string
    webhookUuid?: string
    instance?: string
  }
  records: GitLabSyncEvent[]
  syncEvents: GitLabSyncEvent[]
}

/** @public */
export interface HulyDeliveryFailure {
  adapter: HulyDeliveryAdapter
  url: string
  status?: number
  statusText?: string
  error?: string
  responseBody?: string
}

/** @public */
export class GitLabDeliveryError extends Error {
  readonly failures: HulyDeliveryFailure[]

  constructor (failures: HulyDeliveryFailure[]) {
    super(`Huly GitLab delivery failed for ${failures.length} adapter(s)`)
    this.name = 'GitLabDeliveryError'
    this.failures = failures
  }
}

/** @public */
export function createGitLabDelivery (config: GitLabPodConfig, logger?: HulyDeliveryLogger): HulyDeliveryOptions {
  const targets: HulyDeliveryTarget[] = []

  if (config.HulyWebhookURL !== undefined) {
    targets.push({
      adapter: 'webhook',
      url: config.HulyWebhookURL,
      token: config.HulyToken
    })
  }

  if (config.HulyMcpBaseURL !== undefined) {
    targets.push({
      adapter: 'mcp',
      url: joinUrl(config.HulyMcpBaseURL, '/tools/huly_gitlab_upsert'),
      token: config.HulyMcpToken
    })
  }

  if (config.HulyApiBaseURL !== undefined) {
    targets.push({
      adapter: 'api',
      url: joinUrl(config.HulyApiBaseURL, '/api/integrations/gitlab/upsert'),
      token: config.HulyApiToken
    })
  }

  if (targets.length === 0) {
    logger?.info('gitlab.delivery.no-adapter')
  } else {
    logger?.info('gitlab.delivery.adapters-configured', {
      adapters: targets.map((target) => target.adapter)
    })
  }

  return {
    targets,
    workspace: config.HulyDefaultWorkspace,
    logger
  }
}

/** @public */
export async function deliverGitLabSyncEvents (
  options: HulyDeliveryOptions,
  envelope: GitLabWebhookEnvelope,
  syncEvents: GitLabSyncEvent[]
): Promise<void> {
  if (options.targets.length === 0) {
    options.logger?.info('gitlab.delivery.no-adapter', {
      event: envelope.event,
      syncEventCount: syncEvents.length
    })
    return
  }

  const fetchImpl = options.fetch ?? getGlobalDeliveryFetch()
  const payload = JSON.stringify(createDeliveryPayload(options, envelope, syncEvents))
  const failures: HulyDeliveryFailure[] = []

  for (const target of options.targets) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'huly-gitlab-pod'
    }

    if (target.token !== undefined && target.token !== '') {
      headers.Authorization = `Bearer ${target.token}`
    }

    try {
      const response = await fetchImpl(target.url, {
        method: 'POST',
        headers,
        body: payload
      })
      const responseBody = await safeReadText(response)

      if (!response.ok) {
        const failure: HulyDeliveryFailure = {
          adapter: target.adapter,
          url: redactUrl(target.url),
          status: response.status,
          statusText: response.statusText,
          responseBody: truncate(responseBody, 2048)
        }
        failures.push(failure)
        options.logger?.error('gitlab.delivery.failed', { ...failure })
        continue
      }

      options.logger?.info('gitlab.delivery.sent', {
        adapter: target.adapter,
        status: response.status,
        syncEventCount: syncEvents.length
      })
    } catch (err) {
      const failure: HulyDeliveryFailure = {
        adapter: target.adapter,
        url: redactUrl(target.url),
        error: err instanceof Error ? err.message : String(err)
      }
      failures.push(failure)
      options.logger?.error('gitlab.delivery.failed', { ...failure })
    }
  }

  if (failures.length > 0) {
    throw new GitLabDeliveryError(failures)
  }
}

/** @public */
export function createDeliveryPayload (
  options: Pick<HulyDeliveryOptions, 'workspace'>,
  envelope: GitLabWebhookEnvelope,
  syncEvents: GitLabSyncEvent[]
): HulyGitLabDeliveryPayload {
  return {
    source: 'gitlab',
    workspace: options.workspace,
    receivedAt: new Date().toISOString(),
    event: {
      name: envelope.event,
      eventUuid: envelope.eventUuid,
      webhookUuid: envelope.webhookUuid,
      instance: envelope.instance
    },
    records: syncEvents,
    syncEvents
  }
}

function joinUrl (baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

async function safeReadText (response: HulyDeliveryResponseLike): Promise<string> {
  try {
    return await response.text()
  } catch (err) {
    return `Unable to read response body: ${err instanceof Error ? err.message : String(err)}`
  }
}

function truncate (value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

function redactUrl (value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.split('?')[0]
  }
}

function getGlobalDeliveryFetch (): HulyDeliveryFetch {
  const fetchImpl = (globalThis as unknown as { fetch?: HulyDeliveryFetch }).fetch
  if (fetchImpl === undefined) {
    throw new Error('No fetch implementation is available for Huly GitLab delivery')
  }
  return fetchImpl
}
