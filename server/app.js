import express from 'express'
import cors from 'cors'
import { requireAuth } from './middleware/auth.js'
import alertsRouter from './routes/alerts.js'
import locationsRouter from './routes/locations.js'
import reportsRouter from './routes/reports.js'

/**
 * Builds the Forgera Express API app (no `listen` call).
 *
 * Used by:
 *  - `server/index.js`           → local development (`npm run dev:api`, port 3001)
 *  - `api/[...path].js`          → production, served as a Vercel Function under /api/*
 *
 * Only import routers here that are safe to bundle with the ROOT package.json
 * dependencies (the Vercel Function resolves node_modules from the project root,
 * not from `server/node_modules`). Routers that need the local-only dependency
 * set can be mounted through `extraRoutes` (see server/index.js).
 */
export function createApp({ extraRoutes } = {}) {
  const app = express()

  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'https://forgera.vercel.app',
    'https://forgera-rho.vercel.app',
  ]

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true)
      else callback(null, true) // permissive for deployed preview URLs
    },
    credentials: true,
  }))

  app.use(express.json())

  // Apply auth middleware globally to all /api routes
  // This sets req.businessId, req.supabase, req.profile for downstream route handlers
  app.use('/api', requireAuth)

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'forgera-api' })
  })

  app.use('/api/locations', locationsRouter)
  app.use('/api/alerts', alertsRouter)
  app.use('/api/reports', reportsRouter)

  // Local-only (or otherwise opt-in) routers are mounted here, before the
  // error handler, so their errors are still handled uniformly.
  if (typeof extraRoutes === 'function') extraRoutes(app)

  // Unmatched API routes must answer JSON, not Express's default HTML 404 —
  // the frontend parses every /api response with readJson().
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}

export default createApp
