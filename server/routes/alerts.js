import express from 'express'
import { createUserClient, getServiceClient } from '../lib/supabase.js'

const router = express.Router()

const getSupabase = (req) => {
  const token = req.headers.authorization?.split(' ')[1] || ''
  return token ? createUserClient(token) : getServiceClient()
}

const normalizeList = (value) => {
  if (!value) return []
  if (Array.isArray(value)) return value
  return String(value).split(',').map(item => item.trim()).filter(Boolean)
}

const severityRank = { critical: 4, high: 3, medium: 2, low: 1 }

const applyFilters = (query, req) => {
  const { resolved, type, severity, start_date, end_date, limit = 50 } = req.query
  const types = normalizeList(type)
  const severities = normalizeList(severity)

  // NOTE: the alerts table has no business_id column (single-business
  // deployment, RLS grants all authenticated users read access), so we must
  // NOT filter on req.businessId here — doing so makes the query fail with a
  // column-not-found error and breaks the whole Alerts page.
  if (resolved !== undefined) query = query.eq('resolved', resolved === 'true')
  if (types.length > 0) query = query.in('alert_type', types)
  if (severities.length > 0) query = query.in('severity', severities)
  if (start_date) query = query.gte('created_at', start_date)
  if (end_date) query = query.lte('created_at', `${end_date}T23:59:59.999Z`)

  return query.limit(Number(limit) || 50)
}

router.get('/', async (req, res) => {
  const supabase = getSupabase(req)

  try {
    let query = supabase
      .from('alerts')
      .select(`
        id,
        product_id,
        related_purchase_order_id,
        alert_type,
        message,
        severity,
        resolved,
        created_at,
        products ( id, product_name, product_code, quantity, reorder_level ),
        purchases ( id, status, expected_delivery_date )
      `)
      .order('created_at', { ascending: false })

    query = applyFilters(query, req)

    const { data, error } = await query
    if (error) throw error

    const sorted = [...(data || [])].sort((left, right) => {
      const severityDelta = (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0)
      if (severityDelta !== 0) return severityDelta
      return new Date(right.created_at || 0) - new Date(left.created_at || 0)
    })

    res.json({ data: sorted })
  } catch (err) {
    console.error('Error fetching alerts:', err)
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:id', async (req, res) => {
  const supabase = getSupabase(req)
  const { id } = req.params

  try {
    const { error } = await supabase
      .from('alerts')
      .update({ resolved: true })
      .eq('id', id)

    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    console.error('Error resolving alert:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/resolve-all', async (req, res) => {
  const supabase = getSupabase(req)

  try {
    let query = supabase
      .from('alerts')
      .update({ resolved: true })
      .eq('resolved', false)

    const { error } = await query

    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    console.error('Error resolving all alerts:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/count', async (req, res) => {
  const supabase = getSupabase(req)

  try {
    let query = supabase
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .eq('resolved', false)

    const { count, error } = await query

    if (error) throw error
    res.json({ count: count || 0 })
  } catch (err) {
    console.error('Error counting alerts:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router