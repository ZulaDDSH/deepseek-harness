import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface Workflow {
  on: Record<string, unknown>
  jobs: Record<string, { 'runs-on': string }>
}

function workflow(file: string): Workflow {
  return load(readFileSync(resolve(root, '.github/workflows', file), 'utf8')) as Workflow
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

it.each(['release-publish.yml', 'release-vendor-publish.yml'])('%s stays manual on GitHub-hosted runners', (file) => {
  const publish = workflow(file)
  expect(Object.keys(publish.on)).toEqual(['workflow_dispatch'])
  for (const job of Object.values(publish.jobs)) expect(job['runs-on']).toBe('ubuntu-24.04')
})
