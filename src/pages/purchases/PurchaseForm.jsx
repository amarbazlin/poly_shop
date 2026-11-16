import React, { useEffect, useState } from 'react'
import { Banknote, CreditCard } from 'lucide-react'
import Button from '../../components/shared/Button'
import { dueDateFromPeriod } from '../../services/purchasesService'
import { todayStr } from '../../utils/dateRange'

const CREDIT_PERIOD_PRESETS = [7, 14, 30, 60, 90]

// ── Record / edit a purchase ─────────────────────────────────────────────────
const PurchaseForm = ({ initial = null, suppliers = [], onSave, onCancel, saving }) => {
  const editing = Boolean(initial?.id)
  const [supplierId, setSupplierId] = useState(initial?.supplier_id ? String(initial.supplier_id) : '')
  const [invoice,    setInvoice]    = useState(initial?.invoice_number || '')
  const [amount,     setAmount]     = useState(initial?.total_amount ?? '')
  const [paymentType, setPaymentType] = useState(initial?.payment_type || 'cash')
  const [purchaseDate, setPurchaseDate] = useState(
    initial?.created_at ? String(initial.created_at).slice(0, 10) : todayStr(),
  )
  const [creditDays, setCreditDays] = useState(String(initial?.credit_period_days ?? 30))
  const [dueDate,    setDueDate]    = useState(String(initial?.due_date || '').slice(0, 10))
  const [dueTouched, setDueTouched] = useState(Boolean(initial?.due_date))
  const [notes,      setNotes]      = useState(initial?.notes || '')
  const [error,      setError]      = useState('')

  const isCredit = paymentType === 'credit'

  // Keep the due date in step with the agreed credit period until the owner
  // overrides it by hand — after that their date always wins.
  useEffect(() => {
    if (!isCredit || dueTouched) return
    setDueDate(dueDateFromPeriod(purchaseDate, creditDays) || '')
  }, [isCredit, dueTouched, purchaseDate, creditDays])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!supplierId)                return setError('Select the supplier this purchase was made from')
    if (!(parseFloat(amount) > 0))  return setError('Enter the purchase amount')

    try {
      await onSave({
        supplierId,
        invoiceNumber: invoice.trim() || null,
        totalAmount: parseFloat(amount),
        paymentType,
        creditPeriodDays: isCredit ? (parseInt(creditDays) || 0) : 0,
        dueDate: isCredit ? (dueDate || null) : null,
        purchaseDate,
        notes: notes.trim() || null,
      })
    } catch (err) {
      setError(err.message || 'Could not save the purchase')
    }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div className="form-group">
          <label>Supplier *</label>
          <select className="input-base" value={supplierId} onChange={e => setSupplierId(e.target.value)} required>
            <option value="">Select supplier…</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Bill / Invoice No.</label>
          <input className="input-base" value={invoice} onChange={e => setInvoice(e.target.value)} placeholder="SUP-00123" />
        </div>

        <div className="form-group">
          <label>Amount *</label>
          <input className="input-base" type="number" min="0" step="0.01" value={amount}
            onChange={e => setAmount(e.target.value)} placeholder="0.00" required />
        </div>
        <div className="form-group">
          <label>Purchase Date</label>
          <input className="input-base" type="date" value={purchaseDate} max={todayStr()}
            onChange={e => setPurchaseDate(e.target.value)} />
        </div>
      </div>

      {/* Cash vs credit — the crux of the record */}
      <div className="form-group">
        <label>Payment</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { value: 'cash',   label: 'Cash / Paid now',    icon: Banknote },
            { value: 'credit', label: 'Credit (pay later)', icon: CreditCard },
          ].map(opt => {
            const active = paymentType === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPaymentType(opt.value)}
                style={{
                  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
                  fontSize: 13, fontWeight: 600, fontFamily: 'DM Sans, sans-serif',
                  border: active ? '1.5px solid #f97316' : '1.5px solid var(--card-border)',
                  background: active ? '#fff7ed' : 'var(--card-bg)',
                  color: active ? '#c2410c' : 'var(--text-secondary)',
                }}
              >
                <opt.icon size={14} />{opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {isCredit && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#c2410c', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Credit terms
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div className="form-group">
              <label>Credit period (days)</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                {CREDIT_PERIOD_PRESETS.map(d => {
                  const active = String(d) === String(creditDays)
                  return (
                    <button key={d} type="button" onClick={() => { setCreditDays(String(d)); setDueTouched(false) }}
                      style={{
                        padding: '4px 10px', borderRadius: 99, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
                        border: active ? '1px solid #f97316' : '1px solid #fde68a',
                        background: active ? '#f97316' : '#fff',
                        color: active ? '#fff' : '#c2410c',
                      }}>
                      {d}d
                    </button>
                  )
                })}
              </div>
              <input className="input-base" type="number" min="0" value={creditDays}
                onChange={e => { setCreditDays(e.target.value); setDueTouched(false) }} />
            </div>
            <div className="form-group">
              <label>Payment due date</label>
              <input className="input-base" type="date" value={dueDate}
                onChange={e => { setDueDate(e.target.value); setDueTouched(true) }} />
              <div style={{ fontSize: 11, color: '#c2410c', marginTop: 4 }}>
                This is the date the credit engine reminds you to pay.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="form-group">
        <label>Notes</label>
        <input className="input-base" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Goods received, GRN no., remarks…" />
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '7px 10px', marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={saving}>{editing ? 'Save Changes' : 'Record Purchase'}</Button>
      </div>
    </form>
  )
}

export default PurchaseForm

