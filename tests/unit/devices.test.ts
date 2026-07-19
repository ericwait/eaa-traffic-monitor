import { describe, it, expect } from 'vitest'
import {
  resolveSavedDevice,
  DEFAULT_DEVICE_ID,
  type AudioOutputDevice
} from '@renderer/audio/devices'

// Guardian tests for the saved-route resolver — the pure half of per-stream
// output routing. It decides, without touching navigator, how a remembered
// {deviceId, deviceLabel} maps onto the devices that exist right now: keep it,
// follow a replug by label, or fall back to the default. (enumerateOutputs and
// onDeviceChange touch navigator and are exercised live, not here.)

const OUTPUTS: AudioOutputDevice[] = [
  { deviceId: 'spk-hash-1', label: 'MacBook Pro Speakers (Built-in)' },
  { deviceId: 'teams-hash-2', label: 'Microsoft Teams Audio Device (Virtual)' }
]

describe('resolveSavedDevice', () => {
  it('returns default when there is no saved selection', () => {
    expect(resolveSavedDevice(undefined, OUTPUTS)).toEqual({ kind: 'default' })
  })

  it('returns default when the saved selection is explicitly the default sentinel', () => {
    const saved = { deviceId: DEFAULT_DEVICE_ID, deviceLabel: 'System default' }
    expect(resolveSavedDevice(saved, OUTPUTS)).toEqual({ kind: 'default' })
  })

  it('matches an exact id that is still present', () => {
    const saved = {
      deviceId: 'teams-hash-2',
      deviceLabel: 'Microsoft Teams Audio Device (Virtual)'
    }
    const res = resolveSavedDevice(saved, OUTPUTS)
    expect(res.kind).toBe('exact')
    if (res.kind === 'exact') expect(res.device.deviceId).toBe('teams-hash-2')
  })

  it('follows a replug by label when the id changed (relabelled)', () => {
    // Same physical device, fresh id after unplug/replug — matched by its label.
    const saved = {
      deviceId: 'teams-OLD-id',
      deviceLabel: 'Microsoft Teams Audio Device (Virtual)'
    }
    const res = resolveSavedDevice(saved, OUTPUTS)
    expect(res.kind).toBe('relabelled')
    if (res.kind === 'relabelled') expect(res.device.deviceId).toBe('teams-hash-2')
  })

  it('reports missing when neither the id nor the label is present now', () => {
    const saved = { deviceId: 'gone-id', deviceLabel: 'AirPods Pro' }
    const res = resolveSavedDevice(saved, OUTPUTS)
    expect(res.kind).toBe('missing')
    if (res.kind === 'missing') expect(res.savedLabel).toBe('AirPods Pro')
  })

  it('reports missing against an empty device set', () => {
    const saved = { deviceId: 'spk-hash-1', deviceLabel: 'MacBook Pro Speakers (Built-in)' }
    expect(resolveSavedDevice(saved, []).kind).toBe('missing')
  })
})
