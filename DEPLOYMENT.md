# Forgera — Deployment Notes

## What runs where (Vercel)

```
Browser
  ├─ /            → static SPA build (dist/, `npm run build`)
  └─ /api/*       → Vercel Function  api/[...path].js  →  server/app.js (Express)
                          └─ Supabase (reports, alerts, locations)
```

The frontend never calls `http://localhost:3001` in a production build. `src/services/apiClient.js`
resolves the API base as:

| Environment | `VITE_API_URL` set? | API base used |
| --- | --- | --- |
| `vite dev` | no | `http://localhost:3001/api` (local Express API) |
| `vite dev` | yes | the value of `VITE_API_URL` |
| production build | no | `/api` — same origin, served by `api/[...path].js` |
| production build | yes | the value of `VITE_API_URL` (API hosted elsewhere) |

An HTTPS page cannot reach `http://localhost:3001` (mixed content), which is why an
undeployed API shows up in the UI as **"Failed to fetch"**.

## Environment variables

### Vercel project settings → Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Supabase project URL (baked into the frontend at build time) |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase anon key (baked into the frontend) |
| `SUPABASE_URL` | yes | Same URL for the Function runtime (`server/lib/supabase.js`) |
| `SUPABASE_ANON_KEY` | yes | Same anon key for the Function runtime |
| `SUPABASE_SERVICE_KEY` | recommended | Service-role key; reports fall back to the anon key (and RLS) when absent |
| `VITE_AGENT_API_URL` | optional | Python agent backend (alerts engine / AI chat), e.g. `https://forgera.onrender.com` |
| `VITE_API_URL` | optional | Only set this if the Node API is hosted **outside** Vercel |

Without `SUPABASE_URL` / `SUPABASE_ANON_KEY` in Vercel, every `/api/*` request answers
`500 {"error":"Authentication failed"}` — the Supabase client cannot be created, so
`requireAuth` throws before it can even read the token. (`401 {"error":"Authentication required"}`
means the opposite problem: the API is fine, the caller sent no token.)

These values are the same ones used locally in `server/.env`.

### Local development

```bash
cp .env.example .env            # frontend vars (VITE_*)
cp server/.env.example server/.env   # API vars (SUPABASE_URL, SUPABASE_ANON_KEY)

npm run dev        # Vite dev server (http://localhost:5173)
npm run dev:api    # Express API on http://localhost:3001  ← required for reports/alerts/locations
```

## Verification after deploying

```bash
# 1. The API route must answer JSON, not the SPA index.html
curl -i https://<your-app>.vercel.app/api/health
#    → HTTP/1.1 401 {"error":"Authentication required"}      (function deployed, no token sent)

# 2. Reports endpoint must be routed (401 = auth, not 404/HTML)
curl -i "https://<your-app>.vercel.app/api/reports/sales?format=json"
```

Sign in to the app and open **Analytics**; the Sales/Inventory/Supplier/Purchase tabs should load.

## Notes & constraints

- `server/app.js` is the shared Express app; `server/index.js` only adds `listen()` plus the
  local-only `/api/purchase-orders` router (`server/routes/purchaseOrders.js` uses the v5
  `jspdf-autotable` API that only exists in `server/node_modules`). No frontend service calls
  `/api/purchase-orders`, so nothing is lost in production.
- The Function bundles the **root** `package.json` dependencies (`express`, `cors`, `exceljs`,
  `jspdf`, `jspdf-autotable`, `@supabase/supabase-js`) — Vercel does not install `server/node_modules`.
- `maxDuration` for `api/**/*.js` is 60s (`vercel.json`). Large report exports may need more on
  paid plans; lower it if the plan rejects 60.
- Vercel evaluates requests in this order:
  **Firewall → redirects → rewrites (project) → file system routes (functions, static files)**.
  Rewrites run *before* file system routes, and the SPA fallback is a rewrite — so a plain
  `/(.*) → /index.html` catch-all swallows `/api/*` and answers it with `index.html`.
  That is the root cause of the original *"Failed to fetch"* / *"returned a non-JSON
  response"* errors, and why `/api/*` is routed by an explicit, higher-priority rewrite.
- `vercel.json` rewrites (order matters — first match wins):

  ```json
  [
    { "source": "/api/(.*)",             "destination": "/api/[...path].js?__forgera=/$1" },
    { "source": "/((?!api/)(?!api$).*)", "destination": "/index.html" }
  ]
  ```

  Rule 1 is the only way `/api/*` reaches the function: on this project the zero-config
  dynamic route (`api/[...path].js` matching `/api/<anything>`) is **not** expanded —
  only the literal path `/api/[...path].js` reaches it. Rule 1 therefore hands the
  function the client's real path in `__forgera` (Vercel keeps the incoming query string
  and appends it, so `?format=json` still arrives), and `api/[...path].js` strips that
  parameter and restores `req.url` before calling Express.
  Rule 2's negative lookaheads keep `/api` and `/api/*` out of the SPA fallback, so nothing
  can shadow the API again. Do not "simplify" these back to a single `/(.*)` rewrite.
- Gotcha: **Vercel rejects capturing groups inside a source regex group** —
  `/((?!api($|/)).*)` fails the build config with `Capturing groups are not allowed`.
  Use sibling lookaheads (`(?!api/)(?!api$)`) instead of a nested group.
- Validate any `vercel.json` change before pushing (this is the compiler Vercel runs):

  ```bash
  npm i --no-save @vercel/routing-utils
  node -e "const{convertRewrites}=require('@vercel/routing-utils');\
  console.log(convertRewrites(require('./vercel.json').rewrites))"
  # → [{ src: '^\\/api(?:\\/(.*))$', dest: '/api/[...path].js?__forgera=%2F$1', check: true }, …]
  ```
- Anything that changes routing (`vercel.json`, `api/`, `server/app.js`) requires a
  **new deployment** — the routing table is built at build time.

## Troubleshooting

**"Failed to load sales report / Failed to fetch" or "returned a non-JSON response"**

```bash
curl -si https://<your-app>.vercel.app/api/health | head -1        # want: HTTP/2 401
curl -si https://<your-app>.vercel.app/api/health | grep -i content-type  # want: application/json
```

| Result | Meaning |
| --- | --- |
| `401` + `application/json` | Correct — the API is reachable and the route works; sign in and retry |
| `401` + `ok:false` / `"Invalid or expired session"` | Token rejected — sign out and back in |
| `200` + `text/html` | Rewrites run before file system routes: the `/api/(.*)` rewrite is missing from the deployed `vercel.json` (or the function is not in the deployment) |
| `404` + `{"error":"Not found"}` | Function reached, but the path is not one of the Express routers in `server/app.js` |
| `500` + `{"error":"Authentication failed"}` | `SUPABASE_URL` / `SUPABASE_ANON_KEY` are not set in the Vercel project |
| `500` + `FUNCTION_INVOCATION_FAILED` | The function crashed on boot — usually a missing root dependency; check the Vercel function logs |

**The error text looks like an older build / the page keeps failing after a fix**

`vite-plugin-pwa` used to runtime-cache `/api/*` (`NetworkFirst`, cache `api-cache`, 5s
network timeout). While the API was mis-routed that cache stored `200 text/html`
responses, so any request slower than the timeout (cold Vercel Function) was answered
from the cache and the UI reported "returned a non-JSON response". `/api/*` is no longer
cached by the service worker (`vite.config.js`), so `sw.js` changes on every build.

A browser still showing the old wording is running a cached bundle:

1. DevTools → Application → Service Workers → *Update on reload* (or *Unregister*), then
   hard-reload (`Cmd/Ctrl + Shift + R`).
2. Compare what is deployed with what the browser ran:
   `curl -s https://<your-app>.vercel.app/ | grep -o 'assets/index-[^"]*\.js'` → check the
   Network tab for the same file name.

