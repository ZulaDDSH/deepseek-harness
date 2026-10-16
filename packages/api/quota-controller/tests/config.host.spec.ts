import { describe, expect, it } from 'vitest'
import { QuotaController } from '../src/index.ts'

describe('quota controller settings', () => {
  it('defaults the near-limit share to 90 and accepts whole shares from 50 to 100', () => {
    expect(QuotaController.Config({}).nearLimitPercent.get()).toBe(90)
    expect(QuotaController.Config({ nearLimitPercent: 50 }).nearLimitPercent.get()).toBe(50)
    expect(QuotaController.Config({ nearLimitPercent: 100 }).nearLimitPercent.get()).toBe(100)
    for (const invalid of [49, 101, 90.5]) expect(() => QuotaController.Config({ nearLimitPercent: invalid })).toThrow()
  })
})
