import { supabase } from './supabase'
import { inventoryIntelligenceService } from './inventoryIntelligenceService'
import { DEFAULT_BUSINESS_ID } from '../utils/constants'

// PostgREST caps every response at the project's "max rows" setting (1000 by
// default), so one unbounded select silently truncates the catalogue — which
// would also blind the in-memory search in `src/utils/search.js`. Page through
// until a short page comes back instead.
const PAGE_SIZE = 1000
const MAX_PAGES = 50 // runaway guard: 50 000 products

// `or=(a.ilike.x,b.ilike.x)` is a PostgREST expression: `,` separates the
// branches while `(`, `)` and `*` group them, so a user typing one of those
// used to make the whole query fail with "failed to parse logic tree". Remove
// them, and escape the LIKE wildcards so the typed text matches literally.
const sanitizeSearchTerm = (term) =>
  String(term).replace(/[,()*]/g, ' ').replace(/([\\%_])/g, '\\$1')

export const productService = {
  // Get all products with category and supplier
  getAll: async ({ search = '', category_id = null, status = null, from = null, to = null, dateField = 'created_at', businessId = null } = {}) => {
    // A fresh builder per page — a supabase query object cannot be re-run.
    const buildQuery = () => {
      let query = supabase
        .from('products')
        .select(`
          *,
          categories ( id, name ),
          suppliers ( id, supplier_name )
        `)
        .order('created_at', { ascending: false })
        // Stable tie-breaker: paging on a non-unique column can otherwise
        // repeat or skip rows between pages.
        .order('id', { ascending: false })

      if (businessId) query = query.eq('business_id', businessId)
      if (search) {
        const term = sanitizeSearchTerm(search).trim()
        if (term) query = query.or(`product_name.ilike.%${term}%,product_code.ilike.%${term}%`)
      }
      if (category_id) query = query.eq('category_id', category_id)
      if (status) query = query.eq('status', status)
      if (from && dateField === 'created_at') query = query.gte('created_at', from)
      if (to && dateField === 'created_at')   query = query.lte('created_at', to)
      if (from && dateField === 'last_restocked') query = query.gte('last_restocked', from)
      if (to && dateField === 'last_restocked')   query = query.lte('last_restocked', to)

      return query
    }

    const all = []
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const offset = page * PAGE_SIZE
      const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
      if (error) throw error

      const rows = data || []
      all.push(...rows)
      if (rows.length < PAGE_SIZE) return all
    }

    console.warn(
      `[productService] stopped paging at ${MAX_PAGES * PAGE_SIZE} products — ` +
      'the catalogue is larger than one load can cover.',
    )
    return all
  },

  // Get single product
  getById: async (id) => {
    const { data, error } = await supabase
      .from('products')
      .select(`*, categories ( id, name ), suppliers ( id, supplier_name )`)
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  // Create product
  create: async (product) => {
    // Defence in depth: the caller must already send a business_id (see
    // AddProduct), but any writer that forgets it would create an invisible
    // row — the Inventory list is filtered by business_id. Never send NULL.
    const payload = { ...product, business_id: product?.business_id ?? DEFAULT_BUSINESS_ID }
    const { data, error } = await supabase
      .from('products')
      .insert([payload])
      .select()
      .single()
    if (error) throw error
    return data
  },

  // Update product
  update: async (id, updates) => {
    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  // Delete (soft delete by setting status to inactive)
  delete: async (id) => {
    const { error } = await supabase
      .from('products')
      .update({ status: 'inactive' })
      .eq('id', id)
    if (error) throw error
  },

  // Get low stock products
  getLowStock: async (businessId = null) => {
    let query = supabase
      .from('products')
      .select(`*, categories ( name ), suppliers ( supplier_name )`)
      .lte('quantity', supabase.raw('reorder_level'))
      .eq('status', 'active')
      .order('quantity', { ascending: true })

    if (businessId) query = query.eq('business_id', businessId)

    const { data, error } = await query
    if (error) throw error
    return data
  },

  // Get products below reorder level using RPC or manual filter
  getBelowReorder: async (businessId = null) => {
    let query = supabase
      .from('products')
      .select(`
        *,
        categories ( name ),
        suppliers ( id, supplier_name, phone )
      `)
      .eq('status', 'active')

    if (businessId) query = query.eq('business_id', businessId)

    const { data, error } = await query
    if (error) throw error

    return (data || []).filter(p => p.quantity <= p.reorder_level)
  },

  // ── Get critical stock using the shared reorder urgency rules ──────────────
  getCriticalStock: async (businessId = null) => {
    return inventoryIntelligenceService.getReorderAnalysis({ days: 30, urgency: 'critical', businessId })
  },

  // ── Get slow-moving products (no sales in last N days) ──────────────────────
  getSlowMoving: async (days = 30, businessId = null) => {
    const from = new Date()
    from.setDate(from.getDate() - days)

    const { data: soldProductIds } = await supabase
      .from('sales_items')
      .select('product_id, sale:sale_id!inner(created_at)')
      .gte('sale.created_at', from.toISOString())

    const activeIds = new Set((soldProductIds || []).map(i => i.product_id).filter(Boolean))

    let query = supabase
      .from('products')
      .select(`
        *,
        categories(name),
        suppliers(supplier_name)
      `)
      .eq('status', 'active')
      .gt('quantity', 0)

    if (businessId) query = query.eq('business_id', businessId)

    const { data, error } = await query
    if (error) throw error

    return (data || []).filter(p => !activeIds.has(p.id))
  },

  // ── Get total inventory value at cost ───────────────────────────────────────
  getInventoryValue: async (businessId = null) => {
    let query = supabase
      .from('products')
      .select('quantity, cost_price')
      .eq('status', 'active')

    if (businessId) query = query.eq('business_id', businessId)

    const { data, error } = await query
    if (error) throw error

    const totalValue = (data || []).reduce(
      (sum, p) => sum + (parseFloat(p.quantity || 0) * parseFloat(p.cost_price || 0)),
      0
    )
    const totalUnits = (data || []).reduce((sum, p) => sum + parseFloat(p.quantity || 0), 0)
    return { totalValue, totalUnits, productCount: (data || []).length }
  },

  // Get dead stock (never sold)
  getDeadStock: async (businessId = null) => {
    let query = supabase
      .from('products')
      .select(`
        *,
        categories ( name ),
        sales_items ( id )
      `)
      .eq('status', 'active')

    if (businessId) query = query.eq('business_id', businessId)

    const { data, error } = await query
    if (error) throw error
    return (data || []).filter(p => !p.sales_items || p.sales_items.length === 0)
  },

  // Adjust stock
  adjustStock: async (productId, quantity, type, notes = '') => {
    const product = await productService.getById(productId)
    const previousStock = product.quantity
    const newStock = Math.max(0, previousStock + quantity)

    const { error: txError } = await supabase
      .from('inventory_transactions')
      .insert([{
        product_id: productId,
        transaction_type: type,
        quantity,
        previous_stock: previousStock,
        new_stock: newStock,
        notes,
      }])
    if (txError) throw txError

    const { data, error } = await supabase
      .from('products')
      .update({ quantity: newStock })
      .eq('id', productId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  // Get all categories
  getCategories: async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('name')
    if (error) throw error
    return data
  },

  // Create category
  createCategory: async (name, description = '') => {
    const { data, error } = await supabase
      .from('categories')
      .insert([{ name, description }])
      .select()
      .single()
    if (error) throw error
    return data
  },

  // Get inventory transactions for a product
  getTransactions: async (productId) => {
    const { data, error } = await supabase
      .from('inventory_transactions')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return data
  },

  // Dashboard summary
  getSummary: async (businessId = null) => {
    let query = supabase
      .from('products')
      .select('quantity, cost_price, selling_price, reorder_level, status')

    if (businessId) query = query.eq('business_id', businessId)

    const { data, error } = await query
    if (error) throw error

    const active = (data || []).filter(p => p.status === 'active')
    const totalValue = active.reduce((s, p) => s + p.quantity * p.cost_price, 0)
    const lowStock = active.filter(p => p.quantity <= p.reorder_level).length
    const outOfStock = active.filter(p => p.quantity === 0).length

    return {
      totalProducts: active.length,
      totalStockValue: totalValue,
      lowStockCount: lowStock,
      outOfStockCount: outOfStock,
    }
  },
}

export default productService