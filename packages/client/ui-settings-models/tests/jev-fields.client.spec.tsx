// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { JevFields, jevConfigFailure, routeIdFor } from '../src/client/JevFields.tsx'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]
const PROVIDERS = [
  { provider: 'jev-router', displayName: 'Jev', models: [] },
  { provider: 'anthropic', displayName: 'Anthropic', models: ['claude-opus-5', 'Claude Sonnet 5.5'], efforts: { 'claude-opus-5': ['low', 'high'] } },
]

function mount(stored: Record<string, unknown>) {
  let latest: Record<string, unknown> = {}
  function Harness() {
    const [draft, setDraft] = useState<Record<string, unknown>>({})
    const [customFields, setCustomFields] = useState<ReadonlySet<string>>(() => new Set())
    latest = draft
    return <JevFields
      schema={settingsSchema} draft={draft} stored={stored} setDraft={setDraft} disabled={false}
      setField={(key, value) => {
        setDraft(current => value === undefined ? settingsSchema.deletePath(current, [key]) : settingsSchema.setPath(current, [key], value))
      }}
      ownProvider="jev-router" providers={PROVIDERS} customFields={customFields} setCustomFields={setCustomFields} t={t}
    />
  }
  render(<Harness />)
  return () => latest
}

const pick = (label: string, value: string): void => { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }

it('derives route ids from model names', () => {
  expect(routeIdFor('Claude Sonnet 5.5')).toBe('claude-sonnet-5-5')
  expect(routeIdFor('--gpt/6--')).toBe('gpt-6')
})

it('fills the route id from the chosen model, keeps it unique, and follows later model changes', () => {
  const draft = mount({ routes: [{ id: 'claude-opus-5', provider: 'anthropic', model: 'claude-opus-5', description: 'Hard work' }] })
  fireEvent.click(screen.getByText(en.jevAddRoute))
  pick(`${en.jevRouteProvider} 2`, 'anthropic')
  pick(`${en.jevRouteModel} 2`, 'claude-opus-5')
  expect(screen.getByLabelText<HTMLInputElement>(`${en.jevRouteId} 2`).value).toBe('claude-opus-5-2')
  fireEvent.click(screen.getByText(en.jevAddRoute))
  pick(`${en.jevRouteProvider} 3`, 'anthropic')
  pick(`${en.jevRouteModel} 3`, 'claude-opus-5')
  expect(screen.getByLabelText<HTMLInputElement>(`${en.jevRouteId} 3`).value).toBe('claude-opus-5-3')
  pick(`${en.jevRouteModel} 2`, 'Claude Sonnet 5.5')
  expect(screen.getByLabelText<HTMLInputElement>(`${en.jevRouteId} 2`).value).toBe('claude-sonnet-5-5')
  pick(`${en.jevRouteId} 2`, 'model-7')
  pick(`${en.jevRouteModel} 2`, 'claude-opus-5')
  expect(screen.getByLabelText<HTMLInputElement>(`${en.jevRouteId} 2`).value).toBe('model-7')
  pick(`${en.jevRouteId} 2`, 'fast')
  pick(`${en.jevRouteModel} 3`, '')
  expect(screen.getByLabelText<HTMLInputElement>(`${en.jevRouteId} 3`).value).toBe('')
  pick(`${en.jevRouteReasoningEffort} 1`, 'high')
  pick(`${en.jevRouteReasoningEffort} 1`, '')
  expect(draft().routes).toEqual([
    { id: 'claude-opus-5', provider: 'anthropic', model: 'claude-opus-5', description: 'Hard work' },
    { id: 'fast', provider: 'anthropic', model: 'claude-opus-5', description: '' },
    { id: '', provider: 'anthropic', model: '', description: '' },
  ])
})

it('offers only keep and existing route ids as fallback, and keeps it in step with renames and deletions', () => {
  const draft = mount({ fallback: 'strong', routes: [
    { id: 'strong', provider: 'anthropic', model: 'claude-opus-5', description: 'Hard work' },
    { id: 'quick', provider: 'anthropic', model: 'Claude Sonnet 5.5', description: 'Small edits' },
  ] })
  const fallback = screen.getByLabelText<HTMLSelectElement>(en.jevFallback)
  expect([...fallback.options].map(option => option.value)).toEqual(['keep', 'strong', 'quick'])
  expect(fallback.options[0]?.textContent).toBe(en.jevFallbackKeep)
  pick(`${en.jevRouteId} 1`, 'deep')
  expect(draft().fallback).toBe('deep')
  pick(`${en.jevRouteId} 1`, '')
  expect(draft().fallback).toBe('keep')
  pick(en.jevFallback, 'quick')
  pick(`${en.jevRouteId} 1`, 'deep')
  expect(draft().fallback).toBe('quick')
  fireEvent.click(screen.getByLabelText(`${en.jevRemoveRoute} 1`))
  expect(draft().fallback).toBe('quick')
  fireEvent.click(screen.getByLabelText(`${en.jevRemoveRoute} 1`))
  expect(draft().fallback).toBe('keep')
})

it('shows a stale fallback so it can be corrected', () => {
  mount({ fallback: 'gone', routes: [] })
  const fallback = screen.getByLabelText<HTMLSelectElement>(en.jevFallback)
  expect(fallback.value).toBe('gone')
  expect([...fallback.options].map(option => option.value)).toEqual(['keep', 'gone'])
})

it('explains every setting', () => {
  mount({})
  for (const key of ['jevEnabledHint', 'jevRoutesHint', 'jevFallbackHint', 'jevFailOpenHint', 'jevMinConfidenceHint',
    'jevTimeoutMsHint', 'jevStateMaxCharsHint', 'jevModelHint', 'jevEndpointHint', 'jevApiKeyEnvHint'] as const) {
    expect(screen.getByText(en[key])).toBeTruthy()
  }
  expect(screen.getByLabelText(en.jevMinConfidence).getAttribute('aria-describedby')).toBe('jev-minConfidence-hint')
  expect(document.getElementById('jev-minConfidence-hint')?.textContent).toBe(en.jevMinConfidenceHint)
})

it('reports the route problems the router refuses at load', () => {
  expect(jevConfigFailure([{ id: 'a' }, { id: 'b' }], 'b')).toBeUndefined()
  expect(jevConfigFailure([{ id: 'a' }, { id: '' }, { id: '' }], 'keep')).toBeUndefined()
  expect(jevConfigFailure([{ id: 'a' }, { id: 'a' }], 'keep')).toBe('jevRouteIdDuplicate')
  expect(jevConfigFailure([{ id: 'a' }, null, 'x', { id: 7 }], 'gone')).toBe('jevFallbackMissing')
  expect(jevConfigFailure(undefined, 'gone')).toBe('jevFallbackMissing')
  expect(jevConfigFailure(undefined, undefined)).toBeUndefined()
})
