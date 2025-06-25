import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0', // 允许局域网访问
    port: 5173,      // 可选：自定义端口（默认 5173）
    proxy: {          // 保留代理配置
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  preview: {
    allowedHosts: [
      "646f-175-18-156-67.ngrok-free.app"
    ]
  }
})