//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'http'

import type { GitLabIssue, GitLabNote } from '@hcengineering/gitlab'

import { GitLabRestClient } from './client'
import { createGitLabDelivery, deliverGitLabSyncEvents, GitLabDeliveryError, type HulyDeliveryOptions } from './delivery'
import { loadGitLabPodConfig, type GitLabPodConfig } from './config'
import { normalizeGitLabWebhookToSyncEvents, type GitLabSyncEvent } from './syncEvents'
import {
  GitLabWebhookParseError,
  GitLabWebhookVerificationError,
  isGitLabIssueWebhook,
  isGitLabNoteWebhook,
  parseGitLabWebhook,
  type GitLabRawWebhookBody,
  type GitLabWebhookEnvelope
} from './webhook'

/** @public */
export interface GitLabWebhookRequest {
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>
  body: GitLabRawWebhookBody
}

/** @public */
export interface GitLabWebhookDispatchContext<TPayload = unknown> {
  envelope: GitLabWebhookEnvelope
  client: GitLabRestClient
  payload: TPayload
  action?: string
  syncEvents: GitLabSyncEvent[]
}

/** @public */
export interface GitLabWebhookCallbacks {
  onIssue?: (context: GitLabWebhookDispatchContext<GitLabIssue>) => Promise<void> | void
  onNote?: (context: GitLabWebhookDispatchContext<GitLabNote>) => Promise<void> | void
  onEvents?: (context: GitLabWebhookDispatchContext) => Promise<void> | void
}

/** @public */
export interface GitLabWebhookHandleOptions extends GitLabWebhookCallbacks {
  client: GitLabRestClient
  delivery?: HulyDeliveryOptions
  secretToken?: string
  requireToken?: boolean
  logger?: StructuredLogger
}

/** @public */
export interface GitLabWebhookHandleResult {
  envelope: GitLabWebhookEnvelope
  syncEvents: GitLabSyncEvent[]
}

/** @public */
export interface GitLabPodRuntime {
  config: GitLabPodConfig
  client: GitLabRestClient
  delivery: HulyDeliveryOptions
  logger: StructuredLogger
  handleWebhook: (request: GitLabWebhookRequest, callbacks?: GitLabWebhookCallbacks) => Promise<GitLabWebhookHandleResult>
}

/** @public */
export interface GitLabHttpService {
  server: Server
  runtime: GitLabPodRuntime
  close: () => Promise<void>
}

/** @public */
export interface StructuredLogger {
  info: (message: string, fields?: Record<string, unknown>) => void
  warn: (message: string, fields?: Record<string, unknown>) => void
  error: (message: string, fields?: Record<string, unknown>) => void
}

/** @public */
export function createGitLabPodRuntime (config: GitLabPodConfig = loadGitLabPodConfig()): GitLabPodRuntime {
  const logger = createJsonLogger(config.ServiceID)
  const client = new GitLabRestClient({
    baseUrl: config.GitLabBaseURL,
    token: config.GitLabToken,
    tokenType: config.GitLabTokenType,
    userAgent: config.ServiceID
  })
  const delivery = createGitLabDelivery(config, logger)

  return {
    config,
    client,
    delivery,
    logger,
    handleWebhook: async (request, callbacks = {}) =>
      await handleGitLabWebhook(request, {
        ...callbacks,
        client,
        secretToken: config.GitLabWebhookSecret,
        requireToken: config.GitLabWebhookSecretRequired,
        delivery,
        logger
      })
  }
}

/** @public */
export async function handleGitLabWebhook (
  request: GitLabWebhookRequest,
  options: GitLabWebhookHandleOptions
): Promise<GitLabWebhookHandleResult> {
  const envelope = parseGitLabWebhook({
    headers: request.headers,
    body: request.body,
    secretToken: options.secretToken,
    requireToken: options.requireToken
  })
  const action = readWebhookAction(envelope)
  const syncEvents = normalizeGitLabWebhookToSyncEvents(envelope)

  options.logger?.info('gitlab.webhook.accepted', {
    event: envelope.event,
    eventUuid: envelope.eventUuid,
    action,
    syncEventCount: syncEvents.length,
    idempotencyKeys: syncEvents.map((event) => event.idempotencyKey)
  })

  if (options.delivery !== undefined) {
    await deliverGitLabSyncEvents(options.delivery, envelope, syncEvents)
  }

  const baseContext = {
    envelope,
    client: options.client,
    action,
    syncEvents
  }

  if (isGitLabIssueWebhook(envelope)) {
    await options.onIssue?.({
      ...baseContext,
      payload: envelope.payload.object_attributes as unknown as GitLabIssue
    })
  }

  if (isGitLabNoteWebhook(envelope)) {
    await options.onNote?.({
      ...baseContext,
      payload: envelope.payload.object_attributes as unknown as GitLabNote
    })
  }

  await options.onEvents?.({
    ...baseContext,
    payload: envelope.payload
  })

  return { envelope, syncEvents }
}

/** @public */
export async function startGitLabHttpService (
  config: GitLabPodConfig = loadGitLabPodConfig(),
  callbacks: GitLabWebhookCallbacks = {}
): Promise<GitLabHttpService> {
  const runtime = createGitLabPodRuntime(config)
  const server = createServer((request, response) => {
    void routeRequest(runtime, callbacks, request, response).catch((err) => {
      runtime.logger.error('gitlab.http.unhandled-error', errorFields(err))
      sendJson(response, 500, { ok: false, error: 'Internal server error' })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.Port, () => {
      server.off('error', reject)
      runtime.logger.info('gitlab.http.started', { port: config.Port })
      resolve()
    })
  })

  return {
    server,
    runtime,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err != null ? reject(err) : resolve()))
      })
    }
  }
}

async function routeRequest (
  runtime: GitLabPodRuntime,
  callbacks: GitLabWebhookCallbacks,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', 'http://localhost')

  if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz' || url.pathname === '/livez')) {
    sendJson(response, 200, {
      ok: true,
      service: runtime.config.ServiceID,
      timestamp: new Date().toISOString()
    })
    return
  }

  if (method === 'GET' && (url.pathname === '/ready' || url.pathname === '/readyz' || url.pathname === '/readiness')) {
    await handleReadiness(runtime, response)
    return
  }

  if (method === 'POST' && (url.pathname === '/api/webhook' || url.pathname === '/api/v1/webhook/gitlab')) {
    await handleWebhookHttp(runtime, callbacks, request, response)
    return
  }

  if (url.pathname.startsWith('/api/v1/')) {
    await handleRestHelper(runtime, method, url, request.headers, response)
    return
  }

  sendJson(response, 404, { ok: false, error: 'Not found' })
}

async function handleWebhookHttp (
  runtime: GitLabPodRuntime,
  callbacks: GitLabWebhookCallbacks,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(request, runtime.config.MaxWebhookBodyBytes)
    const result = await runtime.handleWebhook(
      {
        headers: request.headers,
        body
      },
      callbacks
    )

    if (runtime.config.LogPayloads) {
      runtime.logger.info('gitlab.webhook.payload', { payload: result.envelope.payload })
    }

    sendJson(response, 202, {
      ok: true,
      event: result.envelope.event,
      eventUuid: result.envelope.eventUuid,
      syncEventCount: result.syncEvents.length,
      syncEvents: result.syncEvents.map((event) => ({
        type: event.type,
        operation: event.operation,
        entityExternalId: event.entityExternalId,
        idempotencyKey: event.idempotencyKey
      }))
    })
  } catch (err) {
    if (err instanceof GitLabWebhookVerificationError) {
      runtime.logger.warn('gitlab.webhook.rejected', errorFields(err))
      sendJson(response, 401, { ok: false, error: err.message })
      return
    }

    if (err instanceof GitLabWebhookParseError) {
      runtime.logger.warn('gitlab.webhook.bad-payload', errorFields(err))
      sendJson(response, 400, { ok: false, error: err.message })
      return
    }

    if (err instanceof GitLabDeliveryError) {
      runtime.logger.error('gitlab.webhook.delivery-failed', errorFields(err))
      sendJson(response, 502, { ok: false, error: 'Huly delivery failed', detail: errorFields(err) })
      return
    }

    runtime.logger.error('gitlab.webhook.failed', errorFields(err))
    sendJson(response, 500, { ok: false, error: 'Webhook processing failed' })
  }
}

async function handleReadiness (runtime: GitLabPodRuntime, response: ServerResponse): Promise<void> {
  const checks: Record<string, unknown> = {
    webhookSecretConfigured: runtime.config.GitLabWebhookSecret !== undefined,
    webhookSecretRequired: runtime.config.GitLabWebhookSecretRequired,
    gitlabBaseUrl: runtime.config.GitLabBaseURL,
    readinessProject: runtime.config.GitLabReadinessProject
  }

  let ok = !runtime.config.GitLabWebhookSecretRequired || runtime.config.GitLabWebhookSecret !== undefined
  let status = 200

  if (runtime.config.GitLabReadinessProject !== undefined) {
    try {
      const project = await runtime.client.getProject(runtime.config.GitLabReadinessProject)
      checks.gitlabProject = { id: project.id, pathWithNamespace: project.path_with_namespace }
    } catch (err) {
      ok = false
      status = 503
      checks.gitlabProjectError = errorFields(err)
    }
  }

  sendJson(response, status, {
    ok,
    service: runtime.config.ServiceID,
    checks
  })
}

async function handleRestHelper (
  runtime: GitLabPodRuntime,
  method: string,
  url: URL,
  headers: IncomingHttpHeaders,
  response: ServerResponse
): Promise<void> {
  if (!isAuthorized(runtime.config, headers)) {
    sendJson(response, 401, { ok: false, error: 'Unauthorized' })
    return
  }

  if (method !== 'GET') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  const segments = url.pathname.split('/').filter(Boolean)

  try {
    if (segments.length === 3 && segments[2] === 'projects') {
      const projects = await runtime.client.listProjects({
        search: url.searchParams.get('search') ?? undefined,
        membership: parseOptionalBool(url.searchParams.get('membership')),
        owned: parseOptionalBool(url.searchParams.get('owned')),
        simple: parseOptionalBool(url.searchParams.get('simple')) ?? true
      })
      sendJson(response, 200, { ok: true, projects })
      return
    }

    if (segments.length === 3 && segments[2] === 'users') {
      const users = await runtime.client.listUsers({
        search: url.searchParams.get('search') ?? undefined,
        username: url.searchParams.get('username') ?? undefined,
        active: parseOptionalBool(url.searchParams.get('active'))
      })
      sendJson(response, 200, { ok: true, users })
      return
    }

    if (segments.length === 5 && segments[2] === 'projects' && segments[4] === 'issues') {
      const issues = await runtime.client.listProjectIssues(decodeURIComponent(segments[3]), {
        state: parseIssueState(url.searchParams.get('state')),
        labels: url.searchParams.get('labels') ?? undefined,
        search: url.searchParams.get('search') ?? undefined
      })
      sendJson(response, 200, { ok: true, issues })
      return
    }

    if (segments.length === 5 && segments[2] === 'projects' && segments[4] === 'labels') {
      const labels = await runtime.client.listLabels(decodeURIComponent(segments[3]))
      sendJson(response, 200, { ok: true, labels })
      return
    }
  } catch (err) {
    runtime.logger.error('gitlab.rest-helper.failed', errorFields(err))
    sendJson(response, 502, { ok: false, error: 'GitLab API request failed', detail: errorFields(err) })
    return
  }

  sendJson(response, 404, { ok: false, error: 'Not found' })
}

function isAuthorized (config: GitLabPodConfig, headers: IncomingHttpHeaders): boolean {
  if (config.ServerSecret === undefined) {
    return true
  }

  const authorization = normalizeHeader(headers.authorization)
  const secretHeader = normalizeHeader(headers['x-huly-secret'])
  return authorization === `Bearer ${config.ServerSecret}` || secretHeader === config.ServerSecret
}

function normalizeHeader (value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseOptionalBool (value: string | null): boolean | undefined {
  if (value == null || value === '') {
    return undefined
  }
  return value === '1' || value.toLowerCase() === 'true'
}

function parseIssueState (value: string | null): 'opened' | 'closed' | 'all' | undefined {
  return value === 'opened' || value === 'closed' || value === 'all' ? value : undefined
}

function readWebhookAction (envelope: GitLabWebhookEnvelope): string | undefined {
  const action = envelope.payload.object_attributes?.action ?? envelope.payload.event_name
  return typeof action === 'string' ? action : undefined
}

async function readRequestBody (request: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0

  for await (const chunk of request) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    total += bytes.byteLength
    if (total > maxBytes) {
      throw new GitLabWebhookParseError(`GitLab webhook body exceeds ${maxBytes} bytes`)
    }
    chunks.push(bytes)
  }

  return Buffer.concat(chunks)
}

function sendJson (response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    return
  }

  const text = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(text))
  response.end(text)
}

function createJsonLogger (service: string): StructuredLogger {
  const write = (level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void => {
    const entry = {
      ts: new Date().toISOString(),
      level,
      service,
      message,
      ...fields
    }
    const line = JSON.stringify(entry)
    if (level === 'error') {
      console.error(line)
    } else {
      console.log(line)
    }
  }

  return {
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields)
  }
}

function errorFields (err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const result: Record<string, unknown> = {
      name: err.name,
      message: err.message
    }
    const extra = err as Error & { status?: number, statusText?: string, issues?: string[], failures?: unknown[] }
    if (extra.status !== undefined) {
      result.status = extra.status
    }
    if (extra.statusText !== undefined) {
      result.statusText = extra.statusText
    }
    if (extra.issues !== undefined) {
      result.issues = extra.issues
    }
    if (extra.failures !== undefined) {
      result.failures = extra.failures
    }
    return result
  }
  return { message: String(err) }
}
