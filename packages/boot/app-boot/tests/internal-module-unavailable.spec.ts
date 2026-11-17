import { describe, expect, it } from 'vitest'
import { isInternalModuleUnavailable } from '../src/profile-resolution/resolver.ts'

describe('isInternalModuleUnavailable', () => {
  it('matches the missing target without matching its require stack', () => {
    const moduleId = 'internal/modules/esm/loader'
    const direct = Object.assign(new Error(`Cannot find module '${moduleId}'`), { code: 'MODULE_NOT_FOUND' })
    const transitive = Object.assign(
      new Error(`Cannot find module 'missing-dependency'\nRequire stack:\n- /node/${moduleId}.js`),
      { code: 'MODULE_NOT_FOUND' },
    )

    expect(isInternalModuleUnavailable(direct, moduleId)).toBe(true)
    expect(isInternalModuleUnavailable(transitive, moduleId)).toBe(false)
  })

  it('accepts unavailable builtins and ESM targets, but not unrelated errors', () => {
    const moduleId = 'internal/modules/esm/loader'
    const builtin = Object.assign(new Error(`No such built-in module: ${moduleId}`), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' })
    const esm = Object.assign(
      new Error(`require() of ES Module /node/${moduleId}.js from /app/resolver.js not supported.`),
      { code: 'ERR_REQUIRE_ESM' },
    )
    const unrelated = Object.assign(new Error(`Cannot find module '${moduleId}'`), { code: 'EIO' })

    expect(isInternalModuleUnavailable(builtin, moduleId)).toBe(true)
    expect(isInternalModuleUnavailable(esm, moduleId)).toBe(true)
    expect(isInternalModuleUnavailable(unrelated, moduleId)).toBe(false)
  })
})
