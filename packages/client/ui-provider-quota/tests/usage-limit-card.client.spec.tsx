// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsFormScope, SettingsFormScopeSnapshot } from '@deepseek-ai/dsh-client-ui-primitives'
import { en } from '../src/client/locales.ts'
import { UsageLimitCard, type UsageLimitCardProps } from '../src/client/UsageLimitCard.tsx'
import { UsageLimitCardController, type UsageLimitSettings } from '../src/client/usage-limit-card-controller.ts'

afterEach(cleanup)

type Snapshot = SettingsFormScopeSnapshot<UsageLimitSettings>

function scopeOf(initial: Snapshot) {
  let current = initial
  const listeners = new Set<() => void>()
  const mutate = vi.fn(async (_ops: unknown, _expectedRevision?: number) => true)
  const scope: SettingsFormScope<UsageLimitSettings> = {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate,
  }
  return {
    scope,
    mutate,
    publish(next: Snapshot) {
      current = next
      for (const listener of listeners) listener()
    },
  }
}

function settled(value: UsageLimitSettings | undefined, user?: unknown): Snapshot {
  return { status: 'ready', value, base: { nearLimitPercent: 90 }, user, revision: 4, writable: true }
}

function translate(key: string, params?: Record<string, string>): string {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? `{${name}}`)
}

function renderCard(face: ReturnType<UsageLimitCardController['inject']>, view: UsageLimitCardProps['view'] = 'page') {
  const { hooks, ...actions } = face
  const props = {
    ...actions,
    view,
    t: translate,
    useUsageLimitCard: select => select(hooks.usageLimitCard.getSnapshot()),
  } as UsageLimitCardProps
  return render(<UsageLimitCard {...props} />)
}

describe('usage warning share', () => {
  it('publishes the default share until the Host serves a section', () => {
    const fixture = scopeOf({ status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false })
    expect(new UsageLimitCardController(fixture.scope).nearLimit.getSnapshot()).toBe(90)
  })

  it('publishes the Host-accepted share and follows later accepted writes', () => {
    const fixture = scopeOf(settled({ nearLimitPercent: 80 }))
    const card = new UsageLimitCardController(fixture.scope)
    expect(card.nearLimit.getSnapshot()).toBe(80)
    fixture.publish(settled({ nearLimitPercent: 95 }, { nearLimitPercent: 95 }))
    expect(card.nearLimit.getSnapshot()).toBe(95)
  })

  it('stages the share and writes it on save, fenced by the revision it started from', async () => {
    const fixture = scopeOf(settled({ nearLimitPercent: 90 }))
    const face = new UsageLimitCardController(fixture.scope).inject()
    face.edit('nearLimitPercent', '85')
    expect(fixture.mutate).not.toHaveBeenCalled()
    face.save()
    await vi.waitFor(() => { expect(fixture.mutate).toHaveBeenCalledOnce() })
    expect(fixture.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['nearLimitPercent'], value: 85 }], 4)
  })

  it.each(['49', '101', '90.5', 'abc'])('blocks a save of %s, which is not a whole share from 50 to 100', async (text) => {
    const fixture = scopeOf(settled({ nearLimitPercent: 90 }))
    const face = new UsageLimitCardController(fixture.scope).inject()
    face.edit('nearLimitPercent', text)
    expect(face.hooks.usageLimitCard.getSnapshot().invalid).toBe(true)
    face.save()
    await Promise.resolve()
    expect(fixture.mutate).not.toHaveBeenCalled()
  })

  it('clears a stored share so the field re-inherits the default', async () => {
    const fixture = scopeOf(settled({ nearLimitPercent: 80 }, { nearLimitPercent: 80 }))
    const face = new UsageLimitCardController(fixture.scope).inject()
    face.resetField('nearLimitPercent')
    face.save()
    await vi.waitFor(() => { expect(fixture.mutate).toHaveBeenCalledOnce() })
    expect(fixture.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['nearLimitPercent'] }], 4)
  })
})

describe('UsageLimitCard', () => {
  it('renders its one-liner alone in the summary view', () => {
    renderCard(new UsageLimitCardController(scopeOf(settled({ nearLimitPercent: 90 })).scope).inject(), 'summary')
    expect(document.body.textContent).toBe(en.usageSettingsDescription)
  })

  it('shows the Host-accepted share in its labelled field', () => {
    renderCard(new UsageLimitCardController(scopeOf(settled({ nearLimitPercent: 80 })).scope).inject())
    expect(screen.getByLabelText(en.nearLimitLabel)).toHaveProperty('value', '80')
  })

  it('explains the range when the draft is outside it', () => {
    const face = new UsageLimitCardController(scopeOf(settled({ nearLimitPercent: 80 })).scope).inject()
    face.edit('nearLimitPercent', '49')
    renderCard(face)
    expect(screen.getByText('Enter a whole number from 50 to 100.')).toBeTruthy()
  })
})
