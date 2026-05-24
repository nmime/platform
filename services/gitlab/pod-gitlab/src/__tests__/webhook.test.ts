import {
  GitLabWebhookParseError,
  GitLabWebhookVerificationError,
  getGitLabHeader,
  parseGitLabWebhook,
  verifyGitLabWebhookToken
} from '../webhook'

describe('GitLab webhook parsing and verification', () => {
  it('accepts matching X-Gitlab-Token values', () => {
    expect(verifyGitLabWebhookToken('secret', 'secret')).toBe(true)
    expect(getGitLabHeader({ 'X-Gitlab-Token': 'secret' }, 'x-gitlab-token')).toBe('secret')
  })

  it('rejects missing or mismatched tokens', () => {
    expect(verifyGitLabWebhookToken(undefined, 'secret')).toBe(false)
    expect(verifyGitLabWebhookToken('nope', 'secret')).toBe(false)
    expect(() =>
      parseGitLabWebhook({
        headers: { 'x-gitlab-event': 'Issue Hook' },
        body: { object_kind: 'issue' },
        secretToken: 'secret',
        requireToken: true
      })
    ).toThrow(GitLabWebhookVerificationError)
  })

  it('parses event headers and JSON bodies', () => {
    const envelope = parseGitLabWebhook({
      headers: {
        'x-gitlab-event': 'Issue Hook',
        'x-gitlab-token': 'secret',
        'x-gitlab-event-uuid': 'event-1',
        'x-gitlab-webhook-uuid': 'hook-1',
        'x-gitlab-instance': 'https://gitlab.example.com'
      },
      body: JSON.stringify({ object_kind: 'issue', object_attributes: { id: 1, iid: 2 } }),
      secretToken: 'secret',
      requireToken: true
    })

    expect(envelope.event).toBe('Issue Hook')
    expect(envelope.eventUuid).toBe('event-1')
    expect(envelope.webhookUuid).toBe('hook-1')
    expect(envelope.instance).toBe('https://gitlab.example.com')
    expect(envelope.tokenValid).toBe(true)
    expect(envelope.payload.object_kind).toBe('issue')
  })

  it('infers events from object_kind and rejects invalid JSON', () => {
    expect(parseGitLabWebhook({ headers: {}, body: { object_kind: 'note' }, requireToken: false }).event).toBe('Note Hook')
    expect(() => parseGitLabWebhook({ headers: {}, body: '{', requireToken: false })).toThrow(GitLabWebhookParseError)
  })
})
