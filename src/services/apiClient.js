import { supabase } from './supabase'

/**
 * Base URL of the Forgera Node API (Express app in `server/`).
 *
 * Resolution order:
 *  1. `VITE_API_URL`   — set this when the API is hosted separately, e.g.
 *                        `https://forgera-api.onrender.com/api`.
 *  2. Dev builds       — the local API (`npm run dev:api`, port 3001).
 *  3. Production builds — same-origin `/api`, served by the Vercel Function in
 *                        `api/[...path].js` of this repo.
 *
 * A production build must NEVER fall back to `http://localhost:3001`: an HTTPS
 * page cannot call it (mixed content), and the browser only reports the
 * unhelpful "Failed to fetch".
 */
const configured = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')

export const API_URL = configured || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api')

/** API origin without the trailing `/api` (for callers that build their own paths). */
export const API_ROOT = API_URL.replace(/\/api$/, '')

export async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token || ''
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }
}

/**
 * Reads a JSON body from an API response, throwing a readable error otherwise.
 *
 * Also covers the "the request never reached the API" case — e.g. the static
 * host answers with index.html — so the UI shows an actionable message instead
 * of a bare SyntaxError/"Failed to fetch".
 */
export async function readJson(response, fallbackMessage = 'Request failed') {
  const text = await response.text()

  let payload = null
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = null }
  }

  if (!response.ok) {
    const message = payload?.error || payload?.detail || `${fallbackMessage} (HTTP ${response.status})`
    throw new Error(message)
  }

  if (payload === null) {
    // The request reached a server, but not the Forgera API (a static host
    // answering HTML, or a proxy). Report what actually came back.
    const type = response.headers.get('content-type') || 'unknown type'
    throw new Error(
      `${fallbackMessage} — ${API_URL} returned a non-JSON response ` +
      `(HTTP ${response.status}, ${type}). The Forgera API is not reachable from this ` +
      'deployment: on Vercel, /api/* is routed to the function api/[...path].js by the ' +
      'rewrites in vercel.json, so redeploy after changing vercel.json and make sure ' +
      'SUPABASE_URL / SUPABASE_ANON_KEY are set in the project. For a separately hosted ' +
      'API, set VITE_API_URL to it.'
    )
  }

  return payload
}
