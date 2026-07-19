import type { BrowserWindow } from 'electron'
import { IpcChannels } from '@shared/ipc'
import { getActiveConfig } from './config'
import { refreshWeather } from './weather'

// Background weather polling — pushes a fresh METAR/TAF result to the
// renderer on the configured cadence (config.weather.pollMinutes, floored at
// 5 by the config schema), the same "main pushes, renderer subscribes"
// pattern as fr24:navState (see Fr24Controller.pushNavState in fr24.ts). The
// renderer's weather panel also calls weather:get once on mount for an
// immediate first paint; this poller exists only to keep that data fresh
// afterward without the operator ever touching the refresh button.

export class WeatherPoller {
  private readonly window: BrowserWindow
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(window: BrowserWindow) {
    this.window = window
  }

  /** (Re)start the poll timer at the currently-configured interval. Safe to call repeatedly (e.g. after a config reload changes pollMinutes). */
  start(): void {
    this.stop()
    const { pollMinutes } = getActiveConfig().weather
    this.timer = setInterval(() => {
      void this.tick()
    }, pollMinutes * 60_000)
  }

  private async tick(): Promise<void> {
    if (this.window.isDestroyed()) return
    const result = await refreshWeather()
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IpcChannels.weatherUpdate, result)
    }
  }

  /** Stop the poll timer. Called on window close so it never outlives its window. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
