/**
 * Forgera — Finance (cash book).
 *
 * One simple page for the owner/accountant:
 *   1. Add money in / money out
 *   2. See cash in, cash out and the balance
 *   3. Balance sheet at the bottom — the whole picture of the company
 *
 * Everything reads/writes the Supabase ledger directly (see cashbookService),
 * so no Python backend is required. Layout is inline-styled and responsive:
 * every grid uses auto-fit so it collapses to a single column on phones.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Minus, Trash2, RefreshCw, Search, X, ArrowUpRight, ArrowDownRight,
  Wallet, Truck, Scale,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useRBAC } from '../../context/RBACContext'
import { P } from '../../utils/permissions'
import { cashbookService, computeCashbookTotals, CASH_IN, CASH_OUT } from '../../services/cashbookService'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { PAYMENT_METHODS } from '../../utils/constants'
import Modal from '../../components/shared/Modal'
import Button from '../../components/shared/Button'
import Loader from '../../components/shared/Loader'

const TYPE_META = {
  [CASH_IN]:  { label: 'Money in',  color: 'var(--success)', bg: 'var(--success-bg)', border: '#bbf7d0', Icon: ArrowUpRight },
  [CASH_OUT]: { label: 'Money out', color: 'var(--danger)',  bg: 'var(--danger-bg)',  border: '#fecaca', Icon: ArrowDownRight },
}

const CATEGORY_SUGGESTIONS = {
  [CASH_IN]:  ['Sales', 'Services', 'Other income'],
  [CASH_OUT]: ['Stock purchase', 'Rent', 'Utilities', 'Salaries', 'Transport', 'Loan repayment', 'Miscellaneous'],
}

const PAYMENT_LABELS = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  credit: 'Credit',
}

const money = (value) => formatCurrency(parseFloat(value) || 0)

const todayStr = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const fieldStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 9,
  border: '1.5px solid var(--card-border)',
  fontSize: 13.5,
  fontFamily: 'DM Sans, sans-serif',
  background: '#fff',
  color: 'var(--text-primary)',
  outline: 'none',
}

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 6,
}

const Panel = ({ title, subtitle, actions, children }) => (
  <section
    style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--card-border)',
      borderRadius: 'var(--radius-md)',
      padding: 16,
    }}
  >
    {(title || actions) && (
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap', marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {title && (
            <h3 style={{ fontFamily: 'Outfit, sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {title}
            </h3>
          )}
          {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</p>}
        </div>
        {actions}
      </header>
    )}
    {children}
  </section>
)

const SummaryCard = ({ label, value, hint, Icon, color, bg }) => (
  <div
    style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--card-border)',
      borderLeft: `4px solid ${color}`,
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      minWidth: 0,
    }}
  >
    <span
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 34, height: 34, borderRadius: 9, background: bg, color, flexShrink: 0,
      }}
    >
      <Icon size={17} />
    </span>
    <div style={{ minWidth: 0 }}>
      <p style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
        {label}
      </p>
      <strong
        style={{
          display: 'block', fontFamily: 'Outfit, sans-serif', fontSize: 19,
          margin: '2px 0', color: 'var(--text-primary)', overflowWrap: 'anywhere',
        }}
      >
        {value}
      </strong>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{hint}</span>
    </div>
  </div>
)
// ── Add income / expense ───────────────────────────────────────────────────────
const EntryModal = ({ type, open, onClose, onSaved, businessId, userId }) => {
  const meta = TYPE_META[type] || TYPE_META[CASH_IN]
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [entryDate, setEntryDate] = useState(todayStr())
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setAmount('')
    setCategory('')
    setEntryDate(todayStr())
    setPaymentMethod('cash')
    setDescription('')
    setError(null)
  }, [open, type])

  const suggestions = CATEGORY_SUGGESTIONS[type] || []
  const listId = `cashbook-categories-${type}`

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const entry = await cashbookService.add({
        type, amount, category, description, paymentMethod, entryDate, businessId, userId,
      })
      onSaved(entry)
    } catch (err) {
      setError(err?.message || 'Could not save this entry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add ${meta.label.toLowerCase()}`} width={460}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle} htmlFor="cashbook-amount">Amount</label>
          <input
            id="cashbook-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            style={{ ...fieldStyle, fontFamily: 'Outfit, sans-serif', fontSize: 17, fontWeight: 600 }}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="cashbook-category">Category</label>
          <input
            id="cashbook-category"
            list={listId}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={type === CASH_IN ? 'e.g. Sales' : 'e.g. Rent'}
            style={fieldStyle}
          />
          <datalist id={listId}>
            {suggestions.map((name) => <option key={name} value={name} />)}
          </datalist>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="cashbook-date">Date</label>
            <input
              id="cashbook-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="cashbook-method">Paid by</label>
            <select
              id="cashbook-method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              style={fieldStyle}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>{PAYMENT_LABELS[method] || method}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle} htmlFor="cashbook-note">Note (optional)</label>
          <input
            id="cashbook-note"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was this for?"
            style={fieldStyle}
          />
        </div>

        {error && (
          <p
            style={{
              margin: 0, padding: '10px 12px', borderRadius: 8, fontSize: 12.5,
              background: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid #fecaca',
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving} icon={type === CASH_IN ? <Plus /> : <Minus />}>
            Save {meta.label.toLowerCase()}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
// ── One cash-book line ─────────────────────────────────────────────────────────
const SOURCE_LABEL = {
  sale: 'from a sale',
  purchase: 'from a purchase',
  customer_payment: 'customer payment',
  supplier_payment: 'supplier payment',
}

const LedgerRow = ({ entry, canWrite, busy, onDelete }) => {
  const meta = TYPE_META[entry.type] || TYPE_META[CASH_IN]
  const Icon = meta.Icon
  const auto = entry.source && entry.source !== 'manual'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid #f3f4f6' }}>
      <span
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: 9, flexShrink: 0,
          background: meta.bg, color: meta.color,
        }}
      >
        <Icon size={15} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{entry.category}</strong>
          {auto && (
            <span
              style={{
                fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                background: '#f3f4f6', color: 'var(--text-secondary)',
              }}
            >
              {SOURCE_LABEL[entry.source] || 'automatic'}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11.5, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {formatDate(entry.created_at)} · {PAYMENT_LABELS[entry.payment_method] || 'Cash'}
          {entry.description ? ` · ${entry.description}` : ''}
        </div>
      </div>

      <strong
        style={{
          fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 14,
          color: meta.color, whiteSpace: 'nowrap',
        }}
      >
        {entry.type === CASH_IN ? '+' : '−'}{money(entry.amount)}
      </strong>

      {canWrite && !auto && (
        <button
          type="button"
          onClick={() => onDelete(entry)}
          disabled={busy}
          title="Delete entry"
          aria-label={`Delete ${entry.category} entry`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            border: '1px solid #fecaca', background: '#fef2f2', color: 'var(--danger)',
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
          }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}
// ── Balance sheet ──────────────────────────────────────────────────────────────
const SheetRow = ({ label, detail, amount }) => (
  <div
    style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 12, padding: '9px 0', borderBottom: '1px dashed #eef1f4',
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{detail}</div>
    </div>
    <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap' }}>
      {money(amount)}
    </span>
  </div>
)

const SheetTotal = ({ label, amount }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 10 }}>
    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      {label}
    </span>
    <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: 15 }}>{money(amount)}</strong>
  </div>
)

const COLUMN_HEAD = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
  fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)',
}

const BalanceSheet = ({ sheet }) => {
  const positive = sheet.netWorth >= 0
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 18 }}>
        <div>
          <div style={COLUMN_HEAD}><Wallet size={14} color="#2563eb" /> Assets</div>
          {sheet.assets.map((row) => (
            <SheetRow key={row.key} label={row.label} detail={row.detail} amount={row.amount} />
          ))}
          <SheetTotal label="Total assets" amount={sheet.totalAssets} />
        </div>

        <div>
          <div style={COLUMN_HEAD}><Truck size={14} color="#dc2626" /> Liabilities</div>
          {sheet.liabilities.map((row) => (
            <SheetRow key={row.key} label={row.label} detail={row.detail} amount={row.amount} />
          ))}
          <SheetTotal label="Total liabilities" amount={sheet.totalLiabilities} />
        </div>
      </div>

      <div
        style={{
          marginTop: 16, padding: '14px 16px', borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap',
          background: positive ? 'var(--success-bg)' : 'var(--danger-bg)',
          border: `1px solid ${positive ? '#bbf7d0' : '#fecaca'}`,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: positive ? 'var(--success-text)' : 'var(--danger-text)' }}>
            {positive ? 'Net worth' : 'Net position (shortfall)'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Total assets − total liabilities</div>
        </div>
        <strong
          style={{
            fontFamily: 'Outfit, sans-serif', fontSize: 22, fontWeight: 700,
            color: positive ? 'var(--success-text)' : 'var(--danger-text)', whiteSpace: 'nowrap',
          }}
        >
          {money(sheet.netWorth)}
        </strong>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
        Cash in hand is money in − money out from your cash book. Stock on hand is valued at cost price,
        and supplier bills come from unpaid credit purchases.
      </p>
    </>
  )
}
// ── Page ───────────────────────────────────────────────────────────────────────
export default function Finance() {
  const { user, businessId } = useAuth()
  const { can } = useRBAC()
  const canWrite = can(P.MANAGE_FINANCE)

  const [entries, setEntries] = useState([])
  const [sheet, setSheet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [modalType, setModalType] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, balanceSheet] = await Promise.all([
        cashbookService.list({ businessId }),
        cashbookService.getBalanceSheet({ businessId }),
      ])
      setEntries(rows)
      setSheet(balanceSheet)
    } catch (err) {
      setError(err?.message || 'Could not load your finance data.')
      setEntries([])
      setSheet(null)
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => { load() }, [load])

  // Totals are derived from the rows already in memory — no second round-trip.
  const totals = useMemo(() => computeCashbookTotals(entries), [entries])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((entry) => {
      if (filter !== 'all' && entry.type !== filter) return false
      if (!q) return true
      return [entry.category, entry.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    })
  }, [entries, filter, search])

  const onSaved = async (entry) => {
    setModalType(null)
    setNotice(`${entry.type === CASH_IN ? 'Money in' : 'Money out'} of ${money(entry.amount)} recorded.`)
    await load()
  }

  const onDelete = async (entry) => {
    const label = entry.type === CASH_IN ? 'money-in' : 'money-out'
    if (!window.confirm(`Delete this ${label} entry of ${money(entry.amount)}?`)) return
    setBusyId(entry.id)
    setError(null)
    try {
      await cashbookService.remove(entry.id)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete that entry.')
    } finally {
      setBusyId(null)
    }
  }

  const rangeLabel = totals.count
    ? `${totals.count} entr${totals.count === 1 ? 'y' : 'ies'} recorded`
    : 'No entries yet'

  const filterChips = [
    { key: 'all', label: 'All' },
    { key: CASH_IN, label: 'Money in' },
    { key: CASH_OUT, label: 'Money out' },
  ]
  const alertBase = {
    marginBottom: 14,
    padding: '10px 14px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 12.5,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  }

  const chipStyle = (active) => ({
    padding: '6px 12px',
    borderRadius: 99,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
    background: active ? 'var(--accent-light)' : 'var(--card-bg)',
    color: active ? 'var(--accent-dark)' : 'var(--text-secondary)',
  })

  return (
    <div className="page-wrapper finance-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Finance</h1>
          <p className="page-subtitle">Money in, money out and where the business stands</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="secondary" icon={<RefreshCw />} onClick={load} disabled={loading}>
            Refresh
          </Button>
          {canWrite && (
            <>
              <Button variant="secondary" icon={<Minus />} onClick={() => { setNotice(null); setModalType(CASH_OUT) }}>
                Add expense
              </Button>
              <Button icon={<Plus />} onClick={() => { setNotice(null); setModalType(CASH_IN) }}>
                Add income
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div style={{ ...alertBase, background: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid #fecaca' }}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'flex' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {notice && (
        <div style={{ ...alertBase, background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid #bbf7d0' }}>
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'flex' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Money in / out at a glance */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <SummaryCard
          label="Cash in"
          value={loading ? '—' : money(totals.income)}
          hint={loading ? 'Loading…' : `This month ${money(totals.month.income)}`}
          Icon={ArrowUpRight}
          color="var(--success)"
          bg="var(--success-bg)"
        />
        <SummaryCard
          label="Cash out"
          value={loading ? '—' : money(totals.expense)}
          hint={loading ? 'Loading…' : `This month ${money(totals.month.expense)}`}
          Icon={ArrowDownRight}
          color="var(--danger)"
          bg="var(--danger-bg)"
        />
        <SummaryCard
          label="Balance"
          value={loading ? '—' : money(totals.net)}
          hint={loading ? 'Loading…' : `This month ${money(totals.month.net)}`}
          Icon={Wallet}
          color="var(--accent)"
          bg="var(--accent-light)"
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ── Cash book ── */}
        <Panel
          title="Cash book"
          subtitle={rangeLabel}
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search entries…"
                  aria-label="Search cash book entries"
                  style={{ ...fieldStyle, paddingLeft: 32, width: 190, minWidth: 130 }}
                />
              </div>
              {filterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setFilter(chip.key)}
                  style={chipStyle(filter === chip.key)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          }
        >
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <Loader />
            </div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '26px 12px' }}>
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 44, height: 44, borderRadius: 14,
                  background: 'var(--accent-light)', color: 'var(--accent)',
                }}
              >
                <Wallet size={20} />
              </span>
              <h4 style={{ fontSize: 14, marginTop: 10, color: 'var(--text-primary)' }}>
                {entries.length ? 'No entries match this filter' : 'No entries yet'}
              </h4>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                {entries.length
                  ? 'Try another filter or clear the search.'
                  : 'Add your first income or expense to start the cash book.'}
              </p>
              {canWrite && entries.length === 0 && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
                  <Button size="sm" icon={<Plus />} onClick={() => setModalType(CASH_IN)}>Add income</Button>
                  <Button size="sm" variant="secondary" icon={<Minus />} onClick={() => setModalType(CASH_OUT)}>Add expense</Button>
                </div>
              )}
            </div>
          ) : (
            <div>
              {visible.map((entry) => (
                <LedgerRow
                  key={entry.id}
                  entry={entry}
                  canWrite={canWrite}
                  busy={busyId === entry.id}
                  onDelete={onDelete}
                />
              ))}
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', paddingTop: 10 }}>
                Showing {visible.length} of {entries.length} {entries.length === 1 ? 'entry' : 'entries'}, newest first.
              </p>
            </div>
          )}
        </Panel>

        {/* ── Balance sheet ── */}
        <Panel
          title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Scale size={15} /> Balance sheet</span>}
          subtitle={sheet ? `As of ${formatDate(sheet.asOf)}` : 'Assets, liabilities and net worth'}
        >
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <Loader />
            </div>
          ) : sheet ? (
            <BalanceSheet sheet={sheet} />
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              The balance sheet appears once your data loads.
            </p>
          )}
        </Panel>
      </div>

      {canWrite && (
        <EntryModal
          type={modalType || CASH_IN}
          open={Boolean(modalType)}
          onClose={() => setModalType(null)}
          onSaved={onSaved}
          businessId={businessId}
          userId={user?.id || null}
        />
      )}
    </div>
  )
}






