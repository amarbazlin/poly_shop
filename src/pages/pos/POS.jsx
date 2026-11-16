import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Plus, Minus, Trash2, ShoppingCart, Check, Loader } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { salesService } from '../../services/salesService'
import { customerService } from '../../services/customerService'
import { printSaleReceipt } from '../../services/receiptService'
import { useAuth } from '../../context/AuthContext'
import { useRBAC } from '../../context/RBACContext'
import { P } from '../../utils/permissions'
import { formatCurrency } from '../../utils/formatters'
import { PAYMENT_METHODS } from '../../utils/constants'
import { buildProductSearchIndex, searchProductIndex } from '../../utils/search'
import { AccessDenied } from '../../components/auth/RoleGuard'
import './POS.css'

// ── Quantity rules ──────────────────────────────────────────────────────────
// Weighed goods sell in fractions (0.5 kg); counted goods only in whole units.
// Anything else (pcs, box, bag, …) keeps the old strict integer behaviour.
const WEIGHT_UNITS = new Set(['kg', 'g'])

// Display: 2 shows as "2", 0.5 as "0.5".
const formatQty = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return String(Number(n.toFixed(3)))
}

// Parse a typed quantity: whole numbers for counted units, decimals allowed
// for weighed units. Returns null when the input is not a valid quantity.
const parseQty = (raw, unit) => {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  if (!WEIGHT_UNITS.has((unit || '').toLowerCase()) && text.includes('.')) return null
  const n = Number(text)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 1000) / 1000
}

const isWeightUnit = (unit) => WEIGHT_UNITS.has((unit || '').toLowerCase())

// Always "LKR 1,234.00" style on the POS bill + Complete button
const formatLKR = (amount) => {
  const n = Number(amount)
  if (!Number.isFinite(n)) return 'LKR 0.00'
  return `LKR ${n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const NO_SALES_DAYS = 999

const POS = () => {
  const { user, businessId } = useAuth()
  const { can } = useRBAC()
  const navigate = useNavigate()

  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [cart, setCart] = useState([])           // {product_id, name, code, unit_price, discount, quantity, stock, cost_price}
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [cashReceived, setCashReceived] = useState('')   // cash tendered by the customer
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const searchRef = useRef(null)

  const canCreate = can(P.MANAGE_SALES)

  useEffect(() => {
    if (!canCreate) return
    let active = true

    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const [productsRes, customersRes] = await Promise.all([
          (() => {
            // New products always carry business_id = 2 (see AddProduct), so
            // scope the POS catalogue the same way — otherwise legacy NULL rows
            // would leak back in alongside the fixed ones.
            let q = supabase
              .from('products')
              .select('id, product_name, product_code, quantity, selling_price, cost_price, status, categories(name)')
              .eq('status', 'active')
            if (businessId) q = q.eq('business_id', businessId)
            return q.order('product_name')
          })(),
          customerService.getAll({ businessId }),
        ])
        if (productsRes.error) throw productsRes.error
        if (!active) return
        setProducts(productsRes.data || [])
        setCustomers(customersRes || [])
      } catch (err) {
        if (active) setLoadError(err.message || 'Failed to load products')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [businessId, canCreate])

  // Focus the search bar on mount (POS-style instant scanning)
  useEffect(() => { searchRef.current?.focus() }, [])

  const categories = useMemo(() => {
    const set = new Set(products.map(p => p.categories?.name).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [products])

  // One normalised index for the catalogue, so each keystroke only runs
  // substring tests (see src/utils/search.js for the matching rules).
  const searchIndex = useMemo(() => buildProductSearchIndex(products), [products])

  const filteredProducts = useMemo(() => {
    const matches = searchProductIndex(searchIndex, search)
    if (categoryFilter === 'all') return matches
    return matches.filter(p => (p.categories?.name || 'Uncategorized') === categoryFilter)
  }, [searchIndex, search, categoryFilter])

  const marginPct = useCallback((p) => {
    const buy = parseFloat(p.cost_price || 0)
    const sell = parseFloat(p.selling_price || 0)
    if (buy <= 0) return sell > 0 ? 100 : 0
    return Math.round(((sell - buy) / buy) * 100)
  }, [])

  // Only the quantity is shown on the card — the colour carries the meaning
  const stockLabel = useCallback((qty) => {
    if (qty <= 0) return { text: '0', title: 'Out of stock', cls: 'out-of-stock' }
    if (qty <= 5) return { text: `${qty}`, title: `${qty} left in stock`, cls: 'low-stock' }
    return { text: `${qty}`, title: `${qty} in stock`, cls: 'in-stock' }
  }, [])

  // ── Cart ops ──
  const addToCart = useCallback((p) => {
    const stock = p.quantity || 0
    setCart(prev => {
      const existing = prev.find(i => i.product_id === p.id)
      if (existing) {
        if (existing.quantity >= stock) return prev  // cannot exceed stock
        return prev.map(i => (i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i))
      }
      if (stock <= 0) return prev
      return [...prev, {
        product_id: p.id,
        name: p.product_name,
        code: p.product_code,
        unit_price: parseFloat(p.selling_price || 0),
        cost_price: parseFloat(p.cost_price || 0),
        discount: 0,               // per-item discount (Rs. off the whole line)
        quantity: 1,
        stock,
      }]
    })
  }, [])

  const changeQty = useCallback((productId, delta) => {
    setCart(prev => prev.flatMap(i => {
      if (i.product_id !== productId) return [i]
      const next = i.quantity + delta
      if (next <= 0) return []
      if (next > i.stock) return [i]
      return [{ ...i, quantity: next }]
    }))
  }, [])

  const removeFromCart = useCallback((productId) => {
    setCart(prev => prev.filter(i => i.product_id !== productId))
  }, [])

  // Per-item "New Price": the amount entered replaces the selling price for
  // that item (per unit). Line total = new price × qty. No discount is shown
  // anywhere — only the final selling price and total.
  const lineSellingPrice = (item) => {
    const np = parseFloat(item.new_price)
    if (Number.isFinite(np) && np > 0) return np
    return parseFloat(item.unit_price || 0)
  }
  const lineTotal = (item) => lineSellingPrice(item) * item.quantity
  const displaySellingPrice = (item) => lineSellingPrice(item)

  const setItemNewPrice = useCallback((productId, raw) => {
    setCart(prev => prev.map(i => {
      if (i.product_id !== productId) return i
      const val = parseFloat(raw)
      const clean = Number.isFinite(val) && val > 0 ? val : null
      return { ...i, new_price: clean }
    }))
  }, [])

  const clearCart = useCallback(() => {
    setCart([])
    setCustomerName('')
    setCustomerPhone('')
    setPaymentMethod('cash')
    setCashReceived('')
    setError(null)
    searchRef.current?.focus()
  }, [])

  // ── Totals (discounts already baked into each line) ──
  const subtotal = useMemo(
    () => cart.reduce((s, i) => s + lineTotal(i), 0),
    [cart],
  )
  const discount = 0
  const total = subtotal
  const cartProfit = useMemo(
    () => cart.reduce((s, i) => s + (lineSellingPrice(i) - parseFloat(i.cost_price || 0)) * i.quantity, 0),
    [cart],
  )

  // Cash tendered by the customer (blank = exact amount)
  const tenderedCash = useMemo(() => {
    const val = parseFloat(cashReceived)
    return Number.isFinite(val) && val > 0 ? val : total
  }, [cashReceived, total])

  const changeDue = Math.max(0, tenderedCash - total)

  // ── Checkout ──
  const handleCheckout = async () => {
    if (!cart.length) return
    // Customer details are optional for every payment type (including credit).
    // Cash handed over must cover the bill
    if (paymentMethod === 'cash' && cashReceived.trim() && tenderedCash < total) {
      setError('Cash received is less than the amount due.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      // Find or create the customer (saved to customers table)
      let customerId = null
      const phone = customerPhone.trim()
      const name = customerName.trim()
      if (phone) {
        const existing = customers.find(c => (c.phone || '').replace(/\s/g, '') === phone.replace(/\s/g, ''))
        if (existing) {
          customerId = existing.id
          if (name && existing.name !== name) {
            await customerService.update(existing.id, { name })
          }
        } else {
          const created = await customerService.create({
            name: name || `Walk-in ${phone}`,
            phone,
            business_id: businessId,
            customer_type: 'retail',
            status: 'active',
          })
          customerId = created.id
          setCustomers(prev => [...prev, created])
        }
      }

      const sale = await salesService.create({
        items: cart.map(i => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: lineSellingPrice(i),
          subtotal: lineTotal(i),
        })),
        paymentMethod,
        soldBy: user?.id,
        customerId,
        discountAmount: 0,
        isCredit: paymentMethod === 'credit',
        businessId,
      })

      // Snapshot of everything the bill needs (kept so the bill can be reprinted).
      // Only the final selling price + line total are saved — no discounts shown.
      const receipt = {
        invoiceNumber: sale.invoice_number,
        date: sale.created_at || new Date().toISOString(),
        customerName: name || (phone ? `Walk-in ${phone}` : 'Walk-In Customer'),
        customerPhone: phone,
        items: cart.map(i => ({
          code: i.code,
          name: i.name,
          quantity: i.quantity,
          unit_price: lineSellingPrice(i),
          discount: 0,
          line_total: lineTotal(i),
        })),
        subtotal,
        discount: 0,
        total,
        paymentMethod,
        cashReceived: paymentMethod === 'cash' ? tenderedCash : null,
      }

      // Optimistically reduce local stock
      setProducts(prev => prev.map(p => {
        const line = cart.find(i => i.product_id === p.id)
        return line ? { ...p, quantity: Math.max(0, (p.quantity || 0) - line.quantity) } : p
      }))
      clearCart()

      // Open the printer dialog with the bill (never fails the sale itself)
      try {
        await printSaleReceipt({ businessId, ...receipt })
      } catch (printErr) {
        console.error('Bill printing failed:', printErr)
      }
    } catch (err) {
      setError(err.message || 'Checkout failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!canCreate) return <AccessDenied />

  if (loading) {
    return (
      <div className="page-wrapper pos-page">
        <div className="pos-loading"><Loader size={28} /> Loading products…</div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page-wrapper pos-page">
        <div className="pos-error-banner">{loadError}</div>
      </div>
    )
  }

  return (
    <div className="page-wrapper pos-page">
      <div className="pos-layout">
        {/* ── Left: product browser ── */}
        <div className="pos-products">
          <div className="pos-searchbar">
            <Search size={17} />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, code or category…"
              autoComplete="off"
            />
            {search && (
              <button type="button" className="pos-search-clear" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            )}
          </div>

          {categories.length > 2 && (
            <div className="pos-cat-chips">
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  className={`pos-cat-chip${categoryFilter === cat ? ' active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat === 'all' ? 'All items' : cat}
                </button>
              ))}
            </div>
          )}

          <div className="pos-grid">
            {filteredProducts.map(p => {
              const stock = stockLabel(p.quantity)
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`pos-product-btn${p.quantity <= 0 ? ' disabled' : ''}`}
                  onClick={() => addToCart(p)}
                  disabled={p.quantity <= 0}
                >
                  <div className="pos-product-top">
                    <span className="pos-product-code">{p.product_code}</span>
                    <span className={`pos-stock-badge ${stock.cls}`} title={stock.title}>{stock.text}</span>
                  </div>
                  <div className="pos-product-name" title={p.product_name}>{p.product_name}</div>
                  <div className="pos-product-bottom">
                    <span className="pos-product-price">{formatCurrency(p.selling_price || 0)}</span>
                    <span className={`pos-margin ${marginPct(p) >= 25 ? 'good' : marginPct(p) >= 10 ? 'mid' : 'low'}`}>
                      {marginPct(p)}%
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {!filteredProducts.length && (
            <div className="pos-empty-products">
              <Search size={22} />
              <p>No products match “{search}”.</p>
            </div>
          )}
        </div>

        {/* ── Right: bill ── */}
        <div className="pos-cart pos-bill">
          <div className="pos-cart-header pos-bill-header">
            <div className="pos-bill-title">
              <ShoppingCart size={18} />
              <h2>Current Bill</h2>
            </div>
            {cart.length > 0 && (
              <button type="button" className="pos-cart-clear" onClick={clearCart}>
                <Trash2 size={14} /> Clear
              </button>
            )}
          </div>

          <div className="pos-bill-meta">
            <span>{cart.length} item{cart.length === 1 ? '' : 's'}</span>
            <span className="pos-bill-total">{formatLKR(total)}</span>
          </div>

          <div className="pos-bill-scroll">
          {/* ── 1 · Items ── */}
          <div className="pos-section pos-items-section">
            <div className="pos-section-title">1 · Items</div>
            {cart.length === 0 ? (
              <div className="pos-cart-empty">
                <ShoppingCart size={26} />
                <p>Tap a product to add it to the bill.</p>
              </div>
            ) : (
              <div className="pos-cart-items">
                {cart.map(item => (
                  <div className="pos-cart-item" key={item.product_id}>
                    <div className="pos-cart-item-main">
                      <strong title={item.name}>{item.name}</strong>
                      <span>{item.code} · {formatLKR(displaySellingPrice(item))} each</span>
                    </div>
                    <div className="pos-cart-item-qty">
                      <button type="button" onClick={() => changeQty(item.product_id, -1)} aria-label="Decrease"><Minus size={13} /></button>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={e => {
                          const val = Number(e.target.value)
                          setCart(prev =>
                            prev.map(i => i.product_id === item.product_id ? { ...i, quantity: Number.isFinite(val) && val > 0 ? val : item.quantity } : i)
                          )
                        }}
                        style={{ width: 40, margin: '0 4px', borderRadius: 4, border: '1px solid var(--card-border)', textAlign: 'center' }}
                      />
                      <button
                        type="button"
                        onClick={() => changeQty(item.product_id, 1)}
                        disabled={item.quantity >= item.stock}
                        aria-label="Increase"
                      ><Plus size={13} /></button>
                    </div>
                    <div className="pos-cart-item-subtotal">{formatLKR(lineTotal(item))}</div>
                    <button type="button" className="pos-cart-item-remove" onClick={() => removeFromCart(item.product_id)} aria-label="Remove">
                      <X size={14} />
                    </button>
                    <label className="pos-cart-item-disc">
                      <span>New Price (Rs.)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.new_price ? String(item.new_price) : ''}
                        placeholder={parseFloat(item.unit_price || 0).toFixed(2)}
                        inputMode="decimal"
                        onChange={e => setItemNewPrice(item.product_id, e.target.value)}
                        aria-label={`New price for ${item.name}`}
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 2 · Customer ── */}
          <div className="pos-section pos-customer-section">
            <div className="pos-section-title">2 · Customer</div>
            <div className="pos-customer">
              <input
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="Customer name"
                autoComplete="off"
              />
              <input
                value={customerPhone}
              onChange={e => setCustomerPhone(e.target.value)}
              placeholder="Phone number"
              inputMode="tel"
              autoComplete="off"
            />
            </div>
          </div>

          {/* ── 3 · Payment ── */}
          <div className="pos-section">
            <div className="pos-section-title">3 · Payment</div>
            <div className="pos-payment-row">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m}
                  type="button"
                  className={`pos-pay-btn${paymentMethod === m ? ' active' : ''}`}
                  onClick={() => setPaymentMethod(m)}
                >
                  {m === 'bank_transfer' ? 'Bank' : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>

            {/* Cash tendered — drives Cash Received / Balance on the printed bill */}
            {paymentMethod === 'cash' && cart.length > 0 && (
              <div className="pos-cash-row">
                <label htmlFor="pos-cash-received">Cash received</label>
                <input
                  id="pos-cash-received"
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashReceived}
                  onChange={e => setCashReceived(e.target.value)}
                  placeholder={total.toFixed(2)}
                  inputMode="decimal"
                />
                <span className="pos-change">Change {formatLKR(changeDue)}</span>
              </div>
            )}
          </div>
          </div>

          {error && <div className="pos-bill-error"><div className="pos-error-banner">{error}</div></div>}

          {/* ── 4 · Summary ── */}
          <div className="pos-section pos-summary-section">
            <div className="pos-section-title">4 · Summary</div>
            <div className="pos-totals">
              <div><span>Subtotal</span><strong>{formatLKR(subtotal)}</strong></div>
              <div className="pos-total-row"><span>Total</span><strong>{formatLKR(total)}</strong></div>
              {cart.length > 0 && (
                <div className="pos-profit-row"><span>Est. profit</span><strong>{formatLKR(cartProfit)}</strong></div>
              )}
            </div>
          </div>

          <div className="pos-checkout-bar">
            <button
              type="button"
              className="pos-checkout-btn"
              onClick={handleCheckout}
              disabled={!cart.length || submitting}
            >
              {submitting ? <Loader size={16} /> : <Check size={16} />}
              {submitting ? 'Saving sale…' : `Complete - ${formatLKR(total)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default POS


