import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'GSE Portfolio',
        short_name: 'Portfolio',
        description: 'IC Securities GSE Portfolio Tracker',
        theme_color: '#080d14',
        background_color: '#080d14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ],
  optimizeDeps: {
    // Prevent Vite from pre-bundling pdfjs — it handles its own workers
    exclude: ['pdfjs-dist'],
  },
  build: {
    // Allow pdfjs legacy build (uses older module syntax) to pass through
    commonjsOptions: {
      include: [/pdfjs-dist/]
    }
  }
})