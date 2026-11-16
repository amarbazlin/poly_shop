import { supabase } from './supabase'

// ── Supplier credit rules ─────────────────────────────────────────────────────
// Mirrors backend/agents/alert_engine.py: a credit bill is "due soon" from 7
// days out, escalates at 3/1 day, and is "overdue" the day after its due date.
export const DUE_SOON_DAYS = 7

export const CREDIT_STATUS = {
  OVERDUE:  'overdue',
  DUE_SOON: 'due-this-week',
  UPCOMING: 'upcoming',
}

export const CREDIT_STATUS_LABEL = {
  overdue:        'Overdue',
  'due-this-week': 'Due soon',
  upcoming:       'Upcoming',
}

const toNumber = (value) => {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

const dateOnly = (value) => (value ? String(value).slice(0, 10) : null)

export const todayISO = () => {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

/** Whole days from `fromISO` until `dateISO` (negative = already overdue). */
export const daysUntil = (dateISO, fromISO = todayISO()) => {
  if (!dateISO) return null
  const target = Date.parse(`${dateISO}T00:00:00Z`)
  const start  = Date.parse(`${fromISO}T00:00:00Z`)
  if (Number.isNaN(target) || Number.isNaN(start)) return null
  return Math.round((target - start) / 86400000)
}

/** overdue | due-this-week | upcoming — the vocabulary the finance module uses. */
export const creditStatusOf = (dueDate, fromISO = todayISO()) => {
  const days = daysUntil(dueDate, fromISO)
  if (days === null)  return CREDIT_STATUS.UPCOMING
  if (days < 0)       return CREDIT_STATUS.OVERDUE
  if (days <= DUE_SOON_DAYS) return CREDIT_STATUS.DUE_SOON
  return CREDIT_STATUS.UPCOMING
}

/** 'YYYY-MM' bucket for a due date, or 'unscheduled' when none was set. */
export const monthKeyOf = (dueDate) => (dueDate ? String(dueDate).slice(0, 7) : 'unscheduled')

export const monthLabelOf = (monthKey) => {
  if (monthKey === 'unscheduled') return 'No due date set'
  const [y, m] = monthKey.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  if (Number.isNaN(d.getTime())) return monthKey
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/** Add N credit days to a purchase date → the default due date. */
export const dueDateFromPeriod = (purchaseDate, creditPeriodDays) => {
  const base = new Date(`${dateOnly(purchaseDate) || todayISO()}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return null
  base.setUTCDate(base.getUTCDate() + (parseInt(creditPeriodDays) || 0))
  return base.toISOString().slice(0, 10)
}

const PURCHASE_SELECT = `
  *,
  suppliers ( id, supplier_name, phone ),
  purchase_payments ( id, amount, payment_method, payment_date, notes, created_at )
`

/** Decorate a purchase row with its payable position. */
export const shapePurchase = (row, fromISO = todayISO()) => {
  const total = toNumber(row.total_amount)
  const payments = Array.isArray(row.purchase_payments) ? row.purchase_payments : []
  const paid = payments.reduce((sum, p) => sum + toNumber(p.amount), 0)
  const isCredit = (row.payment_type || 'cash') === 'credit'
  const balance = Math.max(0, total - paid)
  const dueDate = dateOnly(row.due_date)
  const daysRemaining = daysUntil(dueDate, fromISO)
  const settled = paid >= total - 0.005

  return {
    ...row,
    total_amount: total,
    paid_amount: Math.round(paid * 100) / 100,
    balance: Math.round(balance * 100) / 100,
    is_credit: isCredit,
    is_settled: settled,
    due_date: dueDate,
    days_remaining: daysRemaining,
    days_overdue: daysRemaining !== null && daysRemaining < 0 ? -daysRemaining : 0,
    credit_status: isCredit && !settled ? creditStatusOf(dueDate, fromISO) : 'settled',
    payments: [...payments].sort((a, b) => String(a.payment_date || '').localeCompare(String(b.payment_date || ''))),
  }
}

export const purchasesService = {
  // ── List purchases (with supplier + payment history) ───────────────────────
  getAll: async ({ limit = 200, from = null, to = null, supplierId = null, paymentType = null, businessId = null } = {}) => {
    let query = supabase
      .from('purchases')
      .select(PURCHASE_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (businessId)  query = query.eq('business_id', businessId)
    if (supplierId)  query = query.eq('supplier_id', supplierId)
    if (paymentType) query = query.eq('payment_type', paymentType)
    if (from)        query = query.gte('created_at', `${dateOnly(from)}T00:00:00`)
    if (to)          query = query.lte('created_at', `${dateOnly(to)}T23:59:59`)

    const { data, error } = await query
    if (error) throw error
    return (data || []).map(row => shapePurchase(row))
  },

  getById: async (id) => {
    const { data, error } = await supabase
      .from('purchases')
      .select(PURCHASE_SELECT)
      .eq('id', id)
      .single()
    if (error) throw error
    return shapePurchase(data)
  },

  // ── Create a purchase record (cash bill or supplier credit) ────────────────
  create: async ({
    supplierId, totalAmount, paymentType = 'cash', creditPeriodDays = 0,
    dueDate = null, invoiceNumber = null, purchaseDate = null, notes = null,
    locationId = null, businessId = null, createdBy = null,
  }) => {
    const amount = toNumber(totalAmount)
    if (!supplierId)   throw new Error('Select a supplier for this purchase')
    if (!(amount > 0)) throw new Error('Enter a purchase amount greater than zero')

    const isCredit = paymentType === 'credit'
    const purchaseDateISO = dateOnly(purchaseDate) || todayISO()
    // Credit bills need a due date: the owner can set one, otherwise it is
    // purchase date + the agreed credit period.
    const resolvedDue = isCredit
      ? (dateOnly(dueDate) || dueDateFromPeriod(purchaseDateISO, creditPeriodDays))
      : null

    const { data, error } = await supabase
      .from('purchases')
      .insert([{
        supplier_id:        parseInt(supplierId),
        invoice_number:     invoiceNumber || null,
        total_amount:       amount,
        payment_type:       isCredit ? 'credit' : 'cash',
        credit_period_days: isCredit ? (parseInt(creditPeriodDays) || 0) : 0,
        due_date:           resolvedDue,
        status:             'completed',
        source:             'manual',
        notes:              notes || null,
        location_id:        locationId ? parseInt(locationId) : null,
        business_id:        businessId,
        created_by:         createdBy || null,
        purchased_by:       createdBy || null,
      }])
      .select()
      .single()

    if (error) throw error

    // A cash bill is settled the moment it is recorded — store the payment so the
    // bill never appears as outstanding credit.
    if (!isCredit) {
      const { error: payErr } = await supabase.from('purchase_payments').insert([{
        business_id:    businessId,
        purchase_id:    data.id,
        amount,
        payment_method: 'cash',
        payment_date:   purchaseDateISO,
        notes:          'Paid at purchase',
      }])
      if (payErr) console.warn('[purchases] cash payment marker failed:', payErr.message)
    }

    return shapePurchase({ ...data, purchase_payments: [] })
  },

  update: async (id, updates) => {
    const { data, error } = await supabase
      .from('purchases')
      .update(updates)
      .eq('id', id)
      .select(PURCHASE_SELECT)
      .single()
    if (error) throw error
    return shapePurchase(data)
  },

  /** Set (or move) the date this credit bill has to be paid. */
  updateDueDate: async (id, dueDate, creditPeriodDays = null) => {
    const patch = { due_date: dateOnly(dueDate) }
    if (creditPeriodDays !== null) patch.credit_period_days = parseInt(creditPeriodDays) || 0

    const { data, error } = await supabase
      .from('purchases')
      .update(patch)
      .eq('id', id)
      .select(PURCHASE_SELECT)
      .single()
    if (error) throw error
    return shapePurchase(data)
  },

  remove: async (id) => {
    const { error } = await supabase.from('purchases').delete().eq('id', id)
    if (error) throw error
  },

  // ── Payments against a credit bill ─────────────────────────────────────────
  getPayments: async (purchaseId) => {
    const { data, error } = await supabase
      .from('purchase_payments')
      .select('*')
      .eq('purchase_id', purchaseId)
      .order('payment_date', { ascending: false })
    if (error) throw error
    return data || []
  },

  /**
   * Pay (part of) a credit bill. The payment date is the owner's choice — that
   * is the "date to pay" the reminder panel asks for.
   */
  recordPayment: async ({
    purchaseId, amount, paymentMethod = 'cash', paymentDate = null,
    notes = null, businessId = null,
  }) => {
    const value = toNumber(amount)
    if (!purchaseId)  throw new Error('Missing purchase for this payment')
    if (!(value > 0)) throw new Error('Enter a payment amount greater than zero')

    const { data: purchase, error: readErr } = await supabase
      .from('purchases')
      .select('id, total_amount, payment_type, purchase_payments ( amount )')
      .eq('id', purchaseId)
      .single()
    if (readErr) throw readErr

    const total = toNumber(purchase.total_amount)
    const alreadyPaid = (purchase.purchase_payments || [])
      .reduce((sum, p) => sum + toNumber(p.amount), 0)
    const outstanding = Math.round((total - alreadyPaid) * 100) / 100

    if (outstanding <= 0.005) throw new Error('This purchase is already fully paid')
    if (value > outstanding + 0.005) {
      throw new Error(`Payment exceeds the outstanding balance of ${outstanding.toFixed(2)}`)
    }

    const { data, error } = await supabase
      .from('purchase_payments')
      .insert([{
        business_id:    businessId,
        purchase_id:    parseInt(purchaseId),
        amount:         Math.round(value * 100) / 100,
        payment_method: paymentMethod,
        payment_date:   dateOnly(paymentDate) || todayISO(),
        notes:          notes || null,
      }])
      .select()
      .single()
    if (error) throw error
    return data
  },

  // ── Credit engine — what is owed, and when it falls due ────────────────────
  /** Outstanding (unpaid / partly paid) credit purchases, soonest due first. */
  getCreditRows: async ({ businessId = null, limit = 500 } = {}) => {
    let query = supabase
      .from('purchases')
      .select(PURCHASE_SELECT)
      .eq('payment_type', 'credit')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(limit)

    if (businessId) query = query.eq('business_id', businessId)

    const { data, error } = await query
    if (error) throw error

    return (data || [])
      .map(row => shapePurchase(row))
      .filter(row => !row.is_settled && row.balance > 0.005)
  },
}

export default purchasesService

// ── Credit aggregations (pure — used by the page and the reminder popup) ──────

/** Bucket outstanding credit rows by the month their due date falls in. */
export const groupCreditsByMonth = (rows = []) => {
  const months = new Map()
  for (const row of rows) {
    const key = monthKeyOf(row.due_date)
    if (!months.has(key)) {
      months.set(key, { month: key, label: monthLabelOf(key), total_due: 0, overdue_amount: 0, purchases: [] })
    }
    const bucket = months.get(key)
    bucket.total_due += row.balance
    if (row.credit_status === CREDIT_STATUS.OVERDUE) bucket.overdue_amount += row.balance
    bucket.purchases.push(row)
  }
  return [...months.values()]
    .map(b => ({
      ...b,
      total_due: Math.round(b.total_due * 100) / 100,
      overdue_amount: Math.round(b.overdue_amount * 100) / 100,
      purchase_count: b.purchases.length,
      supplier_count: new Set(b.purchases.map(p => p.supplier_id)).size,
    }))
    .sort((a, b) => {
      if (a.month === 'unscheduled') return 1
      if (b.month === 'unscheduled') return -1
      return a.month.localeCompare(b.month)
    })
}

/** Roll outstanding credit up per supplier (who do we owe, and how much). */
export const groupCreditsBySupplier = (rows = []) => {
  const suppliers = new Map()
  for (const row of rows) {
    const key = row.supplier_id ?? row.suppliers?.supplier_name ?? 'unknown'
    if (!suppliers.has(key)) {
      suppliers.set(key, {
        supplier_id: row.supplier_id,
        supplier: row.suppliers?.supplier_name || 'Unknown supplier',
        phone: row.suppliers?.phone || null,
        total_due: 0, overdue_amount: 0, purchases: [],
      })
    }
    const s = suppliers.get(key)
    s.total_due += row.balance
    if (row.credit_status === CREDIT_STATUS.OVERDUE) s.overdue_amount += row.balance
    s.purchases.push(row)
  }
  return [...suppliers.values()]
    .map(s => ({
      ...s,
      total_due: Math.round(s.total_due * 100) / 100,
      overdue_amount: Math.round(s.overdue_amount * 100) / 100,
      purchase_count: s.purchases.length,
      next_due_date: s.purchases
        .map(p => p.due_date).filter(Boolean).sort()[0] || null,
    }))
    .sort((a, b) => b.total_due - a.total_due)
}

const round2 = (n) => Math.round(n * 100) / 100

/**
 * The numbers the reminder shows: what is due this month, what is due in the
 * next `DUE_SOON_DAYS` days, and what is already overdue.
 */
export const summariseCredits = (rows = [], fromISO = todayISO()) => {
  const month = fromISO.slice(0, 7)
  const overdue = rows.filter(r => r.credit_status === CREDIT_STATUS.OVERDUE)
  const dueSoon = rows.filter(r => r.credit_status === CREDIT_STATUS.DUE_SOON)
  const dueThisMonth = rows.filter(r => monthKeyOf(r.due_date) === month)
  const unscheduled = rows.filter(r => !r.due_date)

  const sum = (list) => round2(list.reduce((s, r) => s + r.balance, 0))

  return {
    month,
    monthLabel: monthLabelOf(month),
    totalDue: sum(rows),
    dueThisMonth: sum(dueThisMonth),
    dueThisMonthCount: dueThisMonth.length,
    dueSoonAmount: sum(dueSoon),
    dueSoonCount: dueSoon.length,
    overdueAmount: sum(overdue),
    overdueCount: overdue.length,
    unscheduledAmount: sum(unscheduled),
    unscheduledCount: unscheduled.length,
    /** Rows the popup should shout about: overdue + anything due within a week. */
    needsAttention: [...overdue, ...dueSoon].sort((a, b) =>
      String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))),
    rows,
  }
}


