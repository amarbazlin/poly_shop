import { Router } from 'express'
import { requireAuth, requireManagerRole } from '../middleware/auth.js'

const router = Router()

const LOCATION_FIELDS = 'id, name, address, phone, is_default, status, created_at'

// In-memory cache for active locations (cheap dropdown reads)
let activeCache = { data: null, expiresAt: 0 }
const CACHE_TTL_MS = 60_000

function invalidateActiveCache() {
  activeCache = { data: null, expiresAt: 0 }
}

function mapLocation(row, productCount = null) {
  const mapped = {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    is_default: row.is_default,
    status: row.status,
    created_at: row.created_at,
  }
  if (productCount !== null) mapped.product_count = productCount
  return mapped
}

async function countActiveLocations(supabase) {
  const { count, error } = await supabase
    .from('locations')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')

  if (error) throw error
  return count ?? 0
}

/** GET /api/locations — active locations for dropdowns */
router.get('/', requireAuth, async (req, res) => {
  try {
    if (activeCache.data && Date.now() < activeCache.expiresAt) {
      res.set('Cache-Control', 'private, max-age=60')
      return res.json(activeCache.data)
    }

    const { data, error } = await req.supabase
      .from('locations')
      .select(LOCATION_FIELDS)
      .eq('status', 'active')
      .order('name')

    if (error) throw error

    const payload = (data || []).map(row => mapLocation(row))
    activeCache = { data: payload, expiresAt: Date.now() + CACHE_TTL_MS }

    res.set('Cache-Control', 'private, max-age=60')
    return res.json(payload)
  } catch (err) {
    console.error('GET /api/locations:', err)
    return res.status(500).json({ error: err.message || 'Failed to fetch locations' })
  }
})

/** GET /api/locations/all — active + inactive for settings management */
router.get('/all', requireAuth, requireManagerRole, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('locations')
      .select(`${LOCATION_FIELDS}, location_stock(product_id)`)
      .order('name')

    if (error) throw error

    const payload = (data || []).map(row => {
      const productCount = new Set(
        (row.location_stock || []).map(ls => ls.product_id).filter(Boolean)
      ).size
      const { location_stock, ...rest } = row
      return mapLocation(rest, productCount)
    })

    return res.json(payload)
  } catch (err) {
    console.error('GET /api/locations/all:', err)
    return res.status(500).json({ error: err.message || 'Failed to fetch locations' })
  }
})

/** POST /api/locations — create branch */
router.post('/', requireAuth, requireManagerRole, async (req, res) => {
  const { name, address, phone } = req.body || {}

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Branch name is required' })
  }

  try {
    const { data, error } = await req.supabase
      .from('locations')
      .insert([{
        name: name.trim(),
        address: address?.trim() || null,
        phone: phone?.trim() || null,
        status: 'active',
      }])
      .select(LOCATION_FIELDS)
      .single()

    if (error) throw error

    invalidateActiveCache()
    return res.status(201).json(mapLocation(data))
  } catch (err) {
    console.error('POST /api/locations:', err)
    const message = err.code === '23505'
      ? 'A branch with this name already exists'
      : (err.message || 'Failed to create branch')
    return res.status(err.code === '23505' ? 409 : 500).json({ error: message })
  }
})

/** PATCH /api/locations/:id — edit branch */
router.patch('/:id', requireAuth, requireManagerRole, async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid location id' })
  }

  const updates = {}
  if (req.body?.name !== undefined) {
    if (!req.body.name?.trim()) {
      return res.status(400).json({ error: 'Branch name cannot be empty' })
    }
    updates.name = req.body.name.trim()
  }
  if (req.body?.address !== undefined) updates.address = req.body.address?.trim() || null
  if (req.body?.phone !== undefined) updates.phone = req.body.phone?.trim() || null

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  try {
    const { data, error } = await req.supabase
      .from('locations')
      .update(updates)
      .eq('id', id)
      .select(LOCATION_FIELDS)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Branch not found' })

    invalidateActiveCache()
    return res.json(mapLocation(data))
  } catch (err) {
    console.error('PATCH /api/locations/:id:', err)
    const message = err.code === '23505'
      ? 'A branch with this name already exists'
      : (err.message || 'Failed to update branch')
    return res.status(err.code === '23505' ? 409 : 500).json({ error: message })
  }
})

/** PATCH /api/locations/:id/deactivate — soft-delete via status flag */
router.patch('/:id/deactivate', requireAuth, requireManagerRole, async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid location id' })
  }

  try {
    const { data: existing, error: fetchError } = await req.supabase
      .from('locations')
      .select(LOCATION_FIELDS)
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Branch not found' })
    }

    if (existing.status === 'inactive') {
      return res.status(400).json({ error: 'Branch is already inactive' })
    }

    const activeCount = await countActiveLocations(req.supabase)
    if (activeCount <= 1) {
      return res.status(400).json({
        error: 'Cannot deactivate the last active branch. The system must always have at least one active location.',
      })
    }

    const { data, error } = await req.supabase
      .from('locations')
      .update({ status: 'inactive' })
      .eq('id', id)
      .select(LOCATION_FIELDS)
      .single()

    if (error) throw error

    invalidateActiveCache()
    return res.json(mapLocation(data))
  } catch (err) {
    console.error('PATCH /api/locations/:id/deactivate:', err)
    return res.status(500).json({ error: err.message || 'Failed to deactivate branch' })
  }
})

export default router
