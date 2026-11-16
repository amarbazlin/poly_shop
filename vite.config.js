import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto
}

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'cpt.png', 'icons/*.png'],
      manifest: {
        name: 'ForgeraAI',
        short_name: 'ForgeraAI',
        description: 'Inventory Intelligence — Hardware distribution management system',
        start_url: '/',
        display: 'standalone',
        background_color: '#111111',
        theme_color: '#F97316',
        orientation: 'portrait',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,jpg,jpeg,gif,ico,woff,woff2,ttf,eot}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          // NOTE: `/api/*` (the Forgera Node API) is deliberately NOT runtime-cached.
          // Authenticated report data must never be served from the service worker
          // cache: a cached entry outlives the session (and the user), and while the
          // API was mis-routed a `200 text/html` response was cached under `api-cache`
          // — which `NetworkFirst` used to replay whenever a cold Vercel Function took
          // longer than `networkTimeoutSeconds`, surfacing in Analytics as
          // "Failed to fetch sales report — /api returned a non-JSON response".
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
})
