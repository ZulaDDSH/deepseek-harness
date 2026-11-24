import { existsSync, rmdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { prepareManagedProcessBinding } from '../src/output.ts'

describe('private spill directory', () => {
  it('is reused while it exists and recreated after an external cleaner removes it', () => {
    const first = prepareManagedProcessBinding().spillDir
    expect(prepareManagedProcessBinding().spillDir).toBe(first)
    rmdirSync(first)
    const second = prepareManagedProcessBinding().spillDir
    expect(second).not.toBe(first)
    expect(statSync(second).isDirectory()).toBe(true)
    if (process.platform !== 'win32') expect(statSync(second).mode & 0o777).toBe(0o700)
    rmdirSync(second)
    expect(existsSync(second)).toBe(false)
  })
})
