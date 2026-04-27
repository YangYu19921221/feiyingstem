import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 显式浏览器目标：覆盖 360/QQ/搜狗/UC 极速模式（Chromium 87+）、主流 Safari 14+/Firefox 78+/Edge 88+
    // 不支持 IE11 / 360 兼容模式 / 老旧 Chromium，由 index.html 顶部横幅引导用户切换
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
