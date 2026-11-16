import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment')
}

/** Supabase client scoped to the authenticated user's JWT (RLS applies). */
export function createUserClient(accessToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Service-role client that bypasses RLS.
 * Used for report generation and other admin-level operations.
 */
let serviceClient = null
export function getServiceClient() {
  if (!serviceClient) {
    if (!supabaseServiceKey) {
      // Fallback to anon key if no service key configured
      console.warn('SUPABASE_SERVICE_KEY not set, falling back to anon key — RLS may block some queries')
      serviceClient = createClient(supabaseUrl, supabaseAnonKey)
    } else {
      serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    }
  }
  return serviceClient
}

export default createUserClient
