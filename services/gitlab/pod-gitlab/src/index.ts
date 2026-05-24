//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { startGitLabHttpService, type GitLabHttpService } from './server'

export * from './client'
export * from './config'
export * from './delivery'
export * from './server'
export * from './syncEvents'
export * from './webhook'

/** @public */
export function loadDotEnvFile (fileName = process.env.GITLAB_ENV_FILE ?? '.env'): void {
  const file = resolve(process.cwd(), fileName)
  if (!existsSync(file)) {
    return
  }

  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }

    const index = trimmed.indexOf('=')
    if (index <= 0) {
      continue
    }

    const key = trimmed.slice(0, index).trim()
    const value = unquoteEnvValue(trimmed.slice(index + 1).trim())
    process.env[key] = process.env[key] ?? value
  }
}

async function main (): Promise<void> {
  loadDotEnvFile()
  const service = await startGitLabHttpService()
  installShutdownHandlers(service)
}

function installShutdownHandlers (service: GitLabHttpService): void {
  let closing = false
  const close = (signal: string): void => {
    if (closing) {
      return
    }
    closing = true
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', message: 'gitlab.shutdown', signal }))
    void service.close().finally(() => process.exit(0))
  }

  process.on('SIGINT', () => close('SIGINT'))
  process.on('SIGTERM', () => close('SIGTERM'))
}

function unquoteEnvValue (value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\n/g, '\n')
  }
  return value
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: 'gitlab.start.failed', error: String(err) }))
    process.exit(1)
  })
}
