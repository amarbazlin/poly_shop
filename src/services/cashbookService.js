/**
 * Forgera — Cash book service.
 *
 * The company's money ledger, kept deliberately simple:
 *   • income  (money in)
 *   • expense (money out)
 *
 * Entries live in the existing `transactions` table (migration 0006, re-asserted
 * by 0015_cashbook.sql) and are read/written straight from Supabase — no backend
 * round-trip, so the page keeps working even when the Python API is offline.
 *
 * The aggregation + balance-sheet maths is split into PURE helpers
 * (computeCashbookTotals / buildBalanceSheet) so it can be unit tested without a
 * database.
 *
 * RBAC/RLS: `transactions` is restricted to super_admin / general_manager /
 * accountant for reads and super_admin / accountant for writes. Every write
 * checks the returned rows, so a policy block surfaces as a real error instead
 * of a silent no-op.
 */

import { supabase } from './supabase'
import { customerService } from './customerService'
import { productService } from './productService'
import { purchasesService } from './purchasesService'

const TABLE = 'transactions'

export const CASH_IN = 'income'
export const CASH_OUT = 'expense'

const num = (value) => {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

const round2 = (value) => Math.round(num(value) * 100) / 100

/** First moment of the current month, as an ISO timestamp. */
const startOfMonthISO = (from = new Date()) =>
  new Date(from.getFullYear(), from.getMonth(), 1).toISOString()

const toTime = (value) => {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/**
 * Total money in / out for a set of ledger rows. Pure — no Supabase.
 * rows: [{ type: 'income'|'expense', amount, created_at }]
 */
export const computeCashbookTotals = (rows = [], now = new Date()) => {
  const monthStart = toTime(startOfMonthISO(now))
  const totals = {
    count: rows.length,
    income: 0,
    expense: 0,
    net: 0,
    month: { income: 0, expense: 0, net: 0 },
  }

  for (const row of rows) {
    const amount = num(row?.amount)
    const isIncome = row?.type === CASH_IN
    if (isIncome) totals.income += amount
    else totals.expense += amount

    const created = toTime(row?.created_at)
    if (created !== null && created >= monthStart) {
      if (isIncome) totals.month.income += amount
      else totals.month.expense += amount
    }
  }

  totals.income = round2(totals.income)
  totals.expense = round2(totals.expense)
  totals.net = round2(totals.income - totals.expense)
  totals.month.income = round2(totals.month.income)
  totals.month.expense = round2(totals.month.expense)
  totals.month.net = round2(totals.month.income - totals.month.expense)
  return totals
}
/**
 * The whole financial picture, as a simple balance sheet. Pure — no Supabase.
 *
 *   Assets      = cash + receivables + stock at cost
 *   Liabilities = bills owed to suppliers
 *   Net worth   = assets − liabilities
 */
export const buildBalanceSheet = ({
  cash = 0,
  receivables = 0,
  inventory = 0,
  supplierCount = 0,
  customerCount = 0,
  productCount = 0,
  payables = 0,
  asOf = new Date(),
} = {}) => {
  const assets = [
    { key: 'cash', label: 'Cash in hand', detail: 'Money in − money out', amount: round2(cash) },
    {
      key: 'receivables',
      label: 'Owed by customers',
      detail: customerCount
        ? `${customerCount} customer${customerCount === 1 ? '' : 's'} on credit`
        : 'No customer credit',
      amount: round2(receivables),
    },
    {
      key: 'inventory',
      label: 'Stock on hand',
      detail: productCount
        ? `${productCount} product${productCount === 1 ? '' : 's'} at cost`
        : 'No stock',
      amount: round2(inventory),
    },
  ]

  const liabilities = [
    {
      key: 'payables',
      label: 'Owed to suppliers',
      detail: supplierCount
        ? `${supplierCount} unpaid bill${supplierCount === 1 ? '' : 's'}`
        : 'No supplier credit',
      amount: round2(payables),
    },
  ]

  const totalAssets = round2(assets.reduce((sum, a) => sum + a.amount, 0))
  const totalLiabilities = round2(liabilities.reduce((sum, l) => sum + l.amount, 0))

  return {
    asOf,
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth: round2(totalAssets - totalLiabilities),
  }
}

const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))

export const cashbookService = {
  /** Newest first. */
  list: async ({ businessId = null, limit = 200 } = {}) => {
    let query = supabase.from(TABLE).select('*')
    if (businessId) query = query.eq('business_id', businessId)

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data || []
  },

  /** Add one manual money-in / money-out entry. */
  add: async ({
    type,
    amount,
    category,
    description = '',
    paymentMethod = 'cash',
    entryDate = null,
    businessId = null,
    userId = null,
  }) => {
    if (type !== CASH_IN && type !== CASH_OUT) {
      throw new Error('An entry must be either income or an expense.')
    }
    const value = round2(amount)
    if (!(value > 0)) throw new Error('Enter an amount greater than zero.')
    if (!category || !String(category).trim()) throw new Error('Pick or type a category.')
    if (!businessId) throw new Error('No business is linked to your account, so this entry cannot be saved.')

    // created_at doubles as the entry date: manual entries may be back-dated.
    const createdAt = isDateOnly(entryDate)
      ? new Date(`${entryDate}T12:00:00`).toISOString()
      : new Date().toISOString()

    const { data, error } = await supabase
      .from(TABLE)
      .insert([{
        business_id: businessId,
        type,
        category: String(category).trim(),
        amount: value,
        related_entity: 'none',
        source: 'manual',
        payment_method: paymentMethod || 'cash',
        status: 'cleared',
        description: String(description || '').trim() || null,
        created_by: userId,
        created_at: createdAt,
      }])
      .select()
      .single()

    if (error) throw error
    if (!data) throw new Error('The entry was not saved — the database rejected the write.')
    return data
  },
  /** Delete one manual entry. */
  remove: async (id) => {
    const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id')
    if (error) throw error
    if (!data || data.length === 0) {
      throw new Error('That entry could not be deleted — it may already be gone, or you lack permission.')
    }
    return true
  },

  /** Money in / money out totals for the cash book. */
  summary: async ({ businessId = null } = {}) => {
    let query = supabase.from(TABLE).select('type, amount, created_at')
    if (businessId) query = query.eq('business_id', businessId)

    const { data, error } = await query
    if (error) throw error
    return computeCashbookTotals(data || [])
  },

  /**
   * Balance sheet for the bottom of the page: combines the cash book with the
   * source-of-truth ledgers (customer credit, supplier credit, stock at cost).
   */
  getBalanceSheet: async ({ businessId = null } = {}) => {
    const [cash, receivables, inventory, creditRows] = await Promise.all([
      cashbookService.summary({ businessId }),
      customerService.getOutstandingCredit(businessId),
      productService.getInventoryValue(businessId),
      purchasesService.getCreditRows({ businessId, limit: 2000 }),
    ])

    const payables = (creditRows || []).reduce((sum, row) => sum + num(row.balance), 0)

    return buildBalanceSheet({
      cash: cash.net,
      receivables: receivables.total,
      customerCount: receivables.count,
      inventory: inventory.totalValue,
      productCount: inventory.productCount,
      payables,
      supplierCount: (creditRows || []).length,
    })
  },
}

export default cashbookService


