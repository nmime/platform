//
// Copyright © 2026 Hardcore Engineering Inc.
//

import {
  type GitLabIssue,
  type GitLabLabel,
  type GitLabNote,
  type GitLabProject,
  type GitLabUser,
  mapGitLabComment,
  mapGitLabIssue,
  mapGitLabIssueStatus,
  mapGitLabLabel,
  mapGitLabProject,
  mapGitLabUser,
  type HulyGitLabCommentDraft,
  type HulyGitLabIssueDraft,
  type HulyGitLabLabelDraft,
  type HulyGitLabProjectRef,
  type HulyGitLabStatusDraft,
  type HulyGitLabUserRef
} from '@hcengineering/gitlab'

import {
  type GitLabWebhookEnvelope,
  isGitLabIssueWebhook,
  isGitLabLabelWebhook,
  isGitLabNoteWebhook,
  isGitLabProjectWebhook,
  isGitLabUserWebhook
} from './webhook'

/** @public */
export type GitLabSyncEventType = 'project' | 'issue' | 'comment' | 'label' | 'user' | 'status'

/** @public */
export type GitLabSyncOperation = 'upsert' | 'delete' | 'close' | 'reopen'

/** @public */
export interface GitLabSyncEventBase {
  type: GitLabSyncEventType
  operation: GitLabSyncOperation
  action?: string
  event: string
  projectId?: number
  source: 'gitlab-webhook'
  entityExternalId: string
  idempotencyKey: string
}

/** @public */
export interface GitLabProjectSyncEvent extends GitLabSyncEventBase {
  type: 'project'
  project: HulyGitLabProjectRef
}

/** @public */
export interface GitLabIssueSyncEvent extends GitLabSyncEventBase {
  type: 'issue'
  issueIid: number
  issue: HulyGitLabIssueDraft
}

/** @public */
export interface GitLabCommentSyncEvent extends GitLabSyncEventBase {
  type: 'comment'
  noteId: number
  issueIid?: number
  comment: HulyGitLabCommentDraft
}

/** @public */
export interface GitLabLabelSyncEvent extends GitLabSyncEventBase {
  type: 'label'
  label: HulyGitLabLabelDraft
}

/** @public */
export interface GitLabUserSyncEvent extends GitLabSyncEventBase {
  type: 'user'
  user: HulyGitLabUserRef
}

/** @public */
export interface GitLabStatusSyncEvent extends GitLabSyncEventBase {
  type: 'status'
  status: HulyGitLabStatusDraft
}

/** @public */
export type GitLabSyncEvent =
  | GitLabProjectSyncEvent
  | GitLabIssueSyncEvent
  | GitLabCommentSyncEvent
  | GitLabLabelSyncEvent
  | GitLabUserSyncEvent
  | GitLabStatusSyncEvent

/**
 * Convert a verified GitLab webhook envelope into deterministic sync intents.
 *
 * The result is Huly-model agnostic but complete enough for a ready-to-run external pod:
 * project, issue, note/comment, label, user, and issue-status concepts are normalized with
 * stable entity IDs and safe idempotency keys for retry protection.
 *
 * @public
 */
export function normalizeGitLabWebhookToSyncEvents (envelope: GitLabWebhookEnvelope): GitLabSyncEvent[] {
  if (isGitLabIssueWebhook(envelope)) {
    return deduplicateSyncEvents(normalizeIssueWebhook(envelope))
  }

  if (isGitLabNoteWebhook(envelope)) {
    return deduplicateSyncEvents(normalizeNoteWebhook(envelope))
  }

  if (isGitLabLabelWebhook(envelope)) {
    return deduplicateSyncEvents(normalizeLabelWebhook(envelope))
  }

  if (isGitLabProjectWebhook(envelope)) {
    return deduplicateSyncEvents(normalizeProjectWebhook(envelope))
  }

  if (isGitLabUserWebhook(envelope)) {
    return deduplicateSyncEvents(normalizeUserWebhook(envelope))
  }

  return []
}

function normalizeIssueWebhook (envelope: GitLabWebhookEnvelope): GitLabSyncEvent[] {
  const issue = toGitLabIssue(envelope.payload.object_attributes, envelope)
  if (issue === undefined) {
    return []
  }

  const action = readAction(envelope)
  const operation = issueOperation(action, issue.state)
  const issueDraft = mapGitLabIssue(issue)
  const projectId = issue.project_id ?? readProjectId(envelope)
  const events: GitLabSyncEvent[] = []
  const project = readProject(envelope)

  if (project !== undefined) {
    events.push(projectToSyncEvent(envelope, project, 'upsert', action))
  }

  events.push({
    type: 'issue',
    operation,
    action,
    event: envelope.event,
    projectId,
    issueIid: issue.iid,
    issue: issueDraft,
    entityExternalId: issueDraft.externalId,
    idempotencyKey: makeIdempotencyKey(envelope, 'issue', operation, issueDraft.externalId, issue.updated_at),
    source: 'gitlab-webhook'
  })

  events.push(statusToSyncEvent(envelope, mapGitLabIssueStatus(issue), projectId, action))
  events.push(...labelsToSyncEvents(envelope, issue.labels, projectId, 'upsert', action))
  events.push(...changedLabelsToSyncEvents(envelope, projectId, action))
  events.push(...usersToSyncEvents(envelope, readUsersFromIssue(issue), projectId, action))
  events.push(...usersToSyncEvents(envelope, readPayloadUsers(envelope), projectId, action))

  return events
}

function normalizeNoteWebhook (envelope: GitLabWebhookEnvelope): GitLabSyncEvent[] {
  const note = toGitLabNote(envelope.payload.object_attributes, envelope)
  if (note === undefined || (note.noteable_type !== undefined && note.noteable_type !== 'Issue')) {
    return []
  }

  const action = readAction(envelope)
  const operation = deleteAction(action) ? 'delete' : 'upsert'
  const projectId = readProjectId(envelope)
  const comment = mapGitLabComment(note, projectId)
  const events: GitLabSyncEvent[] = [
    {
      type: 'comment',
      operation,
      action,
      event: envelope.event,
      projectId,
      noteId: note.id,
      issueIid: note.noteable_iid,
      comment,
      entityExternalId: comment.externalId,
      idempotencyKey: makeIdempotencyKey(envelope, 'comment', operation, comment.externalId, note.updated_at),
      source: 'gitlab-webhook'
    }
  ]

  events.push(...usersToSyncEvents(envelope, [note.author, ...readPayloadUsers(envelope)], projectId, action))
  return events
}

function normalizeLabelWebhook (envelope: GitLabWebhookEnvelope): GitLabSyncEvent[] {
  const action = readAction(envelope)
  const label = toGitLabLabel(envelope.payload.object_attributes)
  if (label === undefined) {
    return []
  }

  return labelsToSyncEvents(envelope, [label], readProjectId(envelope), deleteAction(action) ? 'delete' : 'upsert', action)
}

function normalizeProjectWebhook (envelope: GitLabWebhookEnvelope): GitLabSyncEvent[] {
  const action = readAction(envelope)
  const project = readProject(envelope)
  if (project === undefined) {
    return []
  }
  return [projectToSyncEvent(envelope, project, deleteAction(action) ? 'delete' : 'upsert', action)]
}

function normalizeUserWebhook (envelope: GitLabWebhookEnvelope): GitLabSyncEvent[] {
  const action = readAction(envelope)
  return usersToSyncEvents(envelope, readPayloadUsers(envelope), readProjectId(envelope), action, deleteAction(action) ? 'delete' : 'upsert')
}

function projectToSyncEvent (
  envelope: GitLabWebhookEnvelope,
  project: GitLabProject,
  operation: GitLabSyncOperation,
  action: string | undefined
): GitLabProjectSyncEvent {
  const projectDraft = mapGitLabProject(project)
  return {
    type: 'project',
    operation,
    action,
    event: envelope.event,
    projectId: project.id,
    project: projectDraft,
    entityExternalId: projectDraft.externalId,
    idempotencyKey: makeIdempotencyKey(envelope, 'project', operation, projectDraft.externalId, project.updated_at),
    source: 'gitlab-webhook'
  }
}

function statusToSyncEvent (
  envelope: GitLabWebhookEnvelope,
  status: HulyGitLabStatusDraft,
  projectId: number | undefined,
  action: string | undefined
): GitLabStatusSyncEvent {
  return {
    type: 'status',
    operation: 'upsert',
    action,
    event: envelope.event,
    projectId,
    status,
    entityExternalId: status.externalId,
    idempotencyKey: makeIdempotencyKey(envelope, 'status', 'upsert', status.externalId, status.closedAt),
    source: 'gitlab-webhook'
  }
}

function labelsToSyncEvents (
  envelope: GitLabWebhookEnvelope,
  labels: Array<string | GitLabLabel> | undefined,
  projectId: number | undefined,
  operation: GitLabSyncOperation,
  action: string | undefined
): GitLabLabelSyncEvent[] {
  return (labels ?? [])
    .map(toGitLabLabel)
    .filter(isDefined)
    .map((label) => {
      const labelDraft = mapGitLabLabel(label, projectId)
      return {
        type: 'label' as const,
        operation,
        action,
        event: envelope.event,
        projectId,
        label: labelDraft,
        entityExternalId: labelDraft.externalId,
        idempotencyKey: makeIdempotencyKey(envelope, 'label', operation, labelDraft.externalId, label.name),
        source: 'gitlab-webhook' as const
      }
    })
}

function usersToSyncEvents (
  envelope: GitLabWebhookEnvelope,
  users: Array<GitLabUser | undefined>,
  projectId: number | undefined,
  action: string | undefined,
  operation: GitLabSyncOperation = 'upsert'
): GitLabUserSyncEvent[] {
  return users
    .map(mapGitLabUser)
    .filter(isDefined)
    .map((user) => ({
      type: 'user' as const,
      operation,
      action,
      event: envelope.event,
      projectId,
      user,
      entityExternalId: user.externalId,
      idempotencyKey: makeIdempotencyKey(envelope, 'user', operation, user.externalId, user.username),
      source: 'gitlab-webhook' as const
    }))
}

function changedLabelsToSyncEvents (
  envelope: GitLabWebhookEnvelope,
  projectId: number | undefined,
  action: string | undefined
): GitLabLabelSyncEvent[] {
  const labelsChange = readLabelsChange(envelope)
  if (labelsChange === undefined) {
    return []
  }

  const previous = new Set(labelsChange.previous.map(toLabelIdentity))
  const current = new Set(labelsChange.current.map(toLabelIdentity))
  const removed = labelsChange.previous.filter((label) => !current.has(toLabelIdentity(label)))
  const addedOrUpdated = labelsChange.current.filter((label) => !previous.has(toLabelIdentity(label)))

  return [
    ...labelsToSyncEvents(envelope, addedOrUpdated, projectId, 'upsert', action),
    ...labelsToSyncEvents(envelope, removed, projectId, 'delete', action)
  ]
}

function readLabelsChange (
  envelope: GitLabWebhookEnvelope
): { previous: Array<string | GitLabLabel>, current: Array<string | GitLabLabel> } | undefined {
  const labels = envelope.payload.changes?.labels
  if (!isRecord(labels)) {
    return undefined
  }

  const previous = readLabelArray(labels.previous)
  const current = readLabelArray(labels.current)
  if (previous.length === 0 && current.length === 0) {
    return undefined
  }
  return { previous, current }
}

function readLabelArray (value: unknown): Array<string | GitLabLabel> {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(toGitLabLabel).filter(isDefined)
}

function toGitLabIssue (value: unknown, envelope: GitLabWebhookEnvelope): GitLabIssue | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const iid = readNumber(value.iid) ?? readNumber(value.issue_iid)
  const projectId = readNumber(value.project_id) ?? readProjectId(envelope)
  const id = readNumber(value.id) ?? iid
  const title = readString(value.title)

  if (id === undefined || iid === undefined || projectId === undefined || title === undefined) {
    return undefined
  }

  return {
    id,
    iid,
    project_id: projectId,
    title,
    description: readNullableString(value.description),
    state: (readString(value.state) ?? 'opened') as GitLabIssue['state'],
    confidential: readBoolean(value.confidential),
    discussion_locked: readBoolean(value.discussion_locked) ?? null,
    labels: readIssueLabels(value, envelope),
    author: toGitLabUser(value.author) ?? toGitLabUser(envelope.payload.user),
    assignees: readUserArray(value.assignees),
    assignee: toGitLabUser(value.assignee) ?? null,
    milestone: toGitLabMilestone(value.milestone),
    upvotes: readNumber(value.upvotes),
    downvotes: readNumber(value.downvotes),
    merge_requests_count: readNumber(value.merge_requests_count),
    user_notes_count: readNumber(value.user_notes_count),
    due_date: readNullableString(value.due_date),
    web_url: readString(value.web_url) ?? readString(value.url) ?? '',
    created_at: readString(value.created_at),
    updated_at: readString(value.updated_at),
    closed_at: readNullableString(value.closed_at),
    closed_by: toGitLabUser(value.closed_by) ?? null
  }
}

function toGitLabNote (value: unknown, envelope: GitLabWebhookEnvelope): GitLabNote | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const id = readNumber(value.id)
  const body = readString(value.body) ?? readString(value.note)
  if (id === undefined || body === undefined) {
    return undefined
  }

  return {
    id,
    body,
    attachment: readNullableString(value.attachment),
    author: toGitLabUser(value.author) ?? toGitLabUser(envelope.payload.user),
    created_at: readString(value.created_at),
    updated_at: readString(value.updated_at),
    system: readBoolean(value.system),
    noteable_id: readNumber(value.noteable_id),
    noteable_iid: readNumber(value.noteable_iid) ?? readNumber(value.issue_iid),
    noteable_type: readString(value.noteable_type),
    resolvable: readBoolean(value.resolvable),
    resolved: readBoolean(value.resolved),
    internal: readBoolean(value.internal),
    confidential: readBoolean(value.confidential)
  }
}

function readIssueLabels (value: Record<string, unknown>, envelope: GitLabWebhookEnvelope): Array<string | GitLabLabel> {
  const labels = readLabelArray(value.labels)
  return labels.length > 0 ? labels : readLabelArray(envelope.payload.labels)
}

function readUserArray (value: unknown): GitLabUser[] {
  return Array.isArray(value) ? value.map(toGitLabUser).filter(isDefined) : []
}

function toGitLabMilestone (value: unknown): GitLabIssue['milestone'] {
  if (!isRecord(value)) {
    return null
  }

  const id = readNumber(value.id)
  const title = readString(value.title)
  if (id === undefined || title === undefined) {
    return null
  }

  return {
    id,
    iid: readNumber(value.iid),
    title,
    description: readNullableString(value.description),
    state: readString(value.state),
    due_date: readNullableString(value.due_date),
    start_date: readNullableString(value.start_date),
    web_url: readString(value.web_url)
  }
}

function toGitLabLabel (value: string | GitLabLabel | unknown): GitLabLabel | undefined {
  if (typeof value === 'string') {
    return { name: value, color: '' }
  }

  if (!isRecord(value)) {
    return undefined
  }

  const name = readString(value.name) ?? readString(value.title)
  if (name === undefined || name === '') {
    return undefined
  }

  return {
    id: readNumber(value.id),
    name,
    color: readString(value.color) ?? '',
    text_color: readString(value.text_color),
    description: readString(value.description),
    priority: readNumber(value.priority)
  }
}

function readProject (envelope: GitLabWebhookEnvelope): GitLabProject | undefined {
  return toGitLabProject(envelope.payload.project) ?? toGitLabProject(envelope.payload.object_attributes)
}

function toGitLabProject (value: unknown): GitLabProject | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const id = readNumber(value.id) ?? readNumber(value.project_id)
  const name = readString(value.name) ?? readString(value.project_name)
  const pathWithNamespace =
    readString(value.path_with_namespace) ?? readString(value.full_path) ?? readString(value.path) ?? name
  if (id === undefined || name === undefined || pathWithNamespace === undefined) {
    return undefined
  }

  return {
    id,
    name,
    path: readString(value.path),
    path_with_namespace: pathWithNamespace,
    description: readNullableString(value.description),
    web_url: readString(value.web_url) ?? readString(value.http_url) ?? '',
    avatar_url: readNullableString(value.avatar_url),
    default_branch: readNullableString(value.default_branch),
    visibility: readVisibility(value.visibility, value.visibility_level),
    archived: readBoolean(value.archived) ?? false,
    created_at: readString(value.created_at),
    updated_at: readString(value.updated_at) ?? readString(value.last_activity_at),
    last_activity_at: readString(value.last_activity_at)
  }
}

function readPayloadUsers (envelope: GitLabWebhookEnvelope): Array<GitLabUser | undefined> {
  return [toGitLabUser(envelope.payload.user), toGitLabUser(envelope.payload.object_attributes)]
}

function readUsersFromIssue (issue: GitLabIssue): Array<GitLabUser | undefined> {
  return [issue.author, issue.closed_by ?? undefined, ...(issue.assignees ?? []), issue.assignee ?? undefined]
}

function toGitLabUser (value: unknown): GitLabUser | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const id = readNumber(value.id) ?? readNumber(value.user_id)
  const username = readString(value.username) ?? readString(value.user_username)
  const name = readString(value.name) ?? readString(value.user_name) ?? username
  if (id === undefined || username === undefined || name === undefined) {
    return undefined
  }

  return {
    id,
    username,
    name,
    state: readString(value.state),
    avatar_url: readNullableString(value.avatar_url) ?? readNullableString(value.user_avatar),
    web_url: readString(value.web_url) ?? readString(value.user_web_url),
    email: readNullableString(value.email),
    public_email: readNullableString(value.public_email)
  }
}

function issueOperation (action: string | undefined, state: string | undefined): GitLabSyncOperation {
  if (deleteAction(action)) {
    return 'delete'
  }
  if (action === 'close' || action === 'closed' || state === 'closed') {
    return 'close'
  }
  if (action === 'reopen' || action === 'reopened') {
    return 'reopen'
  }
  return 'upsert'
}

function deleteAction (action: string | undefined): boolean {
  return action === 'delete' || action === 'destroy' || action === 'deleted' || action === 'remove'
}

function readAction (envelope: GitLabWebhookEnvelope): string | undefined {
  const action = envelope.payload.object_attributes?.action ?? envelope.payload.event_name
  return typeof action === 'string' ? action : undefined
}

function readProjectId (envelope: GitLabWebhookEnvelope): number | undefined {
  const objectProjectId = readNumber(envelope.payload.object_attributes?.project_id)
  if (objectProjectId !== undefined) {
    return objectProjectId
  }

  const project = envelope.payload.project
  if (isRecord(project)) {
    return readNumber(project.id)
  }

  return readNumber(envelope.payload.project_id)
}


function deduplicateSyncEvents (events: GitLabSyncEvent[]): GitLabSyncEvent[] {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = `${event.idempotencyKey}:${event.entityExternalId}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function makeIdempotencyKey (
  envelope: GitLabWebhookEnvelope,
  type: GitLabSyncEventType,
  operation: GitLabSyncOperation,
  entityExternalId: string,
  version: string | number | undefined
): string {
  const eventIdentity = envelope.eventUuid ?? envelope.webhookUuid ?? `${envelope.event}:${readAction(envelope) ?? ''}`
  return ['gitlab-webhook', eventIdentity, type, operation, entityExternalId, version]
    .filter((part): part is string | number => part !== undefined && part !== '')
    .map(safeKeyPart)
    .join(':')
}

function safeKeyPart (value: string | number): string {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function toLabelIdentity (label: string | GitLabLabel): string {
  return typeof label === 'string' ? label : label.name ?? label.title ?? ''
}

function readString (value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readNullableString (value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined
}

function readNumber (value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean (value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readVisibility (visibility: unknown, visibilityLevel: unknown): string {
  const value = readString(visibility)
  if (value !== undefined) {
    return value
  }

  switch (readNumber(visibilityLevel)) {
    case 0:
      return 'private'
    case 10:
      return 'internal'
    case 20:
      return 'public'
    default:
      return 'private'
  }
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isDefined<T> (value: T | undefined): value is T {
  return value !== undefined
}
