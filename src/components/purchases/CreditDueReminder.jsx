import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, Clock3,
  ExternalLink, RefreshCw, Truck,
} from 'lucide-react'
import Modal from '../shared/Modal'
import Button from '../shared/Button'
import Loader from '../shared/Loader'
import PurchasePaymentForm from './PurchasePaymentForm'
import { useAuth } from '../../context/AuthContext'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { todayStr } from '../../utils/dateRange'
import {
  purchasesService, summariseCredits, groupCreditsBySupplier,
  CREDIT_STATUS, CREDIT_STATUS_LABEL, monthLabelOf,
} from '../../services/purchasesService'

// ── Shared data hook ─────────────────────────────────────────────────────────
// Loads outstanding supplier credit once per page and derives the reminder
// figures. `enabled=false` short-circuits (e.g. a role that cannot read
// purchases) so no failing request is ever fired.
export const useSupplierCredit = ({ enabled = true } = {}) => {
  const { businessId } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!enabled) { setRows([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      setRows(await purchasesService.getCreditRows({ businessId }))
    } catch (err) {
      setError(err.message || 'Could not load supplier credit')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [businessId, enabled])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseCredits(rows), [rows])
  const bySupplier = useMemo(() => groupCreditsBySupplier(rows), [rows])

  return { rows, summary, bySupplier, loading, error, reload: load }
}

const STATUS_STYLE = {
  [CREDIT_STATUS.OVERDUE]:  { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', icon: AlertTriangle },
  [CREDIT_STATUS.DUE_SOON]: { bg: '#fff7ed', color: '#f97316', border: '#fed7aa', icon: Clock3 },
  [CREDIT_STATUS.UPCOMING]: { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe', icon: CalendarClock },
}

export const CreditStatusPill = ({ status, daysRemaining }) => {
  const s = STATUS_STYLE[status] || STATUS_STYLE[CREDIT_STATUS.UPCOMING]
  const Icon = s.icon
  let text = CREDIT_STATUS_LABEL[status] || status
  if (status === CREDIT_STATUS.OVERDUE && daysRemaining !== null) text = `${-daysRemaining}d overdue`
  else if (status === CREDIT_STATUS.DUE_SOON && daysRemaining !== null) {
    text = daysRemaining <= 0 ? 'Due today' : `Due in ${daysRemaining}d`
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: 'nowrap',
    }}>
      <Icon size={11} />{text}
    </span>
  )
}

// ── Inline banner (Purchases / Suppliers pages) ──────────────────────────────
export const CreditDueBanner = ({ credit, onOpen, title = 'Supplier credit' }) => {
  const { summary, loading } = credit

  if (loading) {
    return (
      <div style={styles.banner}>
        <Loader size={14} />
        <span style={styles.bannerText}>Checking supplier credit…</span>
      </div>
    )
  }

  const urgent = summary.overdueCount + summary.dueSoonCount
  const tone = summary.overdueCount > 0 ? 'danger' : urgent > 0 ? 'warn' : 'calm'
  const palette = {
    danger: { bg: '#fef2f2', border: '#fecaca', color: '#dc2626' },
    warn:   { bg: '#fff7ed', border: '#fed7aa', color: '#c2410c' },
    calm:   { bg: '#f0fdf4', border: '#bbf7d0', color: '#16a34a' },
  }[tone]

  return (
    <div style={{ ...styles.banner, background: palette.bg, borderColor: palette.border }}>
      {tone === 'calm' ? <CheckCircle2 size={16} color={palette.color} /> : <CalendarClock size={16} color={palette.color} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: palette.color }}>
          {tone === 'calm'
            ? 'No supplier payments due in the next 7 days'
            : `${summary.overdueCount + summary.dueSoonCount} supplier payment${urgent === 1 ? '' : 's'} need attention`}
        </div>
        <div style={styles.bannerSub}>
          {formatCurrency(summary.dueThisMonth)} due in {summary.monthLabel}
          {summary.overdueAmount > 0 && <> · <strong style={{ color: '#dc2626' }}>{formatCurrency(summary.overdueAmount)} overdue</strong></>}
          {summary.totalDue > 0 && <> · {formatCurrency(summary.totalDue)} outstanding in total</>}
        </div>
      </div>
      <Button size="sm" variant={tone === 'calm' ? 'secondary' : 'primary'} onClick={onOpen}
        style={tone === 'calm' ? undefined : { background: palette.color, border: 'none' }}>
        View
      </Button>
    </div>
  )
}

// ── The popup reminder ───────────────────────────────────────────────────────
// Opened automatically (once per session) when something is overdue or falls
// due within the week, and manually from the banner on any page.
export const CreditDuePopup = ({ open, onClose, credit, initialMonth = 'all', onChanged }) => {
  const navigate = useNavigate()
  const { summary, rows, loading, reload } = credit
  const [month, setMonth]           = useState(initialMonth)
  const [payingId, setPayingId]     = useState(null)
  const [dateEditId, setDateEditId] = useState(null)
  const [draftDate, setDraftDate]   = useState('')
  const [savingId, setSavingId]     = useState(null)
  const [error, setError]           = useState('')

  useEffect(() => {
    if (open) {
      setMonth(initialMonth)
      setPayingId(null)
      setDateEditId(null)
      setError('')
    }
  }, [open, initialMonth])

  const monthOf = (r) => (r.due_date ? r.due_date.slice(0, 7) : 'unscheduled')
  const months  = useMemo(() => [...new Set(rows.map(monthOf))].sort(), [rows])
  const visible = useMemo(() => (month === 'all' ? rows : rows.filter(r => monthOf(r) === month)), [rows, month])
  const grouped = useMemo(() => groupCreditsBySupplier(visible), [visible])

  const afterChange = async () => {
    setPayingId(null)
    setDateEditId(null)
    await reload()
    if (onChanged) await onChanged()
  }

  const saveDueDate = async (row) => {
    if (!draftDate) return
    setSavingId(row.id)
    setError('')
    try {
      await purchasesService.updateDueDate(row.id, draftDate)
      await afterChange()
    } catch (err) {
      setError(err.message || 'Could not change the due date')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Supplier Credit Reminder" width={720}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <button type="button" onClick={() => reload()} style={styles.linkBtn}>
            <RefreshCw size={12} /> Refresh
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button icon={<ExternalLink size={13} />} onClick={() => { onClose(); navigate('/purchases') }}>
              Open Purchases
            </Button>
          </div>
        </div>
      }
    >
      <div style={styles.chips}>
        <div style={{ ...styles.chip, background: '#fef2f2', borderColor: '#fecaca' }}>
          <span style={styles.chipLabel}>Overdue</span>
          <strong style={{ color: '#dc2626' }}>{formatCurrency(summary.overdueAmount)}</strong>
          <span style={styles.chipSub}>{summary.overdueCount} bill{summary.overdueCount === 1 ? '' : 's'}</span>
        </div>
        <div style={{ ...styles.chip, background: '#fff7ed', borderColor: '#fed7aa' }}>
          <span style={styles.chipLabel}>Due this week</span>
          <strong style={{ color: '#c2410c' }}>{formatCurrency(summary.dueSoonAmount)}</strong>
          <span style={styles.chipSub}>{summary.dueSoonCount} bill{summary.dueSoonCount === 1 ? '' : 's'}</span>
        </div>
        <div style={{ ...styles.chip, background: '#eff6ff', borderColor: '#bfdbfe' }}>
          <span style={styles.chipLabel}>Due in {summary.monthLabel}</span>
          <strong style={{ color: '#2563eb' }}>{formatCurrency(summary.dueThisMonth)}</strong>
          <span style={styles.chipSub}>{summary.dueThisMonthCount} bill{summary.dueThisMonthCount === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div style={styles.pickerRow}>
        <label style={styles.monthLabel}><CalendarDays size={13} /> Payment month</label>
        <select className="input-base" value={month} onChange={e => setMonth(e.target.value)}
          style={{ maxWidth: 240, padding: '6px 9px', fontSize: 12.5 }}>
          <option value="all">All outstanding ({rows.length})</option>
          {months.map(m => <option key={m} value={m}>{monthLabelOf(m)}</option>)}
        </select>
        <span style={styles.monthHint}>{formatCurrency(summary.totalDue)} outstanding in total</span>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center' }}><Loader /></div>
      ) : grouped.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 12px' }}>
          <CheckCircle2 size={30} color="#16a34a" style={{ opacity: 0.7 }} />
          <h3>Nothing to pay here</h3>
          <p>No unpaid supplier credit in this period.</p>
        </div>
      ) : (

        grouped.map(group => (
          <div key={group.supplier_id ?? group.supplier} style={styles.supplierBlock}>
            <div style={styles.supplierHead}>
              <span style={styles.supplierName}><Truck size={13} /> {group.supplier}</span>
              <span style={styles.supplierTotal}>
                {formatCurrency(group.total_due)}
                {group.overdue_amount > 0 && (
                  <em style={{ color: '#dc2626', fontStyle: 'normal', marginLeft: 6 }}>
                    ({formatCurrency(group.overdue_amount)} overdue)
                  </em>
                )}
              </span>
            </div>

            {group.purchases.map(row => (
              <div key={row.id} style={styles.bill}>
                <div style={styles.billTop}>
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.billNo}>
                      {row.invoice_number || `BILL-${String(row.id).padStart(6, '0')}`}
                    </div>
                    <div style={styles.billMeta}>
                      {row.due_date ? `Due ${formatDate(row.due_date)}` : 'No due date set'}
                      {' · '}Balance <strong>{formatCurrency(row.balance)}</strong>
                      {row.paid_amount > 0 && ` of ${formatCurrency(row.total_amount)}`}
                    </div>
                  </div>
                  <div style={styles.billActions}>
                    <CreditStatusPill status={row.credit_status} daysRemaining={row.days_remaining} />
                    <Button size="sm" variant="secondary"
                      onClick={() => { setPayingId(payingId === row.id ? null : row.id); setDateEditId(null) }}>
                      Pay
                    </Button>
                    <Button size="sm" variant="ghost"
                      onClick={() => {
                        setDateEditId(dateEditId === row.id ? null : row.id)
                        setDraftDate(row.due_date || todayStr())
                        setPayingId(null)
                      }}>
                      Set date
                    </Button>
                  </div>
                </div>

                {dateEditId === row.id && (
                  <div style={styles.dateRow}>
                    <label style={styles.monthLabel}><CalendarDays size={12} /> Date to pay</label>
                    <input className="input-base" type="date" value={draftDate}
                      onChange={e => setDraftDate(e.target.value)}
                      style={{ maxWidth: 170, padding: '6px 9px', fontSize: 12.5 }} />
                    <Button size="sm" loading={savingId === row.id} onClick={() => saveDueDate(row)}>Save</Button>
                  </div>
                )}

                {payingId === row.id && (
                  <PurchasePaymentForm purchase={row} onPaid={afterChange} onCancel={() => setPayingId(null)} />
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </Modal>
  )
}

const styles = {
  banner: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', borderRadius: 10,
    background: '#f9fafb', border: '1px solid #e5e7eb', marginBottom: 14,
  },
  bannerText: { fontSize: 12.5, color: 'var(--text-secondary)' },
  bannerSub: { fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 },
  chips: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
  chip: {
    display: 'flex', flexDirection: 'column', gap: 2,
    padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb',
  },
  chipLabel: { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' },
  chipSub: { fontSize: 11, color: 'var(--text-muted)' },
  pickerRow: { display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 6px', flexWrap: 'wrap' },
  monthLabel: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' },
  monthHint: { fontSize: 11.5, color: 'var(--text-muted)' },
  supplierBlock: { border: '1px solid var(--card-border)', borderRadius: 10, marginTop: 12, overflow: 'hidden' },
  supplierHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
    padding: '9px 12px', background: '#f9fafb', borderBottom: '1px solid var(--card-border)',
  },
  supplierName: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' },
  supplierTotal: { fontSize: 12.5, fontWeight: 700, fontFamily: 'Outfit, sans-serif' },
  bill: { padding: '10px 12px', borderBottom: '1px solid #f3f4f6' },
  billTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  billNo: { fontSize: 12.5, fontWeight: 600, fontFamily: 'monospace', color: '#f97316' },
  billMeta: { fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 },
  billActions: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  dateRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  linkBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
    cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Sans, sans-serif', padding: 0,
  },
  error: {
    fontSize: 12, color: '#dc2626', background: '#fef2f2',
    border: '1px solid #fecaca', borderRadius: 7, padding: '7px 10px', marginTop: 8,
  },
}

export default CreditDuePopup

