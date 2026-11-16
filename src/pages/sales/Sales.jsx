import React, { useState, useEffect } from 'react'
import { Plus, ShoppingCart, ScanLine, ChevronDown, ChevronUp, Package, RotateCcw, X, CheckCircle, Printer } from 'lucide-react'
import { useSales, useSalesSummary } from '../../hooks/useSales'
import { salesService, itemProfit } from '../../services/salesService'
import { pricingService } from '../../services/pricingService'
import { useAuth } from '../../context/AuthContext'
import { useProducts } from '../../hooks/useProducts'
import { customerService } from '../../services/customerService'
import { CustomerSelect } from '../../components/customers/CustomerSelect'
import BarcodeScanner from '../../components/barcode/BarcodeScanner'
import Modal from '../../components/shared/Modal'
import Button from '../../components/shared/Button'
import SearchBar from '../../components/shared/SearchBar'
import Loader from '../../components/shared/Loader'
import { formatCurrency, formatDate, formatCurrencyShort } from '../../utils/formatters'
import { printSaleReceipt } from '../../services/receiptService'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { PAYMENT_METHODS } from '../../utils/constants'
import DateRangeFilter from '../../components/shared/DateRangeFilter'
import { useDateRangeFilter } from '../../hooks/useDateRangeFilter'
import { formatRangeLabel, todayStr } from '../../utils/dateRange'
import { useCustomers } from '../../hooks/useCustomers'

// ── Sale Modal Component ──────────────────────────────────────────────────────
const SaleModal = ({ open, onClose, onCreated, customer, setCustomer, items, setItems, products, paymentMethod, setPaymentMethod }) => {
  const { user } = useAuth()
  const [isCredit,       setIsCredit]       = useState(false)
  const [scannerOpen,    setScannerOpen]    = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [discount,       setDiscount]       = useState(0)

  // When customer changes, re-price all items
  useEffect(() => {
    if (!customer || items.every(i => !i.product_id)) return
    const repriceItems = async () => {
      const priced = await pricingService.resolvePriceBatch(
        customer.id,
        items.filter(i => i.product_id).map(i => {
          const p = products.find(p => p.id === parseInt(i.product_id))
          return { ...p, id: i.product_id }
        })
      )
      setItems(prev => prev.map((item, idx) => {
        const resolved = priced.find(p => String(p.id) === String(item.product_id))
        if (!resolved) return item
        const up = resolved.resolved_price
        return { ...item, unit_price: up, subtotal: item.quantity * up }
      }))
    }
    repriceItems()
  }, [customer?.id])

  const updateItem = async (idx, field, val) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: val }
      if (field === 'product_id') {
        const p = products.find(p => p.id === parseInt(val))
        updated.unit_price = p?.selling_price || 0
        updated.subtotal   = updated.quantity * (p?.selling_price || 0)
      }
      if (field === 'quantity' || field === 'unit_price') {
        const q = field === 'quantity' ? parseFloat(val) : item.quantity
        const u = field === 'unit_price' ? parseFloat(val) : item.unit_price
        updated.subtotal = q * u
      }
      return updated
    }))
    // Apply customer pricing when product changes
    if (field === 'product_id' && customer?.id && val) {
      const p = products.find(p => p.id === parseInt(val))
      if (p) {
        const resolved = await pricingService.resolvePrice(customer.id, parseInt(val), p.selling_price)
        setItems(prev => prev.map((item, i) => {
          if (i !== idx) return item
          return { ...item, unit_price: resolved, subtotal: item.quantity * resolved }
        }))
      }
    }
  }

  const handleBarcodeScan = (code) => {
    setScannerOpen(false)
    const product = products.find(p =>
      p.product_code === code || p.product_code?.replace(/-/g, '') === code.replace(/-/g, '')
    )
    if (!product) { alert(`No product found for barcode: ${code}`); return }
    const existIdx = items.findIndex(i => String(i.product_id) === String(product.id))
    if (existIdx >= 0) {
      setItems(prev => prev.map((item, i) => {
        if (i !== existIdx) return item
        const qty = item.quantity + 1
        return { ...item, quantity: qty, subtotal: qty * item.unit_price }
      }))
    } else {
      setItems(prev => {
        const blank = prev.findIndex(i => !i.product_id)
        const newItem = { product_id: String(product.id), quantity: 1, unit_price: product.selling_price, subtotal: product.selling_price }
        if (blank >= 0) return prev.map((item, i) => i === blank ? newItem : item)
        return [...prev, newItem]
      })
    }
  }

  const removeItem  = (idx) => setItems(i => i.filter((_, ii) => ii !== idx))
  const subtotal    = items.reduce((s, i) => s + parseFloat(i.subtotal || 0), 0)
  const total       = Math.max(0, subtotal - parseFloat(discount || 0))

  const handleSubmit = async () => {
    if (items.some(i => !i.product_id || i.quantity < 1)) return alert('Fill all items')
    if (isCredit && !customer) return alert('Select a customer for credit sales')
    setSaving(true)
    try {
      const saleItems = items.map(i => ({ ...i, product_id: parseInt(i.product_id) }))
      await salesService.create({
        items: saleItems,
        paymentMethod: isCredit ? 'credit' : paymentMethod,
        soldBy: user?.id,
        customerId: customer?.id || null,
        discountAmount: parseFloat(discount || 0),
        isCredit,
      })

      if (isCredit && customer?.id) {
        await customerService.addToBalance(customer.id, total)
      }

      setItems([{ product_id: '', quantity: 1, unit_price: 0, subtotal: 0 }])
      setCustomer(null); setDiscount(0); setIsCredit(false)
      onCreated()
      onClose()
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="New Sale" width={680}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ fontFamily: 'Outfit,sans-serif', fontSize: 15, fontWeight: 800 }}>
              Total: <span style={{ color: '#f97316' }}>{formatCurrency(total)}</span>
              {discount > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>({formatCurrency(parseFloat(discount))} off)</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button loading={saving} onClick={handleSubmit}>Create Sale</Button>
            </div>
          </div>
        }
      >
        <div className="form-group">
          <label>Customer</label>
          <CustomerSelect value={customer} onChange={setCustomer} />
          {customer?.price_tiers?.discount_percent > 0 && (
            <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>
              ✓ {customer.price_tiers.discount_percent}% tier discount applied
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ margin: 0 }}>Items</label>
          <button onClick={() => setScannerOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: '1px solid var(--card-border)', background: '#0d1117', color: '#f97316', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            <ScanLine size={13} /> Scan Barcode
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 70px 110px 100px 22px', gap: 6, marginBottom: 6 }}>
          {['Product', 'Qty', 'Unit Price', 'Subtotal', ''].map(h => (
            <span key={h} style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{h}</span>
          ))}
        </div>
        {items.map((item, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 70px 110px 100px 22px', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <select className="input-base" value={item.product_id} onChange={e => updateItem(idx, 'product_id', e.target.value)}>
              <option value="">Select product</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.product_name} (stock: {p.quantity})</option>)}
            </select>
            <input className="input-base" type="number" min="1" value={item.quantity} onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)} />
            <input className="input-base" type="number" step="0.01" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} />
            <div style={{ fontFamily: 'Outfit,sans-serif', fontWeight: 700, fontSize: 13, textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(item.subtotal)}</div>
            {items.length > 1 && <button onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, lineHeight: 1 }}>×</button>}
          </div>
        ))}
        <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => setItems(i => [...i, { product_id: '', quantity: 1, unit_price: 0, subtotal: 0 }])}>
          Add Item
        </Button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--card-border)' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Discount (Rs.)</label>
            <input className="input-base" type="number" min="0" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Payment Method</label>
            <select className="input-base" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} disabled={isCredit}>
              {PAYMENT_METHODS.filter(m => m !== 'credit').map(m => <option key={m} value={m}>{m.replace('_',' ')}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-end', paddingBottom: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>
              <input type="checkbox" checked={isCredit} onChange={e => setIsCredit(e.target.checked)} />
              Credit sale
            </label>
          </div>
        </div>

        {isCredit && customer && customer.credit_limit > 0 && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12.5, color: '#92400e' }}>
            Credit limit: {formatCurrency(customer.credit_limit)} · Current balance: {formatCurrency(customer.current_balance)} · After this sale: {formatCurrency((customer.current_balance || 0) + total)}
          </div>
        )}
      </Modal>

      <BarcodeScanner isOpen={scannerOpen} onScan={handleBarcodeScan} onClose={() => setScannerOpen(false)} />
    </>
  )
}

// ── Return Processing Inline Panel ─────────────────────────────────────────────
const ReturnPanel = ({ sale, onClose, onProcessed }) => {
  const { user, businessId } = useAuth()
  const [items, setItems] = useState(
    (sale.sales_items || []).map(item => ({
      // product_id is the FK we restock against; fall back to the joined
      // product row so older cached payloads still return their stock.
      product_id: item.product_id ?? item.products?.id,
      product_name: item.products?.product_name || 'Unknown',
      quantity: 0,
      maxQuantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: 0,
    }))
  )
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [returnedByProduct, setReturnedByProduct] = useState(null)

  // The invoice is never shrunk on a return, so the cap on a new return is
  // "what the invoice sold" minus "what earlier returns already took back".
  useEffect(() => {
    let active = true
    salesService.getReturnedQuantities(sale.id)
      .then(acc => { if (active) setReturnedByProduct(acc) })
      .catch(() => { if (active) setReturnedByProduct({}) })
    return () => { active = false }
  }, [sale.id])

  const alreadyReturnedFor = (item) => (returnedByProduct || {})[String(parseInt(item.product_id))] || 0
  const remainingFor       = (item) => Math.max(0, (parseInt(item.maxQuantity) || 0) - alreadyReturnedFor(item))

  const updateQty = (idx, val) => {
    const qty = Math.min(Math.max(0, parseInt(val) || 0), remainingFor(items[idx]))
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      return { ...item, quantity: qty, subtotal: qty * item.unit_price }
    }))
  }

  const totalReturn = items.reduce((s, i) => s + i.subtotal, 0)
  const hasItems = items.some(i => i.quantity > 0)

  const handleProcessReturn = async () => {
    if (!hasItems) return alert('Select at least one product to return')
    if (!reason.trim()) return alert('Please provide a reason for the return')
    setSaving(true)
    try {
      const returnItems = items
        .filter(i => i.quantity > 0)
        .map(i => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          subtotal: i.subtotal,
          condition: 'good',
        }))

      const ret = await salesService.processReturn({
        originalSaleId: sale.id,
        customerId: sale.customer_id,
        items: returnItems,
        reason: reason.trim(),
        processedBy: user?.id,
        businessId,
      })

      setResult({
        success: true,
        total: totalReturn,
        creditNoteNumber: ret?.credit_note_number || null,
      })
      if (onProcessed) onProcessed()
    } catch (err) {
      setResult({ success: false, error: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: '12px 16px', background: '#fafafa', borderTop: '1px solid #e5e7eb', borderRadius: 8, marginTop: 4 }}>
      {result?.success ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', color: '#16a34a' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
          <div>
            <strong style={{ fontSize: 14 }}>Return Processed</strong>
            <p style={{ fontSize: 12, marginTop: 2 }}>Refund value: {formatCurrency(result.total)} — Stock has been restored.</p>
            <p style={{ fontSize: 12, marginTop: 2, color: 'var(--text-secondary)' }}>
              Booked on <strong>today's</strong> sales{result.creditNoteNumber ? <> as credit note <strong>{result.creditNoteNumber}</strong></> : null}.
              {' '}Invoice <strong>{sale.invoice_number}</strong> keeps its original amount.
            </p>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={14} color="#9ca3af" />
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <RotateCcw size={14} color="#22c55e" /> Process Return — Invoice {sale.invoice_number}
            </h4>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
              <X size={14} color="#9ca3af" />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 100px 100px', gap: 6, marginBottom: 6, fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            <span>Product</span>
            <span style={{ textAlign: 'center' }}>Return Qty</span>
            <span style={{ textAlign: 'right' }}>Unit Price</span>
            <span style={{ textAlign: 'right' }}>Refund</span>
          </div>

          {items.map((item, idx) => {
            const remaining = remainingFor(item)
            const already   = alreadyReturnedFor(item)
            return (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 100px 100px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{item.product_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Max: {remaining}{already > 0 ? ` · ${already} already returned` : ''}
                  </div>
                </div>
                <input
                  className="input-base"
                  type="number"
                  min="0"
                  max={remaining}
                  value={item.quantity || ''}
                  onChange={e => updateQty(idx, e.target.value)}
                  disabled={remaining === 0}
                  style={{ textAlign: 'center', padding: '6px 8px' }}
                />
                <div style={{ fontFamily: 'Outfit,sans-serif', fontSize: 13, textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {formatCurrency(item.unit_price)}
                </div>
                <div style={{ fontFamily: 'Outfit,sans-serif', fontWeight: 700, fontSize: 13, textAlign: 'right', color: '#22c55e' }}>
                  {formatCurrency(item.subtotal)}
                </div>
              </div>
            )
          })}

          {returnedByProduct && items.length > 0 && items.every(i => remainingFor(i) === 0) && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 2px' }}>
              All items on this invoice have already been returned.
            </div>
          )}

          <div className="form-group" style={{ marginTop: 8 }}>
            <label style={{ fontSize: 12 }}>Reason for Return *</label>
            <input
              className="input-base"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Wrong item, defective, customer changed mind..."
              style={{ fontSize: 13 }}
            />
          </div>

          {result && !result.success && (
            <div style={{ color: '#dc2626', fontSize: 12.5, marginTop: 6, padding: '8px 12px', background: '#fef2f2', borderRadius: 6 }}>
              {result.error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb' }}>
            <div style={{ fontFamily: 'Outfit,sans-serif', fontSize: 16, fontWeight: 800, color: '#22c55e' }}>
              Total Refund: {formatCurrency(totalReturn)}
            </div>
            <Button
              loading={saving}
              onClick={handleProcessReturn}
              disabled={!hasItems || !reason.trim()}
              size="sm"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', border: 'none' }}
            >
              Process Return
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Mark as Paid Modal ─────────────────────────────────────────────────────────
const MarkAsPaidModal = ({ open, onClose, sale, onPaid }) => {
  const [saving, setSaving] = useState(false)

  const handleMarkPaid = async () => {
    setSaving(true)
    try {
      await salesService.markAsPaid(sale.id, sale.customer_id, sale.total_amount)
      onPaid()
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Mark Credit Sale as Paid" width={400}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={handleMarkPaid} style={{ background: '#22c55e', border: 'none' }}>
            Confirm Payment
          </Button>
        </div>
      }
    >
      <div style={{ padding: '8px 0' }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Mark invoice <strong>{sale?.invoice_number}</strong> as paid?
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Amount</span>
          <span style={{ fontFamily: 'Outfit,sans-serif', fontWeight: 700, fontSize: 16, color: '#16a34a' }}>
            {formatCurrency(sale?.total_amount || 0)}
          </span>
        </div>
        {sale?.customers?.name && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-muted)' }}>
            Customer: <strong>{sale.customers.name}</strong>
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
          This will mark the sale as paid and reduce the customer's outstanding balance.
        </p>
      </div>
    </Modal>
  )
}

// ── Expandable Sales Row Component ─────────────────────────────────────────────
const SalesRow = ({ sale, onReturnProcessed, onMarkPaid }) => {
  const { businessId } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [showMarkPaid, setShowMarkPaid] = useState(false)
  const [printing, setPrinting] = useState(false)

  // Refund credit notes are negative rows booked on the day the return was
  // processed. They are not invoices: nothing can be returned or marked paid.
  const isCreditNote = (parseFloat(sale.total_amount) || 0) < 0

  // Per-transaction profit — same math as the Sales & Profit summary
  // (itemProfit(): (unit_price − cost_price) × qty, minus any sale-level
  // discount_amount). Margin % is taken against the sale total, which is also
  // net of the discount, so both sides match (abs, so refund rows, where both
  // sides are negative, show a negative margin).
  const profit   = itemProfit(sale)
  const revenue  = Math.abs(parseFloat(sale.total_amount) || 0)
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0

  // Rebuild the exact bill from the loaded sale row and print it again.
  const handlePrintAgain = async (e) => {
    e.stopPropagation()
    if (printing) return
    setPrinting(true)
    try {
      const items = (sale.sales_items || []).map(i => ({
        code: i.products?.product_code || '',
        name: i.products?.product_name || 'Unknown Product',
        quantity: i.quantity,
        unit_price: i.unit_price,
        discount: 0,
        line_total: i.subtotal,
      }))
      const subtotal = items.reduce((s, i) => s + (parseFloat(i.line_total) || 0), 0)
      await printSaleReceipt({
        businessId,
        invoiceNumber: sale.invoice_number,
        date: sale.created_at,
        customerName: sale.customers?.name || 'Walk-In Customer',
        customerPhone: sale.customers?.phone || '',
        items,
        subtotal,
        discount: sale.discount_amount || 0,
        total: sale.total_amount,
        paymentMethod: sale.payment_method,
        cashReceived: null,
      })
    } catch (err) {
      console.error('Bill printing failed:', err)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <>
      <tr 
        onClick={() => { if (expanded && returnOpen) setReturnOpen(false); setExpanded(!expanded) }} 
        style={{ cursor: 'pointer', transition: 'background 0.2s' }}
        className={expanded ? 'row-expanded' : ''}
      >
        <td style={{ width: '40px', paddingRight: 0 }}>
          {expanded ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
        </td>
        <td>
          <span style={{ fontFamily: 'monospace', fontSize: 12.5, fontWeight: 600, color: isCreditNote ? '#dc2626' : '#f97316' }}>
            {sale.invoice_number}
          </span>
        </td>
        <td style={{ fontSize: 12.5 }}>
          {sale.customers?.name || <span style={{ color: 'var(--text-muted)' }}>Walk-in</span>}
        </td>
        <td style={{ fontSize: 12.5 }}>{formatDate(sale.created_at)}</td>
        <td style={{ fontSize: 12.5, fontWeight: 600 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Package size={13} color="#9ca3af" />
            {sale.sales_items?.length || 0} {sale.sales_items?.length === 1 ? 'item' : 'items'}
          </span>
        </td>
        <td>
          {isCreditNote ? (
            <span style={{ fontSize: 11.5, background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 99, fontWeight: 600, textTransform: 'capitalize' }}>
              Refund
            </span>
          ) : (
            <span style={{ fontSize: 11.5, background: sale.is_credit ? '#fff7ed' : '#f3f4f6', color: sale.is_credit ? '#f97316' : 'var(--text-secondary)', padding: '2px 8px', borderRadius: 99, fontWeight: 600, textTransform: 'capitalize' }}>
              {sale.is_credit ? 'Credit' : sale.payment_method}
            </span>
          )}
        </td>
        <td style={{ fontFamily: 'Outfit,sans-serif', fontWeight: 700, fontSize: 14, color: isCreditNote ? 'var(--danger)' : 'var(--success)' }}>
          {formatCurrency(sale.total_amount)}
        </td>
        <td style={{ fontFamily: 'Outfit,sans-serif', fontWeight: 700, fontSize: 14, color: profit >= 0 ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
          {formatCurrency(profit)}
          <div style={{ fontSize: 11, fontWeight: 600, color: profit >= 0 ? '#16a34a' : '#dc2626' }}>
            {marginPct.toFixed(1)}%
          </div>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {!isCreditNote && sale.is_credit && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowMarkPaid(true) }}
                title="Mark as paid"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 8px', borderRadius: 7,
                  border: '1px solid #bbf7d0', background: '#f0fdf4',
                  color: '#16a34a', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <CheckCircle size={12} />
                Mark Paid
              </button>
            )}
            {!isCreditNote && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const opening = !returnOpen
                  setReturnOpen(opening)
                  // Clicking Return pops the dropdown down so the sales items
                  // list (and the return panel under it) is visible immediately.
                  if (opening) setExpanded(true)
                }}
                title="Process return"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 8px', borderRadius: 7,
                  border: '1px solid #fecaca', background: '#fef2f2',
                  color: '#dc2626', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <RotateCcw size={12} />
                {returnOpen ? 'Close' : 'Return'}
              </button>
            )}
            {!isCreditNote && (
              <button
                onClick={handlePrintAgain}
                disabled={printing}
                title="Print the bill again"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 8px', borderRadius: 7,
                  border: '1px solid #e5e7eb', background: '#f9fafb',
                  color: '#374151', fontSize: 12, fontWeight: 600,
                  cursor: printing ? 'wait' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                  opacity: printing ? 0.6 : 1,
                }}
              >
                <Printer size={12} />
                Print Again
              </button>
            )}
          </div>
        </td>
      </tr>

      <MarkAsPaidModal open={showMarkPaid} onClose={() => setShowMarkPaid(false)} sale={sale} onPaid={onMarkPaid} />

      {/* Accordion Expansion Block */}
      {expanded && (
        <tr>
          <td colSpan={9} style={{ padding: '12px 24px', background: '#fafafa', borderTop: '1px solid #f0f0f0' }}>
            <div style={{ padding: '6px 12px', background: '#ffffff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Transaction Items Profile
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', paddingBottom: 6, borderBottom: '1px solid #f3f4f6', fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>
                <span>Product Name</span>
                <span style={{ textAlign: 'center' }}>Quantity</span>
                <span style={{ textAlign: 'right' }}>Unit Price</span>
                <span style={{ textAlign: 'right' }}>Subtotal</span>
              </div>
              
              {sale.sales_items && sale.sales_items.length > 0 ? (
                sale.sales_items.map((item) => (
                  <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '8px 0', borderBottom: '1px solid #f9fafb', fontSize: 12.5, color: 'var(--text-primary)', alignItems: 'center' }}>
                    <span style={{ fontWeight: 500 }}>
                      {item.products?.product_name || 'Unknown Product'}{' '}
                      <small style={{ fontFamily: 'monospace', color: '#9ca3af', marginLeft: 6 }}>
                        [{item.products?.product_code}]
                      </small>
                    </span>
                    <span style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                      {item.quantity} <small style={{ color: '#9ca3af' }}>{item.products?.unit || 'Pcs'}</small>
                    </span>
                    <span style={{ textAlign: 'right', fontFamily: 'Outfit,sans-serif' }}>
                      {formatCurrency(item.unit_price)}
                    </span>
                    <span style={{ textAlign: 'right', fontFamily: 'Outfit,sans-serif', fontWeight: 600 }}>
                      {formatCurrency(item.subtotal)}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  No individual line details found for this transaction log.
                </div>
              )}
            </div>

            {/* Return inline panel */}
            {returnOpen && (
              <ReturnPanel
                sale={sale}
                onClose={() => setReturnOpen(false)}
                onProcessed={onReturnProcessed}
              />
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main Sales Page ────────────────────────────────────────────────────────────
const Sales = () => {
  const { user, businessId } = useAuth()
  const { products } = useProducts()
  const { customers } = useCustomers()
  const [search,     setSearch]    = useState('')
  const [showModal,  setShowModal] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [customer, setCustomer] = useState(null)
  const [items, setItems] = useState([{ product_id: '', quantity: 1, unit_price: 0, subtotal: 0 }])
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [customerId, setCustomerId] = useState(null)
  const dateFilter = useDateRangeFilter({ defaultDays: 30 })
  const { sales, loading, refetch } = useSales({ limit: 500, ...dateFilter.apiParams, customerId, paymentMethod })
  const { summary, chartData }    = useSalesSummary(30)

  // ── Sales & profit stats — defaults to today, filterable by date ──────────
  const [statsStart, setStatsStart] = useState(todayStr())
  const [statsEnd,   setStatsEnd]   = useState(todayStr())
  const [stats, setStats] = useState({ totalSales: 0, totalProfit: 0, count: 0 })
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    let active = true
    setStatsLoading(true)
    salesService.getRangeStats(statsStart, statsEnd, businessId)
      .then(res => { if (active) setStats(res) })
      .catch(err => console.error('Failed to load sales stats', err))
      .finally(() => { if (active) setStatsLoading(false) })
    return () => { active = false }
  }, [statsStart, statsEnd, businessId, refreshKey])

  const handleStatsStart = (v) => {
    if (!v) return
    setStatsStart(v)
    if (v > statsEnd) setStatsEnd(v)
  }
  const handleStatsEnd = (v) => {
    if (!v) return
    setStatsEnd(v)
    if (v < statsStart) setStatsStart(v)
  }
  const statsMargin = stats.totalSales > 0
    ? ((stats.totalProfit / stats.totalSales) * 100).toFixed(1)
    : null

  const handleRefetch = () => {
    refetch()
    setRefreshKey(k => k + 1)
  }

  const filtered = sales.filter(s =>
    s.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
    s.customers?.name?.toLowerCase().includes(search.toLowerCase())
  )

  // Unpaid credit sales are not revenue yet — exclude them from the period total
  const periodTotal = filtered
    .filter(r => !(r.is_credit && !r.paid_at))
    .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales</h1>
          <p className="page-subtitle">
            {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
            {dateFilter.isActive
              ? ` · ${formatRangeLabel(dateFilter.applied.startDate, dateFilter.applied.endDate)} · ${formatCurrencyShort(periodTotal)}`
              : ` · ${formatCurrencyShort(summary?.total || 0)} this month`}
          </p>
        </div>
      </div>

      {/* Sales & Profit summary — date filterable, defaults to today */}
      <div className="card" style={{ padding: '18px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h3 style={{ fontFamily: 'Outfit,sans-serif', fontSize: 14, fontWeight: 700, margin: 0 }}>Sales &amp; Profit</h3>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9ca3af' }}>{formatRangeLabel(statsStart, statsEnd)}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontWeight: 600 }}>
              From
              <input
                className="input-base"
                type="date"
                value={statsStart}
                max={statsEnd}
                onChange={e => handleStatsStart(e.target.value)}
                style={{ padding: '6px 8px', fontSize: 12.5 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontWeight: 600 }}>
              To
              <input
                className="input-base"
                type="date"
                value={statsEnd}
                min={statsStart}
                onChange={e => handleStatsEnd(e.target.value)}
                style={{ padding: '6px 8px', fontSize: 12.5 }}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={() => { setStatsStart(todayStr()); setStatsEnd(todayStr()) }}>
              Today
            </Button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: 10, padding: '12px 16px' }}>
            <p style={{ margin: 0, fontSize: 11, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Sales</p>
            <p style={{ margin: '6px 0 2px', fontFamily: 'Outfit, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
              {statsLoading ? '…' : formatCurrency(stats.totalSales)}
            </p>
            <p style={{ margin: 0, fontSize: 11.5, color: '#9ca3af' }}>
              {stats.count} sale{stats.count === 1 ? '' : 's'} in range
            </p>
          </div>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px' }}>
            <p style={{ margin: 0, fontSize: 11, color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Profit</p>
            <p style={{ margin: '6px 0 2px', fontFamily: 'Outfit, sans-serif', fontSize: 22, fontWeight: 700, color: '#16a34a' }}>
              {statsLoading ? '…' : formatCurrency(stats.totalProfit)}
            </p>
            <p style={{ margin: 0, fontSize: 11.5, color: '#16a34a' }}>
              {statsMargin !== null ? `${statsMargin}% margin` : 'No sales in range'}
            </p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="card" style={{ padding: '18px 24px', marginBottom: 20 }}>
        <h3 style={{ fontFamily: 'Outfit,sans-serif', fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Daily Revenue (30 days)</h3>
        <ResponsiveContainer width="100%" height={130}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="sGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => formatCurrencyShort(v).replace('Rs. ','')} width={45} />
            <Tooltip formatter={v => [formatCurrency(v), 'Revenue']} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Area type="monotone" dataKey="amount" stroke="#f97316" strokeWidth={2.5} fill="url(#sGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card filter-toolbar" style={{ padding: '12px 18px', marginBottom: 14 }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search by invoice or customer…" width={260} />
        <DateRangeFilter
          open={dateFilter.open}
          onToggle={dateFilter.openPanel}
          startDate={dateFilter.draftStart}
          endDate={dateFilter.draftEnd}
          onStartChange={dateFilter.setDraftStart}
          onEndChange={dateFilter.setDraftEnd}
          onApply={dateFilter.apply}
          onClear={dateFilter.clear}
          isActive={dateFilter.isActive}
          appliedStart={dateFilter.applied?.startDate}
          appliedEnd={dateFilter.applied?.endDate}
        />
        <div style={{ display: 'flex', gap: 12, marginLeft: 24, alignItems: 'center' }}>
          <select className="input-base" style={{ minWidth: 180 }} value={customerId || ''} onChange={e => setCustomerId(e.target.value || null)}> 
            <option value="">All Customers</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input-base" style={{ minWidth: 180 }} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}> 
            <option value="">All Payment Types</option>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="table-scroll-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}></th>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Items</th>
              <th>Payment</th>
              <th>Total</th>
              <th>Profit</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }}><Loader /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9}><div className="empty-state"><ShoppingCart size={36} /><h3>No sales yet</h3><p>Create a new sale to get started</p></div></td></tr>
            ) : filtered.map(s => (
              <SalesRow key={s.id} sale={s} onReturnProcessed={handleRefetch} onMarkPaid={handleRefetch} />
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <SaleModal open={showModal} onClose={() => setShowModal(false)} onCreated={handleRefetch}
        customer={customer} setCustomer={setCustomer}
        items={items} setItems={setItems}
        products={products}
        paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
      />
    </div>
  )
}

export default Sales