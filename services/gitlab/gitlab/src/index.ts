//
// Copyright © 2026 Hardcore Engineering Inc.
//

/**
 * Shared GitLab integration concepts and deterministic mappers used by the GitLab pod.
 *
 * The package intentionally stays independent from server persistence so it can be used by
 * webhook ingestion, backfill jobs, and future native model writers without duplicating GitLab
 * shape handling.
 *
 * @public
 */
export const gitlabId = 'gitlab' as const

/** @public */
export const gitlabIntegrationKind = 'gitlab' as const

/** @public */
export const gitlabUserIntegrationKind = 'gitlab-user' as const

/** @public */
export type GitLabVisibility = 'private' | 'internal' | 'public' | string

/** @public */
export type GitLabIssueState = 'opened' | 'closed' | string

/** @public */
export type GitLabStatusCategory = 'Active' | 'Won' | 'Lost'

/** @public */
export interface GitLabUser {
  id: number
  username: string
  name: string
  state?: string
  avatar_url?: string | null
  web_url?: string
  email?: string | null
  public_email?: string | null
}

/** @public */
export interface GitLabNamespace {
  id?: number
  name?: string
  path?: string
  kind?: string
  full_path?: string
  web_url?: string
  avatar_url?: string | null
}

/** @public */
export interface GitLabProject {
  id: number
  name: string
  path?: string
  path_with_namespace: string
  description?: string | null
  web_url: string
  avatar_url?: string | null
  default_branch?: string | null
  visibility: GitLabVisibility
  archived: boolean
  namespace?: GitLabNamespace
  created_at?: string
  updated_at?: string
  last_activity_at?: string
  issues_enabled?: boolean
  open_issues_count?: number
}

/** @public */
export interface GitLabLabel {
  id?: number
  name?: string
  title?: string
  color?: string
  text_color?: string
  description?: string | null
  open_issues_count?: number
  closed_issues_count?: number
  subscribed?: boolean
  priority?: number | null
  is_project_label?: boolean
}

/** @public */
export interface GitLabMilestone {
  id: number
  iid?: number
  title: string
  description?: string | null
  state?: string
  due_date?: string | null
  start_date?: string | null
  web_url?: string
}

/** @public */
export interface GitLabIssueTimeStats {
  time_estimate?: number
  total_time_spent?: number
  human_time_estimate?: string | null
  human_total_time_spent?: string | null
}

/** @public */
export interface GitLabIssueReferences {
  short?: string
  relative?: string
  full?: string
}

/** @public */
export interface GitLabIssue {
  id: number
  iid: number
  project_id: number
  title: string
  description?: string | null
  state: GitLabIssueState
  confidential?: boolean
  discussion_locked?: boolean | null
  labels?: Array<string | GitLabLabel>
  author?: GitLabUser
  assignees?: GitLabUser[]
  assignee?: GitLabUser | null
  milestone?: GitLabMilestone | null
  upvotes?: number
  downvotes?: number
  merge_requests_count?: number
  user_notes_count?: number
  due_date?: string | null
  web_url: string
  references?: GitLabIssueReferences
  time_stats?: GitLabIssueTimeStats
  created_at?: string
  updated_at?: string
  closed_at?: string | null
  closed_by?: GitLabUser | null
}

/** @public */
export interface GitLabNote {
  id: number
  body: string
  attachment?: string | null
  author?: GitLabUser
  created_at?: string
  updated_at?: string
  system?: boolean
  noteable_id?: number
  noteable_iid?: number
  noteable_type?: 'Issue' | 'MergeRequest' | 'Snippet' | 'Epic' | string
  resolvable?: boolean
  resolved?: boolean
  internal?: boolean
  confidential?: boolean
}

/** @public */
export interface HulyGitLabUserRef {
  integrationKind: typeof gitlabUserIntegrationKind
  externalId: string
  gitlabUserId: number
  username: string
  name: string
  avatarUrl?: string
  url?: string
  email?: string
  state?: string
}

/** @public */
export interface HulyGitLabProjectRef {
  integrationKind: typeof gitlabIntegrationKind
  externalId: string
  projectId: number
  name: string
  pathWithNamespace: string
  url: string
  description?: string
  visibility: GitLabVisibility
  archived: boolean
  defaultBranch?: string
  namespace?: string
  createdAt?: number
  updatedAt?: number
}

/** @public */
export interface HulyGitLabLabelDraft {
  integrationKind: typeof gitlabIntegrationKind
  externalId: string
  projectId?: number
  name: string
  color: string
  textColor?: string
  description?: string
  priority?: number
}

/** @public */
export interface HulyGitLabStatusDraft {
  integrationKind: typeof gitlabIntegrationKind
  externalId: string
  externalState: GitLabIssueState
  name: string
  category: GitLabStatusCategory
  closedAt?: number
}

/** @public */
export interface HulyGitLabIssueDraft {
  integrationKind: typeof gitlabIntegrationKind
  externalId: string
  projectId: number
  issueId: number
  number: number
  title: string
  description: string
  url: string
  status: HulyGitLabStatusDraft
  labels: HulyGitLabLabelDraft[]
  author?: HulyGitLabUserRef
  assignees: HulyGitLabUserRef[]
  milestone?: string
  confidential: boolean
  createdAt?: number
  updatedAt?: number
  closedAt?: number
}

/** @public */
export interface HulyGitLabCommentDraft {
  integrationKind: typeof gitlabIntegrationKind
  externalId: string
  projectId?: number
  issueIid?: number
  noteId: number
  body: string
  author?: HulyGitLabUserRef
  createdAt?: number
  updatedAt?: number
  system: boolean
  internal: boolean
  noteableId?: number
  noteableIid?: number
  noteableType?: string
}

/** @public */
export function gitLabExternalId (...parts: Array<string | number | undefined | null>): string {
  return ['gitlab', ...parts.filter((part): part is string | number => part !== undefined && part !== null)].join(':')
}

/** @public */
export function mapGitLabUser (user: GitLabUser | null | undefined): HulyGitLabUserRef | undefined {
  if (user == null) {
    return undefined
  }

  return {
    integrationKind: gitlabUserIntegrationKind,
    externalId: gitLabExternalId('user', user.id),
    gitlabUserId: user.id,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatar_url ?? undefined,
    url: user.web_url,
    email: user.email ?? user.public_email ?? undefined,
    state: user.state
  }
}

/** @public */
export function mapGitLabProject (project: GitLabProject): HulyGitLabProjectRef {
  return {
    integrationKind: gitlabIntegrationKind,
    externalId: gitLabExternalId('project', project.id),
    projectId: project.id,
    name: project.name,
    pathWithNamespace: project.path_with_namespace,
    url: project.web_url,
    description: project.description ?? undefined,
    visibility: project.visibility,
    archived: project.archived,
    defaultBranch: project.default_branch ?? undefined,
    namespace: project.namespace?.full_path ?? project.namespace?.path,
    createdAt: parseGitLabTimestamp(project.created_at),
    updatedAt: parseGitLabTimestamp(project.updated_at ?? project.last_activity_at)
  }
}

/** @public */
export function mapGitLabLabel (label: string | GitLabLabel, projectId?: number): HulyGitLabLabelDraft {
  if (typeof label === 'string') {
    return {
      integrationKind: gitlabIntegrationKind,
      externalId: gitLabExternalId('label', projectId, label),
      projectId,
      name: label,
      color: ''
    }
  }

  const name = label.name ?? label.title ?? ''

  return {
    integrationKind: gitlabIntegrationKind,
    externalId: gitLabExternalId('label', projectId, label.id ?? name),
    projectId,
    name,
    color: label.color ?? '',
    textColor: label.text_color,
    description: label.description ?? undefined,
    priority: label.priority ?? undefined
  }
}

/** @public */
export function mapGitLabStatus (
  externalState: GitLabIssueState,
  closedAt?: string | null
): HulyGitLabStatusDraft {
  if (externalState === 'closed') {
    return {
      integrationKind: gitlabIntegrationKind,
      externalId: gitLabExternalId('status', externalState),
      externalState,
      name: 'Closed',
      category: 'Won',
      closedAt: parseGitLabTimestamp(closedAt)
    }
  }

  return {
    integrationKind: gitlabIntegrationKind,
    externalId: gitLabExternalId('status', externalState === '' ? 'opened' : externalState),
    externalState,
    name: externalState === 'opened' ? 'Open' : externalState,
    category: 'Active'
  }
}

/** @public */
export function mapGitLabIssueStatus (issue: Pick<GitLabIssue, 'state' | 'closed_at'>): HulyGitLabStatusDraft {
  return mapGitLabStatus(issue.state, issue.closed_at)
}

/** @public */
export function mapGitLabIssue (issue: GitLabIssue): HulyGitLabIssueDraft {
  return {
    integrationKind: gitlabIntegrationKind,
    externalId: gitLabExternalId('issue', issue.project_id, issue.iid),
    projectId: issue.project_id,
    issueId: issue.id,
    number: issue.iid,
    title: issue.title,
    description: issue.description ?? '',
    url: issue.web_url,
    status: mapGitLabIssueStatus(issue),
    labels: (issue.labels ?? []).map((label) => mapGitLabLabel(label, issue.project_id)),
    author: mapGitLabUser(issue.author),
    assignees: (issue.assignees ?? (issue.assignee != null ? [issue.assignee] : [])).map(mapGitLabUser).filter(isDefined),
    milestone: issue.milestone?.title,
    confidential: issue.confidential ?? false,
    createdAt: parseGitLabTimestamp(issue.created_at),
    updatedAt: parseGitLabTimestamp(issue.updated_at),
    closedAt: parseGitLabTimestamp(issue.closed_at)
  }
}

/** @public */
export function mapGitLabComment (note: GitLabNote, projectId?: number): HulyGitLabCommentDraft {
  const issueIid = note.noteable_iid
  return {
    integrationKind: gitlabIntegrationKind,
    externalId: gitLabExternalId('note', projectId, issueIid, note.id),
    projectId,
    issueIid,
    noteId: note.id,
    body: note.body,
    author: mapGitLabUser(note.author),
    createdAt: parseGitLabTimestamp(note.created_at),
    updatedAt: parseGitLabTimestamp(note.updated_at),
    system: note.system ?? false,
    internal: note.internal ?? note.confidential ?? false,
    noteableId: note.noteable_id,
    noteableIid: issueIid,
    noteableType: note.noteable_type
  }
}

/** @public */
export function parseGitLabTimestamp (value: string | null | undefined): number | undefined {
  if (value == null || value === '') {
    return undefined
  }

  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function isDefined<T> (value: T | undefined): value is T {
  return value !== undefined
}
