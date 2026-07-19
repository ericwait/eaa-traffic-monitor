// Output-device enumeration for per-stream routing (Phase 2b).
//
// Thin wrapper over navigator.mediaDevices: it lists the concrete audiooutput
// devices, subscribes to hot plug/unplug (`devicechange`), and resolves a saved
// selection against the live device set with a match-by-label fallback. Device
// LABELS require a secure context — which the packaged renderer has (loopback
// http origin, or app://), verified live 2026-07-19: enumerateDevices returned
// labelled outputs and AudioContext.setSinkId routed to a specific one.
//
// The spike confirmed AudioContext.setSinkId works in the shipped Electron, so
// routing itself lives on the context in streamPlayer.ts; this module only
// answers "what outputs exist right now?" and "does this saved route still
// resolve?".

/** One selectable audio output. */
export interface AudioOutputDevice {
  deviceId: string
  label: string
}

/**
 * The sentinel deviceId for "follow the system default output". Empty string is
 * exactly what `AudioContext.setSinkId('')` expects for the default sink, and it
 * keeps tracking the OS default if the user changes it — distinct from pinning
 * the concrete device that happens to be default right now.
 */
export const DEFAULT_DEVICE_ID = ''
/** The human label for the default-output choice, shown first in every picker. */
export const DEFAULT_DEVICE_LABEL = 'System default'

/**
 * List the concrete output devices. The platform pseudo-entries ('default' and
 * 'communications') are dropped — the app models "follow default" itself via the
 * DEFAULT_DEVICE_ID sentinel, so surfacing them too would be a confusing
 * duplicate of "System default". Returns [] (never throws) on failure so the
 * picker degrades to just the default option.
 */
export async function enumerateOutputs(): Promise<AudioOutputDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audiooutput')
      .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Unnamed output' }))
  } catch (err: unknown) {
    console.error('[audio:devices] could not enumerate output devices:', err)
    return []
  }
}

/**
 * Subscribe to output plug/unplug. Returns an unsubscribe function so a
 * StrictMode/HMR re-mount never stacks duplicate listeners. No-op (returns a
 * no-op unsubscribe) if mediaDevices is unavailable.
 */
export function onDeviceChange(listener: () => void): () => void {
  const md = navigator.mediaDevices as MediaDevices | undefined
  if (!md || typeof md.addEventListener !== 'function') return () => {}
  md.addEventListener('devicechange', listener)
  return () => md.removeEventListener('devicechange', listener)
}

/** How a saved selection resolved against the current device set. */
export type DeviceResolution =
  | { kind: 'default' } // no saved selection, or it explicitly is the default
  | { kind: 'exact'; device: AudioOutputDevice } // saved id still present
  | { kind: 'relabelled'; device: AudioOutputDevice } // matched by label; id changed after replug
  | { kind: 'missing'; savedLabel: string } // neither id nor label is present now

/**
 * Resolve a saved {deviceId, deviceLabel} against the live outputs.
 *
 *   - exact id present            → route to it,
 *   - id gone but a same-LABEL device is present (replug handed it a fresh id)
 *                                 → route to the new id and re-persist,
 *   - neither present             → fall back to the default and tell the operator.
 */
export function resolveSavedDevice(
  saved: { deviceId: string; deviceLabel: string } | undefined,
  outputs: readonly AudioOutputDevice[]
): DeviceResolution {
  if (!saved || saved.deviceId === DEFAULT_DEVICE_ID) return { kind: 'default' }

  const byId = outputs.find((d) => d.deviceId === saved.deviceId)
  if (byId) return { kind: 'exact', device: byId }

  const byLabel = outputs.find((d) => d.label === saved.deviceLabel)
  if (byLabel) return { kind: 'relabelled', device: byLabel }

  return { kind: 'missing', savedLabel: saved.deviceLabel }
}
