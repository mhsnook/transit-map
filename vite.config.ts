import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools({
      // react-map-gl's Source and Layer pass every prop into MapLibre's style
      // spec, which rejects the injected data-tsd-source. These match JSX
      // names, so renaming those imports brings the error back.
      injectSource: { enabled: true, ignore: { components: ['Source', 'Layer'] } },
    }),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
