import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  worker: { format: 'es' },
  plugins: [
    devtools({
      // react-map-gl passes unknown props through to MapLibre, which rejects
      // the injected data-tsd-source attribute.
      injectSource: { enabled: true, ignore: { components: ['Map', 'Source', 'Layer'] } },
    }),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
