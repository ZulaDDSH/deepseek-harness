/**
 * Packet assembly: lesson-signal extraction, provider-vocabulary freshness,
 * and byte bounding that never silently drops the truncation marker.
 */

import { describe, expect, it } from 'vitest'
import {
  NO_SIGNALS,
  assemblePacket,
  byteLength,
  extractLessonSignals,
  freshnessFor,
  renderPacket,
} from '../src/packet.ts'
import type { KnowledgeItem } from '../src/types.ts'

/** One item with the given provider and text. */
function item(provider: 'gitnexus' | 'graphify', text: string): KnowledgeItem {
  return {
    provider,
    serverName: provider,
    task: 'task',
    text,
    freshness: { kind: 'unknown' },
    signals: NO_SIGNALS,
    retrievedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('extractLessonSignals', () => {
  it('counts lesson annotations and stale markers', () => {
    const text = 'NODE a learning=preferred\nNODE b learning=tentative:stale\nNODE c learning=contested:stale'
    expect(extractLessonSignals(text)).toEqual({
      lessonsObserved: 3,
      staleLessons: 2,
      lessonStatuses: ['contested', 'preferred', 'tentative'],
    })
  })

  it('reports nothing for output without annotations', () => {
    expect(extractLessonSignals('plain provider output')).toEqual({
      lessonsObserved: 0,
      staleLessons: 0,
      lessonStatuses: [],
    })
  })
})

describe('freshnessFor', () => {
  it('never claims currency for a provider that reports no lesson state', () => {
    expect(freshnessFor('gitnexus', NO_SIGNALS)).toEqual({ kind: 'unknown' })
    expect(freshnessFor('graphify', NO_SIGNALS)).toEqual({ kind: 'unknown' })
  })

  it('reports current only when Graphify annotated lessons and none is stale', () => {
    expect(freshnessFor('graphify', extractLessonSignals('learning=preferred'))).toEqual({ kind: 'current' })
  })

  it('reports stale with a detail when any annotated lesson is stale', () => {
    const freshness = freshnessFor('graphify', extractLessonSignals('learning=preferred:stale'))
    expect(freshness.kind).toBe('stale')
    if (freshness.kind !== 'stale') throw new Error('expected a stale freshness')
    expect(freshness.detail).toContain('1 of 1')
  })

  it('prefers a probed lesson state over annotations parsed from the text', () => {
    const annotated = extractLessonSignals('learning=preferred')
    const probed = freshnessFor('graphify', annotated, { node: 'closeSession()', status: 'preferred', stale: true })
    expect(probed.kind).toBe('stale')
    if (probed.kind !== 'stale') throw new Error('expected a stale freshness')
    expect(probed.detail).toContain('closeSession()')
    expect(freshnessFor('graphify', annotated, { node: 'closeSession()', status: 'preferred', stale: false }))
      .toEqual({ kind: 'current' })
  })

  it('stays unknown when a probe found a node but no lesson', () => {
    expect(freshnessFor('graphify', NO_SIGNALS, { node: 'openSession()', stale: false })).toEqual({ kind: 'unknown' })
  })
})

describe('assemblePacket', () => {
  it('renders stale knowledge as requiring reverification', () => {
    const stale: KnowledgeItem = {
      ...item('graphify', 'old lesson'),
      freshness: { kind: 'stale', detail: 'Graphify marked 1 of 1 lesson annotations stale' },
    }
    const packet = assemblePacket({
      task: 'task',
      providers: ['graphify'],
      unavailable: [],
      items: [stale],
      maxBytes: 4096,
    })
    expect(renderPacket(packet)).toContain('STALE - REVERIFY')
  })

  it('keeps the packet within the byte bound and marks truncation', () => {
    const packet = assemblePacket({
      task: 'task',
      providers: ['gitnexus'],
      unavailable: [],
      items: [item('gitnexus', 'x'.repeat(20_000))],
      maxBytes: 512,
    })
    expect(packet.truncated).toBe(true)
    expect(byteLength(renderPacket(packet))).toBeLessThanOrEqual(512)
    expect(packet.items[0]?.text).toContain('[provider output truncated]')
  })

  it('leaves a packet that already fits untouched', () => {
    const packet = assemblePacket({
      task: 'task',
      providers: ['gitnexus'],
      unavailable: [],
      items: [item('gitnexus', 'short')],
      maxBytes: 4096,
    })
    expect(packet.truncated).toBe(false)
    expect(packet.items[0]?.text).toBe('short')
  })

  it('records unavailable providers without inventing an item for them', () => {
    const packet = assemblePacket({
      task: 'task',
      providers: ['gitnexus'],
      unavailable: ['graphify'],
      items: [item('gitnexus', 'code')],
      maxBytes: 4096,
    })
    expect(packet.unavailable).toEqual(['graphify'])
    expect(renderPacket(packet)).toContain('unavailable: graphify')
  })

  it('renders an empty provider list and stale freshness without a detail', () => {
    const packet = assemblePacket({
      task: 'task',
      providers: [],
      unavailable: [],
      items: [],
      maxBytes: 4096,
    })
    expect(renderPacket(packet)).toContain('queried: none')
    expect(renderPacket({
      task: 'task',
      providers: ['gitnexus'],
      unavailable: [],
      items: [{
        provider: 'gitnexus',
        serverName: 'gitnexus',
        text: 'old',
        freshness: { kind: 'stale' },
        retrievedAt: '2026-01-01T00:00:00.000Z',
      }],
    })).toContain('STALE - REVERIFY ()')
  })

  it('cuts before an unmatched high surrogate when bounding multibyte provider text', () => {
    const entry = item('gitnexus', 'a🧠'.repeat(300))
    const emptyHeaderBytes = byteLength(renderPacket({
      task: 'task', providers: ['gitnexus'], unavailable: [], items: [],
    }))
    const packet = assemblePacket({
      task: 'task',
      providers: ['gitnexus'],
      unavailable: [],
      items: [entry],
      maxBytes: emptyHeaderBytes + 162,
    })
    expect(packet.items[0]?.text).toBe('a\n[provider output truncated]')
  })

  it('drops an oversized item when fixed metadata already exceeds the available budget', () => {
    const packet = assemblePacket({
      task: 'task',
      providers: ['gitnexus'],
      unavailable: [],
      items: [{ ...item('gitnexus', 'short'), retrievedAt: 'x'.repeat(1000) }],
      maxBytes: byteLength(renderPacket({ task: 'task', providers: ['gitnexus'], unavailable: [], items: [] })) + 400,
    })
    expect(packet.truncated).toBe(true)
    expect(packet.items).toEqual([])
  })

  it('drops items without shortening when even the empty packet exceeds the bound', () => {
    const packet = assemblePacket({
      task: 'x'.repeat(1000),
      providers: ['gitnexus'],
      unavailable: [],
      items: [item('gitnexus', 'short')],
      maxBytes: 10,
    })
    expect(packet.truncated).toBe(true)
    expect(packet.items).toEqual([])
  })
})
