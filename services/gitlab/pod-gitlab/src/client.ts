//
// Copyright © 2026 Hardcore Engineering Inc.
//

import type { GitLabIssue, GitLabLabel, GitLabNote, GitLabProject, GitLabUser } from '@hcengineering/gitlab'

/** @public */
export type GitLabTokenType = 'pat' | 'oauth' | 'job'

/** @public */
export type GitLabHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** @public */
export type GitLabQueryValue = string | number | boolean | undefined | null

/** @public */
export type GitLabQueryParams = Record<string, GitLabQueryValue | GitLabQueryValue[]>

/** @public */
export interface GitLabHeadersLike {
  get: (name: string) => string | null
}

/** @public */
export interface GitLabResponseLike {
  ok: boolean
  status: number
  statusText: string
  headers: GitLabHeadersLike
  text: () => Promise<string>
}

/** @public */
export interface GitLabRequestInit {
  method: GitLabHttpMethod
  headers: Record<string, string>
  body?: string
}

/** @public */
export type GitLabFetch = (url: string, init: GitLabRequestInit) => Promise<GitLabResponseLike>

/** @public */
export interface GitLabClientOptions {
  baseUrl?: string
  token?: string
  tokenType?: GitLabTokenType
  userAgent?: string
  fetch?: GitLabFetch
}

/** @public */
export interface GitLabPagedParams extends GitLabQueryParams {
  page?: number
  per_page?: number
}

/** @public */
export interface GitLabListProjectsParams extends GitLabPagedParams {
  membership?: boolean
  owned?: boolean
  search?: string
  simple?: boolean
  archived?: boolean
  visibility?: 'private' | 'internal' | 'public'
}

/** @public */
export interface GitLabListIssuesParams extends GitLabPagedParams {
  state?: 'opened' | 'closed' | 'all'
  labels?: string
  search?: string
  author_id?: number
  assignee_id?: number
  updated_after?: string
  updated_before?: string
  created_after?: string
  created_before?: string
  order_by?:
    | 'created_at'
    | 'updated_at'
    | 'priority'
    | 'due_date'
    | 'relative_position'
    | 'label_priority'
    | 'milestone_due'
    | 'popularity'
    | 'weight'
  sort?: 'asc' | 'desc'
}

/** @public */
export interface GitLabIssueInput {
  title?: string
  description?: string
  confidential?: boolean
  assignee_ids?: number[]
  milestone_id?: number
  labels?: string
  state_event?: 'close' | 'reopen'
  due_date?: string
}

/** @public */
export interface GitLabCreateIssueInput extends GitLabIssueInput {
  title: string
}

/** @public */
export interface GitLabListNotesParams extends GitLabPagedParams {
  sort?: 'asc' | 'desc'
  order_by?: 'created_at' | 'updated_at'
  activity_filter?: 'only_activity' | 'only_comments' | 'all_notes'
}

/** @public */
export interface GitLabCreateNoteInput {
  body: string
  internal?: boolean
  confidential?: boolean
}

/** @public */
export interface GitLabLabelInput {
  name?: string
  new_name?: string
  color?: string
  description?: string
  priority?: number
}

/** @public */
export interface GitLabCreateLabelInput extends GitLabLabelInput {
  name: string
  color: string
}

/** @public */
export interface GitLabListUsersParams extends GitLabPagedParams {
  username?: string
  search?: string
  active?: boolean
  blocked?: boolean
  external?: boolean
  exclude_external?: boolean
}

/** @public */
export interface GitLabListMembersParams extends GitLabPagedParams {
  query?: string
  user_ids?: number[]
  skip_users?: number[]
  show_seat_info?: boolean
}

/** @public */
export interface GitLabProjectMember extends GitLabUser {
  access_level?: number
  expires_at?: string | null
}

/** @public */
export interface GitLabResponse<T> {
  data: T
  status: number
  headers: GitLabHeadersLike
}

/** @public */
export class GitLabRestError extends Error {
  readonly status: number
  readonly statusText: string
  readonly responseBody: unknown

  constructor (status: number, statusText: string, responseBody: unknown) {
    super(`GitLab REST request failed: ${status} ${statusText}`)
    this.name = 'GitLabRestError'
    this.status = status
    this.statusText = statusText
    this.responseBody = responseBody
  }

  toJSON (): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      responseBody: this.responseBody
    }
  }
}

/**
 * Typed GitLab REST client for projects, issues, notes, labels, and users.
 *
 * It uses GitLab API v4, supports PAT/OAuth/job token header styles, paginates list endpoints,
 * and accepts an injectable fetch implementation for standalone tests.
 *
 * @public
 */
export class GitLabRestClient {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly tokenType: GitLabTokenType
  private readonly userAgent: string
  private readonly fetchImpl: GitLabFetch

  constructor (options: GitLabClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? 'https://gitlab.com')
    this.token = options.token
    this.tokenType = options.tokenType ?? 'pat'
    this.userAgent = options.userAgent ?? 'huly-gitlab'
    this.fetchImpl = options.fetch ?? getGlobalFetch()
  }

  async listProjects (params: GitLabListProjectsParams = {}): Promise<GitLabProject[]> {
    return await this.requestAllPages<GitLabProject>('/projects', params)
  }

  async getProject (project: string | number): Promise<GitLabProject> {
    return await this.requestJson<GitLabProject>('GET', `/projects/${encodeProjectId(project)}`)
  }

  async listProjectIssues (project: string | number, params: GitLabListIssuesParams = {}): Promise<GitLabIssue[]> {
    return await this.requestAllPages<GitLabIssue>(`/projects/${encodeProjectId(project)}/issues`, params)
  }

  async getProjectIssue (project: string | number, issueIid: number): Promise<GitLabIssue> {
    return await this.requestJson<GitLabIssue>('GET', `/projects/${encodeProjectId(project)}/issues/${issueIid}`)
  }

  async createProjectIssue (project: string | number, input: GitLabCreateIssueInput): Promise<GitLabIssue> {
    return await this.requestJson<GitLabIssue>('POST', `/projects/${encodeProjectId(project)}/issues`, undefined, input)
  }

  async updateProjectIssue (project: string | number, issueIid: number, input: GitLabIssueInput): Promise<GitLabIssue> {
    return await this.requestJson<GitLabIssue>(
      'PUT',
      `/projects/${encodeProjectId(project)}/issues/${issueIid}`,
      undefined,
      input
    )
  }

  async listIssueNotes (
    project: string | number,
    issueIid: number,
    params: GitLabListNotesParams = {}
  ): Promise<GitLabNote[]> {
    return await this.requestAllPages<GitLabNote>(
      `/projects/${encodeProjectId(project)}/issues/${issueIid}/notes`,
      params
    )
  }

  async getIssueNote (project: string | number, issueIid: number, noteId: number): Promise<GitLabNote> {
    return await this.requestJson<GitLabNote>(
      'GET',
      `/projects/${encodeProjectId(project)}/issues/${issueIid}/notes/${noteId}`
    )
  }

  async createIssueNote (project: string | number, issueIid: number, input: GitLabCreateNoteInput): Promise<GitLabNote> {
    return await this.requestJson<GitLabNote>(
      'POST',
      `/projects/${encodeProjectId(project)}/issues/${issueIid}/notes`,
      undefined,
      input
    )
  }

  async updateIssueNote (
    project: string | number,
    issueIid: number,
    noteId: number,
    input: GitLabCreateNoteInput
  ): Promise<GitLabNote> {
    return await this.requestJson<GitLabNote>(
      'PUT',
      `/projects/${encodeProjectId(project)}/issues/${issueIid}/notes/${noteId}`,
      undefined,
      input
    )
  }

  async deleteIssueNote (project: string | number, issueIid: number, noteId: number): Promise<void> {
    await this.requestJson<void>('DELETE', `/projects/${encodeProjectId(project)}/issues/${issueIid}/notes/${noteId}`)
  }

  async listLabels (project: string | number, params: GitLabPagedParams = {}): Promise<GitLabLabel[]> {
    return await this.requestAllPages<GitLabLabel>(`/projects/${encodeProjectId(project)}/labels`, params)
  }

  async getLabel (project: string | number, labelName: string): Promise<GitLabLabel> {
    return await this.requestJson<GitLabLabel>(
      'GET',
      `/projects/${encodeProjectId(project)}/labels/${encodeURIComponent(labelName)}`
    )
  }

  async createLabel (project: string | number, input: GitLabCreateLabelInput): Promise<GitLabLabel> {
    return await this.requestJson<GitLabLabel>('POST', `/projects/${encodeProjectId(project)}/labels`, undefined, input)
  }

  async updateLabel (project: string | number, labelName: string, input: GitLabLabelInput): Promise<GitLabLabel> {
    return await this.requestJson<GitLabLabel>(
      'PUT',
      `/projects/${encodeProjectId(project)}/labels/${encodeURIComponent(labelName)}`,
      undefined,
      input
    )
  }

  async deleteLabel (project: string | number, labelName: string): Promise<void> {
    await this.requestJson<void>('DELETE', `/projects/${encodeProjectId(project)}/labels/${encodeURIComponent(labelName)}`)
  }

  async listUsers (params: GitLabListUsersParams = {}): Promise<GitLabUser[]> {
    return await this.requestAllPages<GitLabUser>('/users', params)
  }

  async getUser (userId: number): Promise<GitLabUser> {
    return await this.requestJson<GitLabUser>('GET', `/users/${userId}`)
  }

  async getCurrentUser (): Promise<GitLabUser> {
    return await this.requestJson<GitLabUser>('GET', '/user')
  }

  async listProjectMembers (project: string | number, params: GitLabListMembersParams = {}): Promise<GitLabProjectMember[]> {
    return await this.requestAllPages<GitLabProjectMember>(`/projects/${encodeProjectId(project)}/members/all`, params)
  }

  private async requestAllPages<T> (path: string, params: GitLabPagedParams): Promise<T[]> {
    const result: T[] = []
    let page = params.page ?? 1

    while (true) {
      const response = await this.request<T[]>('GET', path, {
        ...params,
        page,
        per_page: params.per_page ?? 100
      })
      result.push(...response.data)

      const nextPage = response.headers.get('x-next-page')
      if (nextPage == null || nextPage === '') {
        break
      }
      page = Number(nextPage)
      if (!Number.isFinite(page) || page <= 0) {
        break
      }
    }

    return result
  }

  private async requestJson<T> (
    method: GitLabHttpMethod,
    path: string,
    params?: GitLabQueryParams,
    body?: unknown
  ): Promise<T> {
    return (await this.request<T>(method, path, params, body)).data
  }

  private async request<T> (
    method: GitLabHttpMethod,
    path: string,
    params?: GitLabQueryParams,
    body?: unknown
  ): Promise<GitLabResponse<T>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.userAgent
    }
    this.addAuthHeaders(headers)

    const init: GitLabRequestInit = {
      method,
      headers
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    const response = await this.fetchImpl(this.toUrl(path, params), init)
    const text = await response.text()
    const parsed = parseJsonResponse(text)

    if (!response.ok) {
      throw new GitLabRestError(response.status, response.statusText, parsed)
    }

    return {
      data: parsed as T,
      status: response.status,
      headers: response.headers
    }
  }

  private addAuthHeaders (headers: Record<string, string>): void {
    if (this.token == null || this.token === '') {
      return
    }

    if (this.tokenType === 'oauth') {
      headers.Authorization = `Bearer ${this.token}`
      return
    }

    if (this.tokenType === 'job') {
      headers['JOB-TOKEN'] = this.token
      return
    }

    headers['PRIVATE-TOKEN'] = this.token
  }

  private toUrl (path: string, params?: GitLabQueryParams): string {
    const apiPath = path.startsWith('/') ? path : `/${path}`
    const url = `${this.baseUrl}/api/v4${apiPath}`
    const query = encodeQuery(params)
    return query === '' ? url : `${url}?${query}`
  }
}

function normalizeBaseUrl (baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function encodeProjectId (project: string | number): string {
  return encodeURIComponent(String(project))
}

function encodeQuery (params: GitLabQueryParams | undefined): string {
  if (params == null) {
    return ''
  }

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        appendQueryValue(search, key, item)
      }
    } else {
      appendQueryValue(search, key, value)
    }
  }
  return search.toString()
}

function appendQueryValue (search: URLSearchParams, key: string, value: GitLabQueryValue): void {
  if (value == null) {
    return
  }
  search.append(key, String(value))
}

function parseJsonResponse (text: string): unknown {
  if (text.trim() === '') {
    return undefined
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function getGlobalFetch (): GitLabFetch {
  const fetchImpl = (globalThis as unknown as { fetch?: GitLabFetch }).fetch
  if (fetchImpl === undefined) {
    throw new Error('No fetch implementation is available for GitLabRestClient')
  }
  return fetchImpl
}
