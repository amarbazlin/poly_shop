import { createApp } from '../server/app.js'

/**
 * Vercel Function entry point — this single function serves the whole Forgera
 * Node API (`server/app.js`) on the same origin as the SPA, under `/api/*`.
 *
 * Why: the frontend (`src/services/*`) calls the Node API for reports, alerts
 * and locations. Without a deployed API those calls fall back to
 * `http://localhost:3001`, which a hosted HTTPS page cannot reach.
 *
 * Routing: `/api/*` is sent here by an explicit rewrite in vercel.json
 * (`/api/(.*)` → `/api/[...path].js?__forgera=/$1`). The zero-config dynamic
 * route (`api/[...path].js` matching `/api/<anything>`) is NOT used, because
 * the SPA catch-all rewrite otherwise wins and answers `/api/*` with index.html.
 * The rewrite appends the original path in `__forgera`, so the exact URL is
 * restored below before Express sees it.
 *
 * Required environment variables (set in the Vercel project, no VITE_ prefix):
 *   SUPABASE_URL, SUPABASE_ANON_KEY  (SUPABASE_SERVICE_KEY optional)
 */
const app = createApp({
  // Any /api/* path the routers above do not know answers JSON. This guarantees
  // that a mis-routed request surfaces as a clear API error instead of being
  // answered with the SPA's index.html (which the browser would report as
  // "Failed to fetch … returned a non-JSON response").
  extraRoutes: (a) => a.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' })),
})

/** Key used by the vercel.json rewrite to forward the original request path. */
const FORWARDED_PATH_PARAM = '__forgera'

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default function handler(req, res) {
  const raw = req.url || '/'
  const queryIndex = raw.indexOf('?')
  const pathname = queryIndex === -1 ? raw : raw.slice(0, queryIndex)
  const params = new URLSearchParams(queryIndex === -1 ? '' : raw.slice(queryIndex + 1))

  // Path forwarded by the vercel.json rewrite, e.g. '/reports/sales'.
  const forwarded = params.get(FORWARDED_PATH_PARAM)
  params.delete(FORWARDED_PATH_PARAM)

  if (!forwarded) {
    // Reached without the routing rewrite — the request was matched by the
    // function's file path instead of /api/*. Visible in the Vercel function
    // logs to make a broken rewrite obvious.
    console.warn('[forgera-api] missing __forgera path param — is the /api/(.*) rewrite in vercel.json deployed?', raw)
  }

  // Express is mounted under '/api', so the path it observes must carry that
  // prefix — whether the platform hands us a stripped URL or the forwarded one.
  const candidate = forwarded ? safeDecode(forwarded) : pathname
  const slashPrefixed = candidate.startsWith('/') ? candidate : `/${candidate}`
  const path = slashPrefixed === '/api' || slashPrefixed.startsWith('/api/')
    ? slashPrefixed
    : `/api${slashPrefixed}`

  const query = params.toString()
  req.url = query ? `${path}?${query}` : path

  return app(req, res)
}
