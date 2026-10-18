import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Build-only so the dev server's inline React preamble keeps working.
// connect-src allows the Archipelago WebSocket to any host.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  server: {
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      input: {
        background: 'background.html',
        overlay:    'overlay.html',
        shopBlocker: 'shop-blocker.html',
        desktop:    'desktop.html',
        vision:     'vision.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
})
