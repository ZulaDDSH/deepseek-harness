import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('public package release rehearsals', () => {
  it.each(['release.yml', 'release-vendor.yml'])('%s uses GitHub-hosted runners', (file) => {
    const workflow: unknown = load(readFileSync(resolve(root, '.github/workflows', file), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
      throw new TypeError(`${file} must define jobs`)
    }
    for (const job of Object.values(workflow.jobs)) {
      if (!isRecord(job) || !('runs-on' in job)) {
        throw new TypeError(`${file} jobs must define a runner`)
      }
      expect(job['runs-on']).toBe('ubuntu-latest')
    }
  })
})
