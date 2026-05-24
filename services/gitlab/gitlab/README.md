# @hcengineering/gitlab

Shared GitLab integration DTO/mapping library for the external Huly GitLab pod.

Exports include:

- typed GitLab DTOs for `GitLabProject`, `GitLabIssue`, `GitLabNote`, `GitLabLabel`, `GitLabUser`, and issue status state.
- stable external ID helper `gitLabExternalId(...)`.
- mappers: `mapGitLabProject`, `mapGitLabIssue`, `mapGitLabComment`, `mapGitLabLabel`, `mapGitLabUser`, `mapGitLabStatus`, and `mapGitLabIssueStatus`.

Stable IDs use the `gitlab:` prefix, for example `gitlab:project:123`, `gitlab:issue:123:7`, `gitlab:note:123:7:99`, `gitlab:label:123:bug`, and `gitlab:user:42`.
