// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, it } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { MemoryIcon, MemoryPage } from '../src/client/MemoryPage.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('registers the memory panel with the Host remote and a localized sidebar entry', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'main': { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  const memory = {}
  ctx.provide('locale', locale)
  ctx.provide('remote', { memoryWorkspace: memory })
  ctx.provide('remote.memoryWorkspace', memory)
  ctx.provide('layout', {})
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  const main = ctx.slots.entries('main')[0]!
  expect(main.component).toBe(MemoryPage)
  expect(main.options).toMatchObject({ key: 'memory' })
  expect(main.inject!()).toEqual({ memory })
  const icon = ctx.slots.entries('sidebar.panellist')[0]!
  expect(icon.component).toBe(MemoryIcon)
  expect(icon.options).toMatchObject({ id: 'memory', order: 1 })
  locale.setLocale('en')
  expect(resolveSlotLabel(icon.options.label)).toBe(en.panel)
  locale.setLocale('zh')
  expect(resolveSlotLabel(icon.options.label)).toBe(zh.panel)
  const glyph = render(<MemoryIcon {...{ size: 18 } as ComponentProps<typeof MemoryIcon>} />)
  expect(glyph.container.querySelector('svg')?.getAttribute('width')).toBe('18')

  await fiber.dispose()
  expect(ctx.slots.entries('main')).toHaveLength(0)
  expect(ctx.slots.entries('sidebar.panellist')).toHaveLength(0)
})
