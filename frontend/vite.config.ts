import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// 构建版本号:打进 bundle(__BUILD_TS__) 同时写到 dist/version.json。
// 前端定期比对两者,发现服务器已是新版就提示刷新——
// 学生端 SPA 常年不刷新,旧 bundle 跑好几天是线上问题反复复发的根源。
const buildTs = Date.now().toString(36)

function versionJsonPlugin(): Plugin {
  return {
    name: 'emit-version-json',
    closeBundle() {
      try {
        const dir = resolve(__dirname, 'dist')
        mkdirSync(dir, { recursive: true })
        writeFileSync(resolve(dir, 'version.json'), JSON.stringify({ v: buildTs }))
      } catch { /* 写不进去不影响构建 */ }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_TS__: JSON.stringify(buildTs),
  },
  plugins: [
    react(),
    versionJsonPlugin(),
    // 老浏览器兼容（iPad Air 1 / iOS 12 Safari）：自动产出 ES5 nomodule 包 + polyfill
    // 现代浏览器仍走 esm 包，体积/性能不受影响
    legacy({
      targets: ['ios >= 11', 'safari >= 11', 'chrome >= 60', 'firefox >= 60'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
    }),
  ],
  build: {
    target: ['chrome87', 'safari14', 'firefox78', 'edge88'],
    cssTarget: ['chrome87', 'safari14'],
    rollupOptions: {
      output: {
        manualChunks(id) {
          // three.js 体系单独成 chunk:被 BattleScene3D 懒加载,
          // 不拖慢对战页外壳(答题/WS)的首屏
          if (id.includes('node_modules/three') ||
              id.includes('node_modules/@react-three') ||
              id.includes('node_modules/its-fine') ||
              id.includes('node_modules/@monogrid') ||
              id.includes('node_modules/three-mesh-bvh') ||
              id.includes('node_modules/three-stdlib')) {
            return 'three-vendor';
          }
        },
      },
    },
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
