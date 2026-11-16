import { supabase } from './supabase'
import { cacheGet, cacheSet, cacheKey } from '../utils/cache'

export const SALES_LOOKBACK_DAYS = 90

export const DEFAULT_REORDER_LEVEL = 10
export const DEFAULT_SUPPLIER_LEAD_TIME_DAYS = 7
export const NO_SALES_DAYS_REMAINING = 999

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const toConfiguredPositiveNumber = (value, fallback) => {
  const number = Number(value)
  return {
    value: Number.isFinite(number) && number > 0 ? number : fallback,
    configured: Number.isFinite(number) && number > 0,
  }
}

const normalizeInventoryProduct = (product) => {
  const currentStock = toFiniteNumber(product.quantity)
  const buyingPrice = toFiniteNumber(product.cost_price)

  return {
    currentStock,
    buyingPrice,
    inventoryValue: Math.round(currentStock * buyingPrice * 100) / 100,
  }
}

const toISODateKey = (date) => date.toISOString().split('T')[0]

const buildDailySalesSeries = (salesByDate, asOf, days = 30) => {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(asOf)
    date.setDate(date.getDate() - (days - 1 - index))
    const dateKey = toISODateKey(date)

    return {
      date: dateKey,
      amount: salesByDate?.[dateKey] ?? 0,
    }
  })
}

export const classifyInventoryUrgency = ({ currentStock, daysRemaining, reorderLevel }) => {
  if (currentStock === 0 || daysRemaining <= 3) return 'critical'
  if (daysRemaining <= 7 || currentStock <= reorderLevel * 0.5) return 'high'
  if (daysRemaining <= 14 || currentStock <= reorderLevel) return 'medium'
  return 'low'
}

/**
 * Fetches sales_items data once and returns it grouped by product_id.
 * This consolidates the 3 separate queries (reorder, slow-moving, dead inventory)
 * into a single database call.
 */
async function fetchSaleItemsGroupedByProduct(fromDate) {
  const cacheKeyStr = cacheKey('sales_items', fromDate.toISOString().slice(0, 10))
  const cached = cacheGet(cacheKeyStr)
  if (cached) return cached

  const { data: allSaleItems } = await supabase
    .from('sales_items')
    .select('product_id, quantity, sale:sale_id!inner(created_at)')
    .gte('sale.created_at', fromDate.toISOString())

  // Group by product_id, then by date
  const salesByProductDate = {}
  const soldProductIds = new Set()

  for (const row of allSaleItems || []) {
    const pid = row.product_id
    if (!pid) continue
    const sale = row.sale || {}
    const created = sale.created_at
    if (!created) continue
    const dateKey = created.slice(0, 10)
    if (!salesByProductDate[pid]) salesByProductDate[pid] = {}
    salesByProductDate[pid][dateKey] = (salesByProductDate[pid][dateKey] || 0) + (Number(row.quantity) || 0)
    soldProductIds.add(pid)
  }

  const result = { salesByProductDate, soldProductIds }
  cacheSet(cacheKeyStr, result, 5 * 60 * 1000) // 5 min TTL
  return result
}

export const inventoryIntelligenceService = {
  // ── Get reorder analysis ────────────────────────────────────────────────────
  getReorderAnalysis: async ({ days = 30, urgency = null, category = null, sort = 'priority', businessId = null, page = null, pageSize = 200 } = {}) => {
    const asOf = new Date()
    const salesFromDate = new Date()
    salesFromDate.setDate(salesFromDate.getDate() - Math.max(days, SALES_LOOKBACK_DAYS))

    // Fetch active products with category and supplier
    let prodQuery = supabase
      .from('products')
      .select(`
        *,
        categories(name),
        suppliers(supplier_name, average_delivery_days)
      `, { count: 'exact' })
      .eq('status', 'active')
      .order('product_name')

    if (businessId) prodQuery = prodQuery.eq('business_id', businessId)

    // Apply pagination if requested
    if (page !== null && pageSize) {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      prodQuery = prodQuery.range(from, to)
    }

    const { data: products, error: prodError, count: totalCount } = await prodQuery

    if (prodError) throw prodError

    // Use consolidated sales_items fetch over the lookback window to derive
    // historical average daily sales (no demand forecasting — decisions are
    // based on actual recent sales velocity)
    const lookbackDays = Math.max(days, SALES_LOOKBACK_DAYS)
    const salesByProductDate = await (async () => {
      const { salesByProductDate: byDate } = await fetchSaleItemsGroupedByProduct(salesFromDate)
      return byDate
    })()

    // Calculate metrics for each product
    const analysis = (products || []).map(p => {
      const productSalesByDate = salesByProductDate[p.id] || {}
      const totalSold = Object.values(productSalesByDate).reduce((sum, qty) => sum + qty, 0)
      const avgDailySales = totalSold / lookbackDays
      const currentStock = toFiniteNumber(p.quantity)
      const reorderLevelConfig = toConfiguredPositiveNumber(p.reorder_level, DEFAULT_REORDER_LEVEL)
      const reorderLevel = reorderLevelConfig.value
      const buyingPrice = toFiniteNumber(p.cost_price)
      const sellingPrice = toFiniteNumber(p.selling_price)
      const leadTimeConfig = toConfiguredPositiveNumber(
        p.suppliers?.average_delivery_days,
        DEFAULT_SUPPLIER_LEAD_TIME_DAYS
      )
      const leadTime = leadTimeConfig.value

      // Days remaining
      const daysRemaining = avgDailySales > 0 ? currentStock / avgDailySales : NO_SALES_DAYS_REMAINING

      // Urgency classification
      const urgencyLevel = classifyInventoryUrgency({ currentStock, daysRemaining, reorderLevel })

      // Suggested reorder quantity
      const safetyStock = reorderLevel * 0.5
      const suggestedQty = Math.max(
        reorderLevel,
        Math.ceil((avgDailySales * leadTime) + safetyStock - currentStock)
      )

      // Priority score (higher = more urgent)
      const priorityScore = daysRemaining > 0 ? (1 / daysRemaining) * 100 : 1000

      // Revenue risk
      const revenueRisk = avgDailySales * leadTime * sellingPrice
      const noSalesWarning = totalSold === 0
        ? `No sales in last ${lookbackDays} days — reorder qty based on configured reorder level only`
        : null

      // Expected stockout date
      const stockoutDate = avgDailySales > 0 ? new Date() : null
      if (stockoutDate) stockoutDate.setDate(stockoutDate.getDate() + Math.ceil(daysRemaining))

      // Build 30-day actual sales timeseries for chart
      const salesHistory30Days = buildDailySalesSeries(productSalesByDate, asOf, 30)

      return {
        id: p.id,
        product_name: p.product_name,
        product_code: p.product_code,
        category: p.categories?.name || 'Uncategorized',
        current_stock: currentStock,
        reorder_level: reorderLevel,
        avg_daily_sales: Math.round(avgDailySales * 100) / 100,
        days_remaining: Math.round(daysRemaining * 100) / 100,
        expected_stockout: stockoutDate ? stockoutDate.toISOString().split('T')[0] : null,
        suggested_qty: suggestedQty,
        cost_price: buyingPrice,
        selling_price: sellingPrice,
        supplier: p.suppliers?.supplier_name || '—',
        lead_time_days: leadTime,
        lead_time_configured: leadTimeConfig.configured,
        lead_time_warning: leadTimeConfig.configured
          ? null
          : `Lead time not set — using default ${DEFAULT_SUPPLIER_LEAD_TIME_DAYS} days`,
        reorder_level_configured: reorderLevelConfig.configured,
        reorder_level_warning: reorderLevelConfig.configured
          ? null
          : `Reorder level not configured — using default ${DEFAULT_REORDER_LEVEL}`,
        urgency: urgencyLevel,
        sales_history_30_days: salesHistory30Days,
        no_sales_warning: noSalesWarning,
        priority_score: Math.round(priorityScore * 100) / 100,
        revenue_risk: Math.round(revenueRisk * 100) / 100,
        estimated_cost: Math.round(suggestedQty * buyingPrice * 100) / 100,
      }
    })

    // Apply filters
    let filtered = analysis
    if (urgency) {
      filtered = filtered.filter(item => item.urgency === urgency)
    }
    if (category) {
      filtered = filtered.filter(item => item.category === category)
    }

    // Apply sorting
    filtered.sort((a, b) => {
      if (sort === 'priority') return b.priority_score - a.priority_score
      if (sort === 'days') return a.days_remaining - b.days_remaining
      if (sort === 'stock') return a.current_stock - b.current_stock
      return 0
    })

    return filtered
  },

  // ── Get risk metrics for KPI cards ─────────────────────────────────────────
  // FIXED: Now accepts pre-computed analysis data to avoid re-fetching
  getRiskMetrics: async (days = 30, businessId = null, precomputedAnalysis = null) => {
    // Use pre-computed analysis if provided, otherwise fetch
    const analysis = precomputedAnalysis || await inventoryIntelligenceService.getReorderAnalysis({ days, businessId })

    const critical = analysis.filter(a => a.urgency === 'critical')
    const high = analysis.filter(a => a.urgency === 'high')

    // Inventory risk value: revenue at risk from products stocking out within 7 days
    const riskValue = analysis
      .filter(a => a.days_remaining <= 7)
      .reduce((sum, a) => sum + a.revenue_risk, 0)

    // Estimated reorder cost
    const reorderCost = analysis
      .filter(a => a.urgency === 'critical' || a.urgency === 'high')
      .reduce((sum, a) => sum + a.estimated_cost, 0)

    // Dead inventory (no sales in 90 days)
    const deadInventory = precomputedAnalysis
      ? analysis.filter(a => a.avg_daily_sales === 0 && a.current_stock > 0)
      : await inventoryIntelligenceService.getDeadInventoryProducts(businessId)
    const deadInventoryValue = deadInventory.reduce((sum, p) => sum + p.inventory_value, 0)

    return {
      riskValue: Math.round(riskValue * 100) / 100,
      criticalCount: critical.length,
      highCount: high.length,
      reorderCost: Math.round(reorderCost * 100) / 100,
      deadInventoryValue: Math.round(deadInventoryValue * 100) / 100,
      deadInventoryCount: deadInventory.length,
    }
  },

  // ── Get slow moving products (no sales in X days) ─────────────────────────
  getSlowMovingProducts: async (days = 30, businessId = null) => {
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - days)

    // Use consolidated sales_items fetch
    const { soldProductIds } = await fetchSaleItemsGroupedByProduct(fromDate)

    // Get all active products with stock
    let query = supabase
      .from('products')
      .select(`
        *,
        categories(name),
        suppliers(supplier_name)
      `)
      .eq('status', 'active')
      .gt('quantity', 0)
      .order('product_name')

    if (businessId) query = query.eq('business_id', businessId)

    const { data: products, error } = await query

    if (error) throw error

    // Filter out recently sold products
    const slowMoving = (products || []).filter(p => !soldProductIds.has(p.id))

    // Calculate days since last sale from inventory_transactions
    return slowMoving.map(p => {
      const { currentStock, buyingPrice, inventoryValue } = normalizeInventoryProduct(p)

      return {
        id: p.id,
        product_name: p.product_name,
        product_code: p.product_code,
        category: p.categories?.name || 'Uncategorized',
        current_stock: currentStock,
        quantity: currentStock,
        inventory_value: Math.round(inventoryValue * 100) / 100,
        cost_price: buyingPrice,
        supplier: p.suppliers?.supplier_name || '—',
        last_sale_date: null, // Would need separate query for exact date
        days_since_last_sale: days, // At least X days
      }
    })
  },

  // ── Get dead inventory (no sales in 90+ days) ──────────────────────────────
  getDeadInventoryProducts: async (businessId = null) => {
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - 90)

    // Use consolidated sales_items fetch
    const { soldProductIds } = await fetchSaleItemsGroupedByProduct(fromDate)

    // Get all active products
    let query = supabase
      .from('products')
      .select(`
        *,
        categories(name),
        suppliers(supplier_name)
      `)
      .eq('status', 'active')
      .gt('quantity', 0)
      .order('product_name')

    if (businessId) query = query.eq('business_id', businessId)

    const { data: products, error } = await query

    if (error) throw error

    // Filter to only dead inventory
    const deadInventory = (products || []).filter(p => !soldProductIds.has(p.id))

    return deadInventory.map(p => {
      const { currentStock, buyingPrice, inventoryValue } = normalizeInventoryProduct(p)

      return {
        id: p.id,
        product_name: p.product_name,
        product_code: p.product_code,
        category: p.categories?.name || 'Uncategorized',
        current_stock: currentStock,
        quantity: currentStock,
        inventory_value: Math.round(inventoryValue * 100) / 100,
        cost_price: buyingPrice,
        supplier: p.suppliers?.supplier_name || '—',
        days_without_sales: 90, // At least 90 days
      }
    })
  },

  // ── Get categories for filter ──────────────────────────────────────────────
  getCategories: async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name')
      .order('name')

    if (error) throw error
    return data || []
  },
}

export default inventoryIntelligenceService