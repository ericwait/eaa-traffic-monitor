import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite drives three independent builds — main, preload, renderer —
// from this single config. The `@shared` alias resolves the same typed
// contract folder in every process so an IPC-shape change is a compile error
// everywhere, not a runtime surprise in one process (see src/shared/README.md).
//
// The renderer `base: './'` matters: the packaged renderer is served over the
// `app://` custom scheme (see src/main/index.ts), so every asset URL must be
// relative for the privileged-scheme resolver to find it under out/renderer.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    base: './',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
