import { supabase } from './supabase'
import { API_URL, authHeaders, readJson } from './apiClient'

const buildQuery = (params = {}) => {
  const query = new URLSearchParams()
  if (params.resolved !== undefined) query.set('resolved', String(params.resolved))
  if (params.type) query.set('type', Array.isArray(params.type) ? params.type.join(',') : params.type)
  if (params.severity) query.set('severity', Array.isArray(params.severity) ? params.severity.join(',') : params.severity)
  if (params.start_date) query.set('start_date', params.start_date)
  if (params.end_date) query.set('end_date', params.end_date)
  if (params.limit) query.set('limit', String(params.limit))
  if (params.business_id) query.set('business_id', String(params.business_id))
  return query.toString()
}

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    headers: await authHeaders(),
    ...options,
  })

  return readJson(response, `Alert request failed for ${path}`)
}

// Fallback: query Supabase directly (RLS-scoped) when the Node API is
// unreachable, so the Dashboard/Alerts keep working without the server.
const directQuery = async (params = {}) => {
  let query = supabase
    .from('alerts')
    .select(`
      id, product_id, related_purchase_order_id, alert_type, message,
      severity, resolved, created_at,
      products ( id, product_name, product_code, quantity, reorder_level )
    `)
    .order('created_at', { ascending: false })

  if (params.resolved !== undefined) query = query.eq('resolved', params.resolved)
  if (params.type) {
    const types = Array.isArray(params.type) ? params.type : String(params.type).split(',')
    query = query.in('alert_type', types)
  }
  if (params.severity) {
    const severities = Array.isArray(params.severity) ? params.severity : String(params.severity).split(',')
    query = query.in('severity', severities)
  }
  if (params.start_date) query = query.gte('created_at', params.start_date)
  if (params.end_date) query = query.lte('created_at', `${params.end_date}T23:59:59.999Z`)
  if (params.business_id) query = query.eq('business_id', params.business_id)
  query = query.limit(Number(params.limit) || 50)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export const alertsService = {
  getAll: async (params = {}) => {
    try {
      const query = buildQuery(params)
      const json = await fetchJson(`/alerts${query ? `?${query}` : ''}`)
      return json.data || []
    } catch (err) {
      // Any API failure (server down, 5xx, bad filter) → fall back to a
      // direct RLS-scoped Supabase read so the UI keeps working.
      try {
        return await directQuery(params)
      } catch (fallbackErr) {
        throw err
      }
    }
  },

  getUnresolvedCount: async (params = {}) => {
    try {
      const query = buildQuery(params)
      const json = await fetchJson(`/alerts/count${query ? `?${query}` : ''}`)
      return json.count || 0
    } catch (err) {
      const { count, error } = await supabase
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .eq('resolved', false)
      if (error) throw error
      return count || 0
    }
  },

  resolve: async (id, params = {}) => {
    const query = buildQuery(params)
    await fetchJson(`/alerts/${id}${query ? `?${query}` : ''}`, { method: 'PATCH' })
  },

  resolveAll: async (params = {}) => {
    const query = buildQuery(params)
    await fetchJson(`/alerts/resolve-all${query ? `?${query}` : ''}`, { method: 'POST' })
  },

  // Runs the unified alert engine (Python backend) — recomputes low stock,
  // stockouts, dead stock and late deliveries, then upserts/resolves alerts.
  runCheck: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const base = import.meta.env.VITE_AGENT_API_URL || 'http://localhost:8000'
    const response = await fetch(`${base}/api/agent/generate-alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!response.ok) {
      let message = 'Alert engine failed'
      try {
        const error = await response.json()
        message = error.detail || message
      } catch (_) {}
      throw new Error(message)
    }
    return response.json()
  },
}

export default alertsService
