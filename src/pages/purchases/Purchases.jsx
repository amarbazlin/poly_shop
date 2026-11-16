import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Trash2, Edit2, AlertTriangle, CalendarDays, CheckCircle2,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useRBAC } from '../../context/RBACContext'
import { P } from '../../utils/permissions'
import { supplierService } from '../../services/supplierService'
import { purchasesService, todayISO, monthLabelOf } from '../../services/purchasesService'
import Modal from '../../components/shared/Modal'
import Button from '../../components/shared/Button'
import SearchBar from '../../components/shared/SearchBar'
import Loader from '../../components/shared/Loader'
import {
  CreditDueBanner, CreditDuePopup, CreditStatusPill, useSupplierCredit,
} from '../../components/purchases/CreditDueReminder'
import PurchasePaymentForm from '../../components/purchases/PurchasePaymentForm'
import PurchaseForm from './PurchaseForm'
import { formatCurrency, formatDate } from '../../utils/formatters'

const STORAGE_KEY = 'forgera:supplier-credit-popup'

const billNoOf = (p) => p.invoice_number || `BILL-${String(p.id).padStart(6, '0')}`

const Purchases = () => {
  const { user, businessId } = useAuth()
  const { can } = useRBAC()
  const canView   = can(P.VIEW_PURCHASES)
  const canManage = can(P.MANAGE_PURCHASES)

  const [purchases, setPurchases] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')

  const [search, setSearch]                 = useState('')
  const [typeFilter, setTypeFilter]         = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('all')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [saving, setSaving]     = useState(false)
  const [paying, setPaying]     = useState(null)
  const [creditOpen, setCreditOpen] = useState(false)
  const [dueEditId, setDueEditId] = useState(null)
  const [dueDraft, setDueDraft]   = useState('')

  const credit = useSupplierCredit({ enabled: canView })

  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const [rows, sups] = await Promise.all([
        purchasesService.getAll({ businessId, limit: 500 }),
        supplierService.getAll({ businessId, status: 'active' }),
      ])
      setPurchases(rows)
      setSuppliers(sups || [])
    } catch (err) {
      setError(err.message || 'Could not load purchases')
    } finally {
      setLoading(false)
    }
  }, [businessId, canView])

  useEffect(() => { load() }, [load])

  const refreshAll = async () => { await load(); await credit.reload() }

  // Shout once per browser session when a supplier bill is overdue or near due.
  const alertedRef = useRef(false)
  useEffect(() => {
    if (alertedRef.current || credit.loading || !canView) return
    alertedRef.current = true
    const urgent = credit.summary.overdueCount + credit.summary.dueSoonCount
    if (urgent === 0) return
    if (sessionStorage.getItem(STORAGE_KEY) === todayISO()) return
    sessionStorage.setItem(STORAGE_KEY, todayISO())
    setCreditOpen(true)
  }, [credit.loading, credit.summary.overdueCount, credit.summary.dueSoonCount, canView])

  // ── This-month position ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const month = todayISO().slice(0, 7)
    const inMonth = purchases.filter(p => String(p.created_at || '').slice(0, 7) === month)
    const sum = (list, pick) => list.reduce((s, p) => s + pick(p), 0)
    const outstanding = purchases.filter(p => p.is_credit && !p.is_settled)
    return {
      monthLabel: monthLabelOf(month),
      monthTotal:  sum(inMonth, p => p.total_amount),
      monthCash:   sum(inMonth.filter(p => !p.is_credit), p => p.total_amount),
      monthCredit: sum(inMonth.filter(p => p.is_credit), p => p.total_amount),
      monthCount:  inMonth.length,
      outstanding: sum(outstanding, p => p.balance),
      outstandingCount: outstanding.length,
    }
  }, [purchases])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return purchases.filter(p => {
      if (typeFilter !== 'all' && (p.payment_type || 'cash') !== typeFilter) return false
      if (supplierFilter !== 'all' && String(p.supplier_id) !== String(supplierFilter)) return false
      if (!q) return true
      return billNoOf(p).toLowerCase().includes(q)
        || String(p.suppliers?.supplier_name || '').toLowerCase().includes(q)
        || String(p.notes || '').toLowerCase().includes(q)
    })
  }, [purchases, search, typeFilter, supplierFilter])

  // ── Actions ────────────────────────────────────────────────────────────────
  const openAdd  = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (p) => { setEditing(p); setFormOpen(true) }

  const handleSave = async (values) => {
    setSaving(true)
    try {
      if (editing?.id) {
        await purchasesService.update(editing.id, {
          supplier_id:        parseInt(values.supplierId),
          invoice_number:     values.invoiceNumber,
          total_amount:       values.totalAmount,
          payment_type:       values.paymentType,
          credit_period_days: values.creditPeriodDays,
          due_date:           values.dueDate,
          notes:              values.notes,
        })
      } else {
        await purchasesService.create({ ...values, businessId, createdBy: user?.id })
      }
      setFormOpen(false)
      setEditing(null)
      await refreshAll()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete purchase ${billNoOf(p)}? Any recorded payments go with it.`)) return
    await purchasesService.remove(p.id)
    await refreshAll()
  }

  const setDueDate = async (p, date) => {
    await purchasesService.updateDueDate(p.id, date)
    await refreshAll()
  }

  if (!canView) {
    return (
      <div className="page-wrapper">
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <AlertTriangle size={32} color="#f59e0b" style={{ opacity: 0.6 }} />
          <h3 style={{ marginTop: 12 }}>Purchases are restricted</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Your role does not have access to supplier purchases.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchases</h1>
          <p className="page-subtitle">
            {stats.monthCount} record{stats.monthCount === 1 ? '' : 's'} in {stats.monthLabel} · {formatCurrency(stats.monthTotal)} spent
            {stats.outstanding > 0 && ` · ${formatCurrency(stats.outstanding)} owed to suppliers`}
          </p>
        </div>
        {canManage && <Button icon={<Plus size={15} />} onClick={openAdd}>Record Purchase</Button>}
      </div>

      <CreditDueBanner credit={credit} onOpen={() => setCreditOpen(true)} />

      {/* This-month position */}
      <div style={styles.statGrid}>
        <div style={styles.stat}>
          <span style={styles.statLabel}>Purchases in {stats.monthLabel}</span>
          <span style={styles.statValue}>{formatCurrency(stats.monthTotal)}</span>
          <span style={styles.statHint}>{stats.monthCount} bill{stats.monthCount === 1 ? '' : 's'}</span>
        </div>
        <div style={{ ...styles.stat, borderColor: '#bbf7d0', background: '#f0fdf4' }}>
          <span style={{ ...styles.statLabel, color: '#16a34a' }}>Paid cash</span>
          <span style={{ ...styles.statValue, color: '#16a34a' }}>{formatCurrency(stats.monthCash)}</span>
          <span style={styles.statHint}>Settled at purchase</span>
        </div>
        <div style={{ ...styles.stat, borderColor: '#fed7aa', background: '#fff7ed' }}>
          <span style={{ ...styles.statLabel, color: '#c2410c' }}>Bought on credit</span>
          <span style={{ ...styles.statValue, color: '#c2410c' }}>{formatCurrency(stats.monthCredit)}</span>
          <span style={styles.statHint}>{formatCurrency(stats.outstanding)} outstanding</span>
        </div>
        <div style={{
          ...styles.stat,
          borderColor: credit.summary.overdueAmount > 0 ? '#fecaca' : undefined,
          background:  credit.summary.overdueAmount > 0 ? '#fef2f2' : undefined,
        }}>
          <span style={{ ...styles.statLabel, color: credit.summary.overdueAmount > 0 ? '#dc2626' : undefined }}>Overdue</span>
          <span style={{ ...styles.statValue, color: credit.summary.overdueAmount > 0 ? '#dc2626' : undefined }}>
            {formatCurrency(credit.summary.overdueAmount)}
          </span>
          <span style={styles.statHint}>
            {credit.summary.overdueCount} bill{credit.summary.overdueCount === 1 ? '' : 's'} past due
          </span>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Toolbar */}
      <div style={styles.toolbar}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search bill no, supplier, notes…" width={280} />
        <select className="input-base" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={styles.select}>
          <option value="all">All payments</option>
          <option value="cash">Cash only</option>
          <option value="credit">Credit only</option>
        </select>
        <select className="input-base" value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} style={styles.select}>
          <option value="all">All suppliers</option>
          {suppliers.map(s => <option key={s.id} value={String(s.id)}>{s.supplier_name}</option>)}
        </select>
        <span style={styles.count}>{filtered.length} of {purchases.length} bills</span>
      </div>

      {/* Purchase records */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}><Loader /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 16px' }}>
            <CheckCircle2 size={30} color="#16a34a" style={{ opacity: 0.7 }} />
            <h3>No purchases found</h3>
            <p>{purchases.length === 0 ? 'Record your first purchase to get started.' : 'No bills match the current filters.'}</p>
          </div>
        ) : (
          <div className="table-scroll-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Payment</th>
                  <th>Due</th>
                  <th style={{ textAlign: 'right' }}>Paid</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const openCredit = p.is_credit && !p.is_settled
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{billNoOf(p)}</strong>
                        {p.notes && <div style={styles.sub}>{String(p.notes).slice(0, 40)}</div>}
                      </td>
                      <td>{p.created_at ? formatDate(p.created_at) : '—'}</td>
                      <td>{p.suppliers?.supplier_name || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(p.total_amount)}</td>
                      <td>
                        <span style={p.is_credit ? styles.pillCredit : styles.pillCash}>
                          {p.is_credit ? 'Credit' : 'Cash'}
                        </span>
                      </td>
                      <td>
                        {openCredit ? (
                          dueEditId === p.id ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <input className="input-base" type="date" value={dueDraft}
                                onChange={e => setDueDraft(e.target.value)}
                                style={{ padding: '3px 6px', fontSize: 11.5, maxWidth: 145 }} />
                              <button type="button" title="Save pay-by date" disabled={saving}
                                onClick={async () => { await setDueDate(p, dueDraft); setDueEditId(null) }}
                                style={styles.saveDateBtn}>
                                <CheckCircle2 size={13} />
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <CreditStatusPill status={p.credit_status} daysRemaining={p.days_remaining} />
                              <span style={styles.sub}>{p.due_date ? formatDate(p.due_date) : 'No date'}</span>
                              {canManage && (
                                <button type="button" title="Set pay-by date"
                                  onClick={() => { setDueEditId(p.id); setDueDraft(p.due_date || todayISO()) }}
                                  style={styles.iconBtn}>
                                  <CalendarDays size={12} />
                                </button>
                              )}
                            </div>
                          )
                        ) : (
                          <span style={styles.sub}>{p.is_credit ? 'Settled' : '—'}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(p.paid_amount)}</td>
                      <td style={{
                        textAlign: 'right', fontWeight: 700,
                        color: openCredit && p.credit_status === 'overdue' ? '#dc2626' : undefined,
                      }}>
                        {openCredit ? formatCurrency(p.balance) : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {openCredit && canManage && (
                            <Button size="sm" variant="primary" onClick={() => setPaying(p)}>Pay</Button>
                          )}
                          {canManage && (
                            <button type="button" style={styles.iconBtn} title="Edit" onClick={() => openEdit(p)}>
                              <Edit2 size={13} />
                            </button>
                          )}
                          {canManage && (
                            <button type="button" style={{ ...styles.iconBtn, color: '#dc2626' }} title="Delete"
                              onClick={() => handleDelete(p)}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / edit purchase */}
      <Modal open={formOpen} onClose={() => { setFormOpen(false); setEditing(null) }}
        title={editing ? `Edit ${billNoOf(editing)}` : 'Record Purchase'} width={640}>
        <PurchaseForm initial={editing} suppliers={suppliers} onSave={handleSave}
          onCancel={() => { setFormOpen(false); setEditing(null) }} saving={saving} />
      </Modal>

      {/* Pay (part of) a credit bill */}
      <Modal open={!!paying} onClose={() => setPaying(null)}
        title={paying ? `Pay ${billNoOf(paying)}` : 'Pay bill'} width={560}>
        {paying && (
          <PurchasePaymentForm purchase={paying}
            onPaid={async () => { setPaying(null); await refreshAll() }}
            onCancel={() => setPaying(null)} />
        )}
      </Modal>

      {/* Credit reminder popup */}
      <CreditDuePopup open={creditOpen} onClose={() => setCreditOpen(false)} credit={credit}
        onChanged={refreshAll} />
    </div>
  )
}

export default Purchases

const styles = {
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 14,
    marginBottom: 18,
  },
  stat: {
    background: 'var(--card-bg)',
    border: '1.5px solid var(--card-border)',
    borderRadius: 12,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  statLabel: { fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  statValue: { fontFamily: 'Outfit, sans-serif', fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' },
  statHint:  { fontSize: 11.5, color: 'var(--text-muted)' },
  error: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#dc2626',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 13,
    marginBottom: 16,
  },
  toolbar: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  select: { maxWidth: 200, padding: '7px 9px', fontSize: 12.5 },
  count:  { fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' },
  sub:    { fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 },
  pillCash: {
    display: 'inline-block', padding: '2px 9px', borderRadius: 999,
    background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
    fontSize: 11, fontWeight: 700,
  },
  pillCredit: {
    display: 'inline-block', padding: '2px 9px', borderRadius: 999,
    background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa',
    fontSize: 11, fontWeight: 700,
  },
  iconBtn: {
    width: 26, height: 26, borderRadius: 6,
    border: '1px solid var(--card-border)', background: 'var(--card-bg)',
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-secondary)', flexShrink: 0,
  },
  saveDateBtn: {
    width: 26, height: 26, borderRadius: 6, border: '1px solid #bbf7d0',
    background: '#f0fdf4', color: '#16a34a', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
}

