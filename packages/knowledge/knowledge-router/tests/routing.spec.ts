/**
 * Routing behavior: which providers a task warrants, and the bounded cases
 * where the answer is neither or both.
 */

import { describe, expect, it } from 'vitest'
import { routeTask } from '../src/routing.ts'

describe('routeTask', () => {
  it('routes a structural call-chain question to code intelligence alone', () => {
    expect(routeTask('What calls Session::close?')).toEqual(['gitnexus'])
    expect(routeTask('who calls this function')).toEqual(['gitnexus'])
    expect(routeTask('show me the call chain from main to close')).toEqual(['gitnexus'])
  })

  it('routes a question about past attempts to learned knowledge alone', () => {
    expect(routeTask('Did we try fixing this race before?')).toEqual(['graphify'])
    expect(routeTask('Have we seen this dead end before?')).toEqual(['graphify'])
    expect(routeTask('Is there a lesson about shutdown ordering?')).toEqual(['graphify'])
  })

  it('routes an imperative task that also carries history to both providers', () => {
    expect(routeTask('Investigate this recurring race and propose a fix.')).toEqual(['gitnexus', 'graphify'])
    expect(routeTask('Fix the recurring leak in the terminal teardown')).toEqual(['gitnexus', 'graphify'])
  })

  it('retrieves nothing when no cue matches', () => {
    expect(routeTask('Write a haiku about the ocean')).toEqual([])
    expect(routeTask('')).toEqual([])
  })

  it('combines both providers when a structural question also carries history', () => {
    expect(routeTask('What calls Session::close, and did we try this before?')).toEqual(['gitnexus', 'graphify'])
  })

  it('matches cues on word boundaries rather than substrings', () => {
    expect(routeTask('prioritize the backlog')).toEqual([])
    expect(routeTask('the against list')).toEqual([])
  })

  it('routes an impact question to code intelligence alone', () => {
    expect(routeTask('What is the blast radius of changing this signature?')).toEqual(['gitnexus'])
    expect(routeTask('what changed in this diff')).toEqual(['gitnexus'])
  })
})
