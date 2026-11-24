import { describe, expect, it } from 'vitest'
import { OutputCollector } from '../src/output.ts'

const euro = Buffer.from('€')
const smile = Buffer.from('😀')

describe('incremental UTF-8 reads', () => {
  it.each([
    ['a three-byte character', euro],
    ['a four-byte character', smile],
  ])('reassembles %s split across reads', (_label, character) => {
    for (let cut = 1; cut < character.length; cut += 1) {
      const collector = new OutputCollector(1024, 'test', undefined)
      collector.push(Buffer.concat([Buffer.from('a'), character.subarray(0, cut)]))
      const first = collector.readFrom(0)
      expect(first).toMatchObject({ text: 'a', nextOffset: 1, lossy: false })
      collector.push(character.subarray(cut))
      const second = collector.readFrom(first.nextOffset)
      expect(second).toMatchObject({ text: character.toString(), nextOffset: 1 + character.length, lossy: false })
    }
  })

  it('returns an empty delta while only an incomplete prefix exists', () => {
    const collector = new OutputCollector(1024, 'test', undefined)
    collector.push(smile.subarray(0, 2))
    expect(collector.readFrom(0)).toMatchObject({ text: '', nextOffset: 0 })
  })

  it('flushes malformed trailing bytes once the stream has ended', () => {
    const collector = new OutputCollector(1024, 'test', undefined)
    collector.push(Buffer.concat([Buffer.from('ok'), euro.subarray(0, 2)]))
    collector.seal()
    expect(collector.readFrom(0)).toMatchObject({ text: 'ok�', nextOffset: 4 })
  })
})
