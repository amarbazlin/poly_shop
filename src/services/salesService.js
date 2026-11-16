import { supabase } from './supabase'
import { generateInvoiceNumber } from '../utils/formatters'

// ── Revenue & profit recognition helpers ──────────────────────────────────────
// Revenue AND profit are recognised on the day the money actually comes in:
//   • Cash / card / bank / cheque sales → the sale date (created_at)
//   • Credit sales                      → the day they are marked paid (paid_at)
//   • Unpaid credit sales               → not recognised yet (excluded from
//                                          revenue and profit totals alike)
// Profit for one whole sale — used by the summary stats AND the Sales table's
// per-row profit column so both always agree.
//
// Net of the sale-level discount: sales.total_amount is already
// (line subtotal − discount_amount), so the discount must come off the gross
// line profit too. Otherwise every margin % — profit ÷ sale total — is
// overstated by exactly discount ÷ revenue, which is what made the Sales page
// percentages disagree with manual math on discounted / tier-priced sales.
// Line-level pricing (price tiers, customer overrides) is already baked into
// sales_items.unit_price when the sale is created, so it needs no adjustment.
export const itemProfit = (sale) => {
  const grossLineProfit = (sale.sales_items || []).reduce(
    (sum, item) =>
      sum + ((Number(item.unit_price) || 0) - (Number(item.cost_price) || 0)) * (Number(item.quantity) || 0),
    0,
  )
  return grossLineProfit - (Number(sale.discount_amount) || 0)
}

/** The date a sale's revenue/profit is recognised, or null while a credit sale is unpaid. */
const recognizedDateOf = (sale) => sale.paid_at || (sale.is_credit ? null : sale.created_at)

/** True when `value` (ISO timestamp) falls inside the [from, to) window. */
const inWindow = (value, from, to) => {
  if (!value) return false
  const d = new Date(value)
  return d >= from && d < to
}

/**
 * Sales touched by the window [from, to): sales made inside it plus credit
 * sales marked paid inside it (even when they were sold on an earlier day).
 */
const SALES_WINDOW_SELECT = 'id, total_amount, discount_amount, created_at, paid_at, is_credit, sales_items(unit_price, cost_price, quantity)'

const isMissingPaidAt = (error) => /paid_at/.test(String(error?.message || ''))

/**
 * Sales touched by the window [from, to): sales made inside it plus credit
 * sales marked paid inside it (even when they were sold on an earlier day).
 *
 * `select` must include `id` (rows from both queries are merged by id); it may
 * omit `paid_at` — the legacy fallback below strips it automatically.
 */
const fetchSalesInWindow = async (from, to, businessId = null, select = SALES_WINDOW_SELECT) => {
  const windowQuery = (column, sel) => {
    let q = supabase
      .from('sales')
      .select(sel)
      .gte(column, from.toISOString())
      .lt(column, to.toISOString())
    if (businessId) q = q.eq('business_id', businessId)
    return q
  }

  const [created, paid] = await Promise.all([
    windowQuery('created_at', select),
    windowQuery('paid_at', select),
  ])

  // sales.paid_at ships with migration 0012_sales_paid_at.sql. Until that SQL is
  // applied, keep the previous behaviour (revenue & profit on the sale date) so
  // the Sales page and dashboard keep loading instead of erroring out.
  if (isMissingPaidAt(created.error) || isMissingPaidAt(paid.error)) {
    console.warn(
      '[salesService] sales.paid_at is missing — run migrations/0012_sales_paid_at.sql. ' +
      'Falling back to sale-date revenue/profit recognition.',
    )
    const legacySelect = select.split(',').map(s => s.trim()).filter(s => s !== 'paid_at').join(', ')
    const { data, error } = await windowQuery('created_at', legacySelect)
    if (error) throw error
    return (data || []).map(sale => ({ ...sale, paid_at: sale.created_at }))
  }

  if (created.error) throw created.error
  if (paid.error) throw paid.error

  // De-duplicate sales that match both queries (paid on the day they were made)
  const byId = new Map()
  for (const row of [...(created.data || []), ...(paid.data || [])]) byId.set(row.id, row)
  return [...byId.values()]
}

/**
 * Write an inventory_transactions row.
 *
 * `business_id` ships with a later migration; on a database that predates it,
 * fall back to the legacy non-tenant shape instead of losing the stock movement.
 */
const logInventoryTransaction = async (row) => {
  const { error } = await supabase.from('inventory_transactions').insert([row])
  if (!error) return
  if (/business_id/.test(String(error.message || ''))) {
    const { business_id, ...legacyRow } = row
    const { error: legacyErr } = await supabase.from('inventory_transactions').insert([legacyRow])
    if (legacyErr) throw legacyErr
    return
  }
  throw error
}

export const salesService = {
  // ── Get all sales ───────────────────────────────────────────────────────────
  getAll: async ({ limit = 100, from = null, to = null, businessId = null, customerId = null, paymentMethod = null } = {}) => {
    let q = supabase
      .from('sales')
      .select(`
        *,
        users(full_name),
        customers(id, name, phone),
        locations(id, name),
        sales_items(
          id, product_id, quantity, unit_price, cost_price, subtotal,
          products(id, product_name, product_code, unit)
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (businessId) q = q.eq('business_id', businessId)
    if (from) q = q.gte('created_at', from)
    if (to)   q = q.lte('created_at', to)
    if (customerId) q = q.eq('customer_id', customerId)
    if (paymentMethod) q = q.eq('payment_method', paymentMethod)

    const { data, error } = await q
    if (error) throw error
    return data
  },

  // ── Get single sale ─────────────────────────────────────────────────────────
  getById: async (id) => {
    const { data, error } = await supabase
      .from('sales')
      .select(`
        *,
        users(full_name),
        customers(id, name, phone, address),
        locations(id, name),
        sales_items(*, products(product_name, product_code, unit))
      `)
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  // ── Create sale (with customer, location, discount, credit support) ─────────
  create: async ({ items, paymentMethod, soldBy, customerId = null, locationId = null, discountAmount = 0, isCredit = false, businessId = null }) => {
    const subtotal      = items.reduce((s, i) => s + parseFloat(i.subtotal), 0)
    const total         = Math.max(0, subtotal - parseFloat(discountAmount || 0))
    const invoiceNumber = generateInvoiceNumber('INV')

    // Insert sale
    const { data: sale, error: saleErr } = await supabase
      .from('sales')
      .insert([{
        invoice_number:  invoiceNumber,
        total_amount:    total,
        payment_method:  isCredit ? 'credit' : paymentMethod,
        sold_by:         soldBy,
        customer_id:     customerId || null,
        location_id:     locationId || null,
        discount_amount: parseFloat(discountAmount || 0),
        is_credit:       isCredit,
        business_id:     businessId,
      }])
      .select()
      .single()
    if (saleErr) throw saleErr

    // Fetch current cost_price for each product to snapshot cost_price
    const productIds = items.map(i => parseInt(i.product_id))
    const { data: productsData } = await supabase
      .from('products')
      .select('id, cost_price')
      .in('id', productIds)

    const productCostMap = {}
    for (const p of productsData || []) {
      productCostMap[p.id] = Number(p.cost_price || 0)
    }

    // Insert line items with cost_price snapshot
    const saleItems = items.map(i => ({
      sale_id:    sale.id,
      product_id: parseInt(i.product_id),
      quantity:   i.quantity,
      unit_price: parseFloat(i.unit_price),
      subtotal:   parseFloat(i.subtotal),
      cost_price: productCostMap[parseInt(i.product_id)] || 0,
    }))
    const { error: itemsErr } = await supabase.from('sales_items').insert(saleItems)
    if (itemsErr) throw itemsErr

    // Deduct stock and log inventory transactions
    for (const item of items) {
      const { data: product } = await supabase
        .from('products')
        .select('quantity')
        .eq('id', item.product_id)
        .single()

      const newQty = Math.max(0, (product?.quantity || 0) - item.quantity)

      // Verified write — a 0-row update (RLS) must fail loudly, never drift.
      const { data: stockRows, error: stockErr } = await supabase
        .from('products')
        .update({ quantity: newQty })
        .eq('id', item.product_id)
        .select('id')
      if (stockErr) throw stockErr
      if (!stockRows || stockRows.length === 0) {
        throw new Error(
          `Stock for product ${item.product_id} could not be deducted ` +
          '(0 rows updated — check RLS policies and run migrations/0014_return_restock.sql).',
        )
      }

      await logInventoryTransaction({
        product_id:       parseInt(item.product_id),
        transaction_type: 'sale',
        quantity:         -item.quantity,
        previous_stock:   product?.quantity,
        new_stock:        newQty,
        reference_id:     sale.id,
        notes:            `Sale ${invoiceNumber}`,
        business_id:      businessId,
      })
    }

    return sale
  },

  // ── Dashboard summary ────────────────────────────────────────────────────────
  getSummary: async (days = 30, businessId = null) => {
    const from = new Date()
    from.setDate(from.getDate() - days)
    const to = new Date(Date.now() + 1) // now, inclusive

    const rows = await fetchSalesInWindow(
      from, to, businessId,
      'id, total_amount, created_at, paid_at, is_credit',
    )

    let total = 0
    let count = 0
    let creditTotal = 0
    for (const r of rows) {
      // Revenue lands on the day the money comes in — unpaid credit sales excluded.
      if (inWindow(recognizedDateOf(r), from, to)) {
        total += parseFloat(r.total_amount) || 0
        count += 1
      }
      // Outstanding credit issued inside the window (still unpaid).
      if (r.is_credit && inWindow(r.created_at, from, to)) {
        creditTotal += parseFloat(r.total_amount) || 0
      }
    }
    return { total, count, creditTotal, records: rows }
  },

  // ── Daily chart data ─────────────────────────────────────────────────────────
  getDailyChart: async (days = 30, businessId = null) => {
    const from = new Date()
    from.setDate(from.getDate() - days)
    const to = new Date(Date.now() + 1) // now, inclusive

    const rows = await fetchSalesInWindow(
      from, to, businessId,
      'id, total_amount, created_at, paid_at, is_credit',
    )

    const grouped = {}
    for (const s of rows) {
      const day = recognizedDateOf(s) // null → unpaid credit sale, not revenue yet
      if (!day) continue
      const key = day.slice(0, 10)
      grouped[key] = (grouped[key] || 0) + parseFloat(s.total_amount)
    }
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }))
  },

  // ── Top selling products ─────────────────────────────────────────────────────
  getTopProducts: async (limit = 10, days = null, businessId = null) => {
    const from = new Date()
    if (days) from.setDate(from.getDate() - days)

    let query = supabase
      .from('sales_items')
      .select('quantity, subtotal, products(id, product_name, product_code), sale:sale_id!inner(created_at, paid_at, is_credit)')
      .limit(500)
    if (days) query = query.gte('sale.created_at', from.toISOString())

    let { data, error } = await query
    if (error) {
      if (!isMissingPaidAt(error)) throw error
      // sales.paid_at missing (migration 0012 not applied) — count every sale
      // on its sale date, exactly as before that migration existed.
      console.warn(
        '[salesService] sales.paid_at is missing — run migrations/0012_sales_paid_at.sql. ' +
        'Top products fall back to sale-date recognition.',
      )
      let legacy = supabase
        .from('sales_items')
        .select('quantity, subtotal, products(id, product_name, product_code), sale:sale_id!inner(created_at)')
        .limit(500)
      if (days) legacy = legacy.gte('sale.created_at', from.toISOString())
      const res = await legacy
      if (res.error) throw res.error
      data = (res.data || []).map(it => ({ ...it, sale: { ...it.sale, paid_at: it.sale.created_at } }))
    }

    // Filter sales_items by business_id if needed, via product's business_id
    let filteredData = data || []
    if (businessId) {
      const { data: bizProducts } = await supabase
        .from('products')
        .select('id')
        .eq('business_id', businessId)

      const productIds = new Set((bizProducts || []).map(p => p.id))
      filteredData = filteredData.filter(item => productIds.has(item.products?.id))
    }

    const grouped = {}
    for (const item of filteredData) {
      const id = item.products?.id
      if (!id) continue
      // Unpaid credit sales are not counted — they only become revenue when paid.
      if (!recognizedDateOf(item.sale)) continue
      if (!grouped[id]) grouped[id] = { product: item.products, qty: 0, revenue: 0 }
      grouped[id].qty     += item.quantity
      grouped[id].revenue += parseFloat(item.subtotal)
    }
    return Object.values(grouped)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit)
  },

  // ── Process a return (inline from Sales page) ──────────────────────────────
  processReturn: async ({ originalSaleId, customerId, items, reason, processedBy, businessId = null }) => {
    // Only lines with a positive quantity are actually returned — the panel
    // sends every invoice line (qty 0 included), and those must never touch
    // the sale, the stock, or the customer's balance.
    const returnable = items.filter(i => (parseInt(i.quantity) || 0) > 0)
    if (returnable.length === 0) throw new Error('Select at least one item to return')

    // Fail loudly BEFORE any write if a line cannot be restocked later.
    for (const i of returnable) {
      if (!parseInt(i.product_id)) {
        throw new Error(
          `Cannot restore stock for "${i.product_name || 'item'}" — it has no product link. ` +
          'Reload the sales list and try the return again.',
        )
      }
    }

    // What the invoice legitimately sold, and what has already come back on
    // earlier returns. Needed twice: to reject an over-return, and to snapshot
    // the original cost price so the credit note reverses profit exactly.
    let originalSale = null
    const soldByProduct = {}
    const costByProduct = {}

    if (originalSaleId) {
      const [{ data: saleRow, error: saleReadErr }, { data: lines, error: linesReadErr }] = await Promise.all([
        supabase
          .from('sales')
          .select('id, total_amount, payment_method, is_credit, customer_id, location_id, business_id')
          .eq('id', originalSaleId)
          .single(),
        supabase
          .from('sales_items')
          .select('id, product_id, quantity, unit_price, cost_price')
          .eq('sale_id', originalSaleId),
      ])
      if (saleReadErr) throw saleReadErr
      if (linesReadErr) throw linesReadErr
      originalSale = saleRow

      for (const line of lines || []) {
        const pid = String(parseInt(line.product_id))
        soldByProduct[pid] = (soldByProduct[pid] || 0) + (parseInt(line.quantity) || 0)
        // First line's cost wins — cost_price is snapshotted per sale line.
        if (!(pid in costByProduct)) costByProduct[pid] = Number(line.cost_price) || 0
      }

      const { data: priorReturns, error: priorErr } = await supabase
        .from('returns')
        .select('id, return_items(product_id, quantity)')
        .eq('original_sale_id', originalSaleId)
      if (priorErr) {
        console.warn('[salesService] could not read prior returns — over-return check skipped:', priorErr.message)
      }

      const alreadyReturned = {}
      for (const r of priorReturns || []) {
        for (const it of r.return_items || []) {
          const pid = String(parseInt(it.product_id))
          alreadyReturned[pid] = (alreadyReturned[pid] || 0) + (parseInt(it.quantity) || 0)
        }
      }

      // The invoice is never shrunk any more, so the only cap on a return is
      // what was sold minus what already came back.
      for (const i of returnable) {
        const pid        = String(parseInt(i.product_id))
        const remaining  = (soldByProduct[pid] || 0) - (alreadyReturned[pid] || 0)
        const requested  = parseInt(i.quantity) || 0
        if (requested > remaining) {
          throw new Error(
            `Only ${Math.max(0, remaining)} unit(s) of "${i.product_name || 'item'}" can still be returned ` +
            `(${alreadyReturned[pid] || 0} already returned on this invoice).`,
          )
        }
      }
    }

    const total = returnable.reduce((s, i) => s + i.subtotal, 0)
    const returnNumber = `RET-${Date.now().toString().slice(-8)}`

    // Insert return record
    const { data: ret, error } = await supabase
      .from('returns')
      .insert([{
        return_number: returnNumber,
        original_sale_id: originalSaleId || null,
        customer_id: customerId || null,
        return_type: 'sale_return',
        total_amount: total,
        reason,
        processed_by: processedBy,
        business_id: businessId,
      }])
      .select()
      .single()
    if (error) throw error

    // Insert return items (checked — a silent failure here would lose track of
    // which products came back)
    const retItems = returnable.map(i => ({
      return_id: ret.id,
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      subtotal: i.subtotal,
      condition: i.condition || 'good',
    }))
    const { error: retItemsErr } = await supabase.from('return_items').insert(retItems)
    if (retItemsErr) throw retItemsErr

    // Restore stock — every returned unit goes back on the shelf. The row is
    // read back before writing so previous/new stock and the ledger stay honest.
    for (const item of returnable) {
      const productId = parseInt(item.product_id)
      const qty       = parseInt(item.quantity)

      if (!productId || !qty || qty <= 0) {
        throw new Error(
          `Cannot restore stock for "${item.product_name || 'item'}" — it has no product link. ` +
          'Reload the sales list and try the return again.',
        )
      }

      const { data: product, error: readErr } = await supabase
        .from('products')
        .select('quantity')
        .eq('id', productId)
        .single()
      if (readErr) throw readErr

      const previousStock = parseInt(product?.quantity) || 0
      const newStock      = previousStock + qty

      // Verified write — under RLS a blocked update matches 0 rows and returns
      // NO error, so we read the affected rows back and fail loudly if empty.
      const { data: stockRows, error: stockErr } = await supabase
        .from('products')
        .update({ quantity: newStock })
        .eq('id', productId)
        .select('id')
      if (stockErr) throw stockErr
      if (!stockRows || stockRows.length === 0) {
        throw new Error(
          `Stock for "${item.product_name || 'product ' + productId}" was NOT restored ` +
          '(0 rows updated — check RLS policies and run migrations/0014_return_restock.sql).',
        )
      }

      await logInventoryTransaction({
        product_id:       productId,
        transaction_type: 'return',
        quantity:         qty,
        previous_stock:   previousStock,
        new_stock:        newStock,
        reference_id:     ret.id,
        notes:            `Return ${returnNumber} - ${reason}`,
        business_id:      businessId,
      })
    }

    // If credit customer, reduce their balance
    if (customerId) {
      const { data: customer } = await supabase.from('customers').select('current_balance').eq('id', customerId).single()
      const newBalance = Math.max(0, (parseFloat(customer?.current_balance) || 0) - total)
      await supabase.from('customers').update({ current_balance: newBalance }).eq('id', customerId)
    }

    // ── Credit note (refund) ───────────────────────────────────────────────────
    // The refund is booked on the day the RETURN is processed, never on the day
    // the sale was made. The original invoice and its line items are left
    // untouched, so the sale's own day keeps its revenue/profit, while a
    // negative "credit note" sale dated today subtracts the refund from today's
    // totals (the same date the money leaves the till).
    if (originalSaleId && originalSale) {
      const originalTotal = parseFloat(originalSale.total_amount) || 0
      const creditNoteNumber = `CN-${ret.id}`

      const { data: creditNote, error: cnErr } = await supabase
        .from('sales')
        .insert([{
          invoice_number: creditNoteNumber,
          total_amount:   -Math.abs(total),
          payment_method: originalSale.payment_method && originalSale.payment_method !== 'credit'
            ? originalSale.payment_method
            : 'cash',
          sold_by:        processedBy || null,
          customer_id:    customerId || originalSale.customer_id || null,
          location_id:    originalSale.location_id || null,
          is_credit:      false, // recognised immediately, on the return date
          business_id:    businessId || originalSale.business_id || null,
        }])
        .select()
        .single()
      if (cnErr) throw cnErr

      // Negative quantities + the original cost snapshot → itemProfit() reverses
      // the sale line's profit exactly on the return date.
      const creditItems = returnable.map(i => {
        const pid = String(parseInt(i.product_id))
        const qty = Math.abs(parseInt(i.quantity) || 0)
        return {
          sale_id:    creditNote.id,
          product_id: parseInt(i.product_id),
          quantity:   -qty,
          unit_price: parseFloat(i.unit_price) || 0,
          subtotal:   -Math.abs(parseFloat(i.subtotal) || 0),
          cost_price: costByProduct[pid] || 0,
        }
      })
      const { error: cnItemsErr } = await supabase.from('sales_items').insert(creditItems)
      if (cnItemsErr) throw cnItemsErr

      return {
        ...ret,
        refund_amount:      total,
        credit_note_id:     creditNote.id,
        credit_note_number: creditNoteNumber,
        invoice_total:      originalTotal, // unchanged — the invoice is not shrunk
      }
    }

    return { ...ret, refund_amount: total }
  },

  // ── Units already returned against an invoice (per product) ──────────────────
  // The invoice is never shrunk, so callers cap a new return with the sold
  // quantity minus what this returns.
  getReturnedQuantities: async (saleId) => {
    if (!saleId) return {}
    const { data, error } = await supabase
      .from('returns')
      .select('id, return_items(product_id, quantity)')
      .eq('original_sale_id', saleId)
    if (error) {
      console.warn('[salesService] could not read prior returns:', error.message)
      return {}
    }
    const acc = {}
    for (const r of data || []) {
      for (const it of r.return_items || []) {
        const pid = String(parseInt(it.product_id))
        acc[pid] = (acc[pid] || 0) + (parseInt(it.quantity) || 0)
      }
    }
    return acc
  },

  // ── Mark a credit sale as paid ──────────────────────────────────────────────
  markAsPaid: async (saleId, customerId, amount) => {
    // Update the sale to mark it as paid. paid_at is the date the money came in
    // — the date this sale's profit is recognised in the daily/range totals.
    const { error: saleErr } = await supabase
      .from('sales')
      .update({
        is_credit:      false,
        payment_method: 'cash',
        paid_at:        new Date().toISOString(),
      })
      .eq('id', saleId)
    if (saleErr) throw saleErr

    // Reduce customer's outstanding balance
    if (customerId) {
      const { data: customer } = await supabase
        .from('customers')
        .select('current_balance')
        .eq('id', customerId)
        .single()

      const newBalance = Math.max(0, (parseFloat(customer?.current_balance) || 0) - parseFloat(amount))
      const { error: custErr } = await supabase
        .from('customers')
        .update({ current_balance: newBalance })
        .eq('id', customerId)
      if (custErr) throw custErr
    }

    return { success: true }
  },

  // ── Today's sales summary ─────────────────────────────────────────────────────
  getTodaySales: async (businessId = null) => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(Date.now() + 1) // now, inclusive

    const rows = await fetchSalesInWindow(start, end, businessId)

    let total       = 0
    let count       = 0
    let creditTotal = 0
    let profit      = 0
    for (const sale of rows) {
      // Revenue & profit only land once the money comes in — a credit sale
      // counts on the day it is marked paid, never while it is unpaid.
      const recognized = recognizedDateOf(sale)
      if (inWindow(recognized, start, end)) {
        const amount = parseFloat(sale.total_amount) || 0
        total += amount
        // Refund credit notes (negative rows) reduce revenue but are not sales.
        if (amount > 0) count += 1
        profit += itemProfit(sale)
      }
      // Outstanding credit issued today (still unpaid)
      if (sale.is_credit && inWindow(sale.created_at, start, end)) {
        creditTotal += parseFloat(sale.total_amount) || 0
      }
    }
    return { total, count, creditTotal, profit, records: rows }
  },

  // ── Range stats (total sales + gross profit for a date range) ────────────────
  getRangeStats: async (startDate, endDate, businessId = null) => {
    if (!startDate || !endDate) return { totalSales: 0, totalProfit: 0, count: 0 }

    const from = new Date(`${startDate}T00:00:00`)
    const to = new Date(`${endDate}T00:00:00`)
    to.setDate(to.getDate() + 1) // exclusive end — covers the whole end day

    const rows = await fetchSalesInWindow(from, to, businessId)

    let totalSales  = 0
    let totalProfit = 0
    let count       = 0
    for (const sale of rows) {
      // Revenue is booked on the day the money came in: cash sales on the sale
      // date, credit sales on the day they were marked paid — an unpaid credit
      // sale is excluded from both revenue and profit until it is paid.
      const recognized = recognizedDateOf(sale)
      if (inWindow(recognized, from, to)) {
        const amount = parseFloat(sale.total_amount) || 0
        totalSales += amount
        // Refund credit notes (negative rows) reduce revenue/profit but are not
        // sales, so they never inflate the "N sales in range" count.
        if (amount > 0) count += 1
        totalProfit += itemProfit(sale)
      }
    }
    return { totalSales, totalProfit, count }
  },

  // ── Gross Profit (for dashboard card) ────────────────────────────────────────
  /**
   * Get gross profit over a period: SUM((unit_price - cost_price) * quantity)
   * for the sales whose profit was recognised inside the period — cash sales on
   * their sale date, credit sales on the day they were marked paid.
   * Compares vs the previous equivalent period for % change.
   *
   * @param {"1D"|"1W"|"1M"} period - Period label
   * @returns {{ grossProfit: number, previousGrossProfit: number, changePct: number }}
   */
  getGrossProfit: async (period = '1M', businessId = null) => {
    const INTERVALS = { '1D': 1, '1W': 7, '1M': 30 }
    const days = INTERVALS[period] || 30
    const periodEnd = new Date(Date.now() + 1) // now, inclusive
    const periodStart = new Date()
    periodStart.setDate(periodStart.getDate() - days)
    const prevStart = new Date()
    prevStart.setDate(prevStart.getDate() - days * 2)

    const [currentRows, previousRows] = await Promise.all([
      fetchSalesInWindow(periodStart, periodEnd, businessId),
      fetchSalesInWindow(prevStart, periodStart, businessId),
    ])

    const profitIn = (rows, from, to) =>
      (rows || []).reduce(
        (sum, sale) => (inWindow(recognizedDateOf(sale), from, to) ? sum + itemProfit(sale) : sum),
        0,
      )

    const grossProfit = profitIn(currentRows, periodStart, periodEnd)
    const previousGrossProfit = profitIn(previousRows, prevStart, periodStart)
    const changePct = previousGrossProfit > 0
      ? ((grossProfit - previousGrossProfit) / previousGrossProfit) * 100
      : 0

    return { grossProfit, previousGrossProfit, changePct }
  },
}

export default salesService