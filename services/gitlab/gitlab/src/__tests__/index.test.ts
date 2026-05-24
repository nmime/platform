import {
  gitLabExternalId,
  gitlabIntegrationKind,
  gitlabUserIntegrationKind,
  mapGitLabComment,
  mapGitLabIssue,
  mapGitLabLabel,
  mapGitLabProject,
  mapGitLabStatus,
  mapGitLabUser,
  type GitLabIssue,
  type GitLabNote,
  type GitLabProject
} from '../index'

describe('@hcengineering/gitlab mappers', () => {
  it('builds stable external ids', () => {
    expect(gitLabExternalId('project', 123)).toBe('gitlab:project:123')
    expect(gitLabExternalId('issue', 123, 7)).toBe('gitlab:issue:123:7')
    expect(gitLabExternalId('note', 123, 7, 99)).toBe('gitlab:note:123:7:99')
  })

  it('maps GitLab projects with Huly integration metadata', () => {
    const project: GitLabProject = {
      id: 123,
      name: 'Platform',
      path: 'platform',
      path_with_namespace: 'hardcore/platform',
      description: 'Core platform',
      web_url: 'https://gitlab.com/hardcore/platform',
      default_branch: 'main',
      visibility: 'private',
      archived: false,
      namespace: { full_path: 'hardcore' },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z'
    }

    const mapped = mapGitLabProject(project)

    expect(mapped.integrationKind).toBe(gitlabIntegrationKind)
    expect(mapped.externalId).toBe('gitlab:project:123')
    expect(mapped.pathWithNamespace).toBe('hardcore/platform')
    expect(mapped.namespace).toBe('hardcore')
    expect(mapped.defaultBranch).toBe('main')
    expect(mapped.createdAt).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
  })

  it('maps users, labels, statuses, and issues', () => {
    const issue: GitLabIssue = {
      id: 456,
      iid: 7,
      project_id: 123,
      title: 'Add GitLab issue sync',
      description: 'Normalize issue payloads',
      state: 'opened',
      labels: [{ id: 88, name: 'integration', color: '#336699', description: 'Integrations' }, 'backend'],
      author: { id: 1, username: 'dev', name: 'Dev User', public_email: 'dev@example.com' },
      assignees: [{ id: 2, username: 'reviewer', name: 'Reviewer' }],
      web_url: 'https://gitlab.com/hardcore/platform/-/issues/7',
      confidential: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z'
    }

    const mapped = mapGitLabIssue(issue)

    expect(mapped.externalId).toBe('gitlab:issue:123:7')
    expect(mapped.status.externalId).toBe('gitlab:status:opened')
    expect(mapped.status.name).toBe('Open')
    expect(mapped.labels.map((label) => label.externalId)).toEqual(['gitlab:label:123:88', 'gitlab:label:123:backend'])
    expect(mapped.author?.integrationKind).toBe(gitlabUserIntegrationKind)
    expect(mapped.author?.externalId).toBe('gitlab:user:1')
    expect(mapped.assignees[0].externalId).toBe('gitlab:user:2')
    expect(mapped.confidential).toBe(true)

    expect(mapGitLabUser(issue.author)?.email).toBe('dev@example.com')
    expect(mapGitLabLabel('ops', 123).externalId).toBe('gitlab:label:123:ops')
    expect(mapGitLabStatus('closed', '2026-01-03T00:00:00.000Z').category).toBe('Won')
  })

  it('maps GitLab notes to comments', () => {
    const note: GitLabNote = {
      id: 99,
      body: 'Looks good',
      noteable_iid: 7,
      noteable_id: 456,
      noteable_type: 'Issue',
      author: { id: 2, username: 'reviewer', name: 'Reviewer' },
      system: false,
      internal: true,
      created_at: '2026-01-02T00:00:00.000Z'
    }

    const mapped = mapGitLabComment(note, 123)

    expect(mapped.integrationKind).toBe(gitlabIntegrationKind)
    expect(mapped.externalId).toBe('gitlab:note:123:7:99')
    expect(mapped.author?.externalId).toBe('gitlab:user:2')
    expect(mapped.internal).toBe(true)
  })
})
