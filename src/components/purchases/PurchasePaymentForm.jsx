import React, { useState } from 'react'
import { CalendarDays, Wallet } from 'lucide-react'
import Button from '../shared/Button'
import { formatCurrency } from '../../utils/formatters'
import { todayStr } from '../../utils/dateRange'
import { purchasesService } from '../../services/purchasesService'
import { useAuth } from '../../context/AuthContext'

// Payment methods a supplier bill can be settled with. 'credit' makes no sense
// here (paying a bill with credit), so it is deliberately absent.
const SUPPLIER_PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'cheque']

/**
 * Records a payment against a credit purchase. The date field is the "date to
 * pay" — it defaults to today but the owner can back-date or forward-date it.
 */
const PurchasePaymentForm = ({ purchase, onPaid, onCancel }) => {
  const { businessId } = useAuth()
  const [amount, setAmount]   = useState(purchase?.balance ?? '')
  const [method, setMethod]   = useState('cash')
  const [payDate, setPayDate] = useState(todayStr())
  const [notes, setNotes]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await purchasesService.recordPayment({
        purchaseId: purchase.id,
        amount,
        paymentMethod: method,
        paymentDate: payDate,
        notes: notes.trim() || null,
        businessId,
      })
      if (onPaid) await onPaid()
    } catch (err) {
      setError(err.message || 'Could not record the payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} style={styles.form}>
      <div style={styles.grid}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Amount *</label>
          <input
            className="input-base"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder={String(purchase?.balance ?? '')}
            required
          />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Method</label>
          <select className="input-base" value={method} onChange={e => setMethod(e.target.value)}>
            {SUPPLIER_PAYMENT_METHODS.map(m => (
              <option key={m} value={m}>{m.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <CalendarDays size={12} /> Date to pay *
          </label>
          <input
            className="input-base"
            type="date"
            value={payDate}
            onChange={e => setPayDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="form-group" style={{ margin: 0 }}>
        <label>Notes</label>
        <input
          className="input-base"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Cheque no., reference…"
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={styles.hint}>
          <Wallet size={12} style={{ verticalAlign: -2 }} />{' '}
          Outstanding: <strong>{formatCurrency(purchase?.balance || 0)}</strong>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {onCancel && <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" size="sm" loading={saving} style={{ background: '#22c55e', border: 'none' }}>
            Record Payment
          </Button>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}
    </form>
  )
}

const styles = {
  form: {
    display: 'flex', flexDirection: 'column', gap: 10,
    padding: '12px 14px', marginTop: 8,
    background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
  hint: { fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Sans, sans-serif' },
  error: {
    fontSize: 12, color: '#dc2626', background: '#fef2f2',
    border: '1px solid #fecaca', borderRadius: 7, padding: '7px 10px',
  },
}

export default PurchasePaymentForm
