//
// Copyright © 2026 Hardcore Engineering Inc.
//

/** @public */
export type GitLabKnownWebhookEvent =
  | 'Push Hook'
  | 'Tag Push Hook'
  | 'Issue Hook'
  | 'Note Hook'
  | 'Merge Request Hook'
  | 'Project Hook'
  | 'Label Hook'
  | 'User Hook'
  | 'Pipeline Hook'
  | 'Job Hook'
  | 'Wiki Page Hook'
  | 'Deployment Hook'
  | 'Release Hook'
  | string

/** @public */
export type GitLabHeaderValue = string | string[] | undefined

/** @public */
export type GitLabHeadersInput =
  | Record<string, GitLabHeaderValue>
  | Array<[string, string]>
  | { get: (name: string) => string | null | undefined }

/** @public */
export type GitLabRawWebhookBody = string | Uint8Array | GitLabWebhookPayload

/** @public */
export interface GitLabWebhookPayload {
  object_kind?: string
  event_name?: string
  user?: unknown
  project?: unknown
  repository?: unknown
  object_attributes?: Record<string, unknown>
  labels?: unknown[]
  changes?: Record<string, unknown>
  [key: string]: unknown
}

/** @public */
export interface GitLabWebhookEnvelope<TPayload extends GitLabWebhookPayload = GitLabWebhookPayload> {
  event: GitLabKnownWebhookEvent
  eventUuid?: string
  webhookUuid?: string
  instance?: string
  tokenValid: boolean
  payload: TPayload
}

/** @public */
export interface ParseGitLabWebhookOptions {
  headers: GitLabHeadersInput
  body: GitLabRawWebhookBody
  secretToken?: string
  requireToken?: boolean
}

/** @public */
export class GitLabWebhookVerificationError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'GitLabWebhookVerificationError'
  }
}

/** @public */
export class GitLabWebhookParseError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'GitLabWebhookParseError'
  }
}

/**
 * Parse and optionally verify a GitLab webhook request.
 *
 * GitLab project and group webhooks send their shared secret in X-Gitlab-Token.
 * When a secret is configured, or requireToken is true, missing/mismatched tokens
 * are rejected before payload normalization. Comparison avoids early exits across
 * the compared byte range so retries and invalid requests are handled safely.
 *
 * @public
 */
export function parseGitLabWebhook<TPayload extends GitLabWebhookPayload = GitLabWebhookPayload> (
  options: ParseGitLabWebhookOptions
): GitLabWebhookEnvelope<TPayload> {
  const receivedToken = getGitLabHeader(options.headers, 'x-gitlab-token')
  const shouldVerify = options.requireToken ?? options.secretToken !== undefined
  const tokenValid = verifyGitLabWebhookToken(receivedToken, options.secretToken)

  if (shouldVerify && !tokenValid) {
    throw new GitLabWebhookVerificationError('Invalid GitLab webhook token')
  }

  const payload = parsePayload(options.body) as TPayload
  const event = getGitLabHeader(options.headers, 'x-gitlab-event') ?? inferEventName(payload)

  if (event === undefined || event === '') {
    throw new GitLabWebhookParseError('Missing GitLab webhook event name')
  }

  return {
    event,
    eventUuid: getGitLabHeader(options.headers, 'x-gitlab-event-uuid'),
    webhookUuid: getGitLabHeader(options.headers, 'x-gitlab-webhook-uuid'),
    instance: getGitLabHeader(options.headers, 'x-gitlab-instance'),
    tokenValid,
    payload
  }
}

/** @public */
export function getGitLabHeader (headers: GitLabHeadersInput, name: string): string | undefined {
  const wanted = name.toLowerCase()
  const getter = (headers as { get?: unknown }).get

  if (typeof getter === 'function') {
    const value = getter.call(headers, name) ?? getter.call(headers, wanted)
    return normalizeHeaderValue(value)
  }

  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === wanted)
    return found?.[1]
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return normalizeHeaderValue(value)
    }
  }

  return undefined
}

/** @public */
export function verifyGitLabWebhookToken (received: string | undefined, expected: string | undefined): boolean {
  if (received == null || expected == null || expected === '') {
    return false
  }

  let diff = received.length ^ expected.length
  const maxLength = Math.max(received.length, expected.length)
  for (let i = 0; i < maxLength; i++) {
    diff |= charCodeAt(received, i) ^ charCodeAt(expected, i)
  }
  return diff === 0
}

/** @public */
export function isGitLabIssueWebhook (envelope: GitLabWebhookEnvelope): boolean {
  return envelope.event === 'Issue Hook' || envelope.payload.object_kind === 'issue'
}

/** @public */
export function isGitLabNoteWebhook (envelope: GitLabWebhookEnvelope): boolean {
  return envelope.event === 'Note Hook' || envelope.payload.object_kind === 'note'
}

/** @public */
export function isGitLabProjectWebhook (envelope: GitLabWebhookEnvelope): boolean {
  return envelope.event === 'Project Hook' || String(envelope.payload.object_kind ?? '').startsWith('project')
}

/** @public */
export function isGitLabLabelWebhook (envelope: GitLabWebhookEnvelope): boolean {
  return envelope.event === 'Label Hook' || envelope.payload.object_kind === 'label'
}

/** @public */
export function isGitLabUserWebhook (envelope: GitLabWebhookEnvelope): boolean {
  return envelope.event === 'User Hook' || String(envelope.payload.object_kind ?? '').startsWith('user')
}

function normalizeHeaderValue (value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return typeof value === 'string' ? value : undefined
}

function parsePayload (body: GitLabRawWebhookBody): GitLabWebhookPayload {
  if (typeof body === 'string') {
    return parseJsonObject(body)
  }

  if (body instanceof Uint8Array) {
    return parseJsonObject(new TextDecoder().decode(body))
  }

  if (body != null && typeof body === 'object') {
    return body
  }

  throw new GitLabWebhookParseError('Unsupported GitLab webhook body')
}

function parseJsonObject (text: string): GitLabWebhookPayload {
  try {
    const parsed = JSON.parse(text)
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as GitLabWebhookPayload
    }
  } catch (err) {
    throw new GitLabWebhookParseError(`Invalid GitLab webhook JSON: ${(err as Error).message}`)
  }

  throw new GitLabWebhookParseError('GitLab webhook JSON payload must be an object')
}

function inferEventName (payload: GitLabWebhookPayload): GitLabKnownWebhookEvent | undefined {
  if (typeof payload.event_name === 'string' && payload.event_name !== '') {
    return payload.event_name
  }

  switch (payload.object_kind) {
    case 'push':
      return 'Push Hook'
    case 'tag_push':
      return 'Tag Push Hook'
    case 'issue':
      return 'Issue Hook'
    case 'note':
      return 'Note Hook'
    case 'merge_request':
      return 'Merge Request Hook'
    case 'project':
    case 'project_create':
    case 'project_destroy':
    case 'project_rename':
    case 'project_transfer':
    case 'project_update':
      return 'Project Hook'
    case 'label':
      return 'Label Hook'
    case 'user':
    case 'user_create':
    case 'user_destroy':
    case 'user_rename':
      return 'User Hook'
    case 'pipeline':
      return 'Pipeline Hook'
    case 'build':
      return 'Job Hook'
    case 'wiki_page':
      return 'Wiki Page Hook'
    case 'deployment':
      return 'Deployment Hook'
    case 'release':
      return 'Release Hook'
    default:
      return undefined
  }
}

function charCodeAt (value: string, index: number): number {
  return index < value.length ? value.charCodeAt(index) : 0
}
