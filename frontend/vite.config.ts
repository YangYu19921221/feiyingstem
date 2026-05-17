import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // 老浏览器兼容（iPad Air 1 / iOS 12 Safari）：自动产出 ES5 nomodule 包 + polyfill
    // 现代浏览器仍走 esm 包，体积/性能不受影响
    legacy({
      targets: ['ios >= 11', 'safari >= 11', 'chrome >= 60', 'firefox >= 60'],
      modernPolyfills: ['es.promise.finally'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
    }),
  ],
  build: {
    target: ['chrome87', 'safari14', 'firefox78', 'edge88'],
    cssTarget: ['chrome87', 'safari14'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      }
    }
  }
})
