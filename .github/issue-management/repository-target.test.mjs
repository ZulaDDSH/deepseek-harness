import assert from 'node:assert/strict'
import test from 'node:test'

import { repositoryTarget } from './github.mjs'

test('uses the workflow repository override', () => {
  const previous = process.env.DSH_ISSUE_REPOSITORY
  process.env.DSH_ISSUE_REPOSITORY = 'ZulaDDSH/deepseek-harness'
  try {
    assert.deepEqual(repositoryTarget(), { organization: 'ZulaDDSH', repository: 'deepseek-harness' })
  } finally {
    if (previous === undefined) delete process.env.DSH_ISSUE_REPOSITORY
    else process.env.DSH_ISSUE_REPOSITORY = previous
  }
})

test('falls back to the canonical repository outside workflows', () => {
  const previous = process.env.DSH_ISSUE_REPOSITORY
  delete process.env.DSH_ISSUE_REPOSITORY
  try {
    assert.deepEqual(repositoryTarget(), { organization: 'deepseek-harness', repository: 'deepseek-harness' })
  } finally {
    if (previous !== undefined) process.env.DSH_ISSUE_REPOSITORY = previous
  }
})
