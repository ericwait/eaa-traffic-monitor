import { describe, expect, it } from 'vitest'
import { moveTo } from '../../src/renderer/src/audio/orderMath'

// The channel manager's reorder semantics: the drag preview and the grip's
// ArrowUp/ArrowDown path both funnel through moveTo, and the committed order
// becomes priority 1..N top-to-bottom (engine.reorderChannels).

const ORDER = ['guard', 'tower', 'fisk', 'atis'] as const

describe('moveTo', () => {
  it('moves an id up', () => {
    expect(moveTo(ORDER, 'fisk', 0)).toEqual(['fisk', 'guard', 'tower', 'atis'])
  })

  it('moves an id down', () => {
    expect(moveTo(ORDER, 'guard', 2)).toEqual(['tower', 'fisk', 'guard', 'atis'])
  })

  it('moving to its current index is an identity (new array, same order)', () => {
    const result = moveTo(ORDER, 'tower', 1)
    expect(result).toEqual([...ORDER])
    expect(result).not.toBe(ORDER)
  })

  it('clamps an out-of-range target index to the ends', () => {
    expect(moveTo(ORDER, 'tower', -5)).toEqual(['tower', 'guard', 'fisk', 'atis'])
    expect(moveTo(ORDER, 'tower', 99)).toEqual(['guard', 'fisk', 'atis', 'tower'])
  })

  it('returns an unchanged copy when the id is absent', () => {
    const result = moveTo(ORDER, 'nope', 1)
    expect(result).toEqual([...ORDER])
    expect(result).not.toBe(ORDER)
  })

  it('never mutates the input', () => {
    const input = [...ORDER]
    moveTo(input, 'atis', 0)
    expect(input).toEqual([...ORDER])
  })
})
