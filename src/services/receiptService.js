import { getBusinessInfo } from './businessInfo'

// ── POS bill printing: 8.27in (wide) x 5.85in (tall) landscape sheet ──────────
// Layout mirrors the shop paper bill: header (CPT logo left, company centre,
// copy tag right) -> invoice meta -> item table (PCODE / DESCRIPTION / QTY /
// PRICE / AMOUNT — price shown is already the discounted selling price) ->
// right totals (Bill Amount / Net Amount / Cash Received / Balance) ->
// payment type -> dark footer strip (conditions + tel/email).
// Printed via a hidden iframe so only the bill reaches the printer.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch])

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const money = (value) =>
  num(value).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const rs = (value) => `Rs. ${money(value)}`

const pad = (n) => String(n).padStart(2, '0')

const formatBillDate = (value) => {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) return formatBillDate()
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

const methodLabel = (method) => String(method || 'cash').replace(/_/g, ' ').toUpperCase()

const ICON_PHONE = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
const ICON_MAIL = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>'

// Company mark at the left-top of the bill. Served from /logopoly.png
// (public folder) so the print iframe can load it same-origin; text fallback below.
const LOGO_SRC = '/logopoly.png'

// ── Bill markup ───────────────────────────────────────────────────────────────
// PRICE on the bill is always the final (already-discounted) selling price —
// no discount column or discount line is printed anywhere.
const buildItemRows = (items) =>
  items
    .map((item) => {
      const qty       = num(item.quantity)
      const price     = num(item.unit_price)
      const lineTotal = item.line_total != null ? num(item.line_total) : qty * price

      return `
        <tr>
          <td class="c-code">${esc(item.code || '')}</td>
          <td class="c-desc">${esc(item.name || '')}</td>
          <td class="c-num c-qty">${qty}</td>
          <td class="c-num c-price">${money(price)}</td>
          <td class="c-num c-amount c-strong">${money(lineTotal)}</td>
        </tr>`
    })
    .join('')

// Payment split shown on the bill (cash tendered / balance due)
const resolvePayment = ({ paymentMethod, total, cashReceived }) => {
  const method = String(paymentMethod || 'cash').toLowerCase()

  if (method === 'cash') {
    const tendered = num(cashReceived) > 0 ? num(cashReceived) : total
    return { label: 'Cash Received', paid: tendered, balance: Math.max(0, tendered - total) }
  }

  if (method === 'credit') {
    return { label: 'Amount Paid', paid: 0, balance: total }
  }

  return { label: 'Amount Paid', paid: total, balance: 0 }
}

export const buildBillHtml = ({
  business = {},
  copyLabel = 'CUSTOMER COPY',
  invoiceNumber = '',
  date,
  customerName = 'Walk-In Customer',
  customerPhone = '',
  items = [],
  subtotal = 0,
  discount = 0,
  total = 0,
  paymentMethod = 'cash',
  cashReceived = null,
  conditions = [
    'This bill is required for any return or exchange.',
    'Items can be exchanged only within 15 days from the date of purchase.',
    'Shopping bags can be provided upon request and will be charged separately.',
  ],
} = {}) => {
  // Totals are already final (per-item discounted prices only) — no bill-level
  // discount line is shown, so derive everything from `total`.
  const netAmount   = num(total) > 0 ? num(total) : num(subtotal) - num(discount)
  const payment     = resolvePayment({ paymentMethod, total: netAmount, cashReceived })
  const method      = String(paymentMethod || 'cash').toLowerCase()

  const conditionsHtml = conditions
    .map((line) => `<div class="cond-line">&bull;&nbsp;${esc(line)}</div>`)
    .join('')

  const styles = `
  @page { size: 8.27in 5.85in; margin: 0.28in 0.25in 0.12in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: 7.77in;
    margin: 0 auto;
    padding: 0;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 9pt;
    line-height: 1.25;
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .copy { page-break-after: auto; }
  .copy:last-child { page-break-after: auto; }
  .bill { display: flex; flex-direction: column; min-height: 5.45in; }
  .head { display: table; width: 100%; table-layout: fixed; }
  .head-logo { display: table-cell; width: 0.62in; vertical-align: middle; text-align: left; }
  .head-logo img { width: 0.52in; max-height: 0.36in; object-fit: contain; display: block; }
  .logo-fallback {
    display: none; width: 0.5in; height: 0.34in;
    border: 1.5px solid #a02121; border-radius: 50%;
    color: #a02121; font-weight: 900; font-size: 10pt;
    align-items: center; justify-content: center; letter-spacing: 1px;
  }
  .head-mid { display: table-cell; vertical-align: middle; text-align: center; padding: 0 0.05in; }
  .biz-name { font-size: 10.5pt; font-weight: 800; line-height: 1.1; text-transform: uppercase; }
  .biz-addr { font-size: 6.8pt; margin-top: 0.01in; line-height: 1.2; }
  .head-right { display: table-cell; width: 0.85in; vertical-align: middle; text-align: right; }
  .copy-tag {
    display: inline-block; padding: 0.015in 0.06in;
    border: 1px solid #000; border-radius: 0.05in;
    font-size: 6pt; font-weight: 700; letter-spacing: 0.4px; white-space: nowrap;
  }
  .meta {
    width: 100%; margin-top: 0.04in; border-collapse: collapse;
    border-top: 1px solid #000; border-bottom: 1px solid #000;
    table-layout: fixed;
  }
  .meta td { padding: 0.02in 0; vertical-align: top; font-size: 8pt; font-weight: 600; white-space: nowrap; }
  .meta .right { text-align: right; }
  .meta .mrow { line-height: 1.35; }
  .meta .mrow + .mrow { margin-top: 0.01in; }
  .items {
    width: 100%; margin-top: 0.06in; border-collapse: collapse;
    table-layout: fixed; font-size: 8.5pt;
  }
  .items th:last-child, .items td:last-child { padding-right: 0; }
  .items th {
    padding: 0.045in 0.04in;
    border-top: 1.5px solid #000; border-bottom: 1.5px solid #000;
    font-size: 7.5pt; font-weight: 800; text-align: left; text-transform: uppercase;
  }
  .items td {
    padding: 0.045in 0.04in; border-bottom: 0.5px dotted #9ca3af;
    vertical-align: top; word-break: break-word;
  }
  .c-code { width: 16%; word-break: break-all; }
  .c-desc { width: 40%; }
  .c-num { text-align: right; white-space: nowrap; }
  /* The plain th rule above (specificity 0,1,1) outranks the bare .c-num
     class (0,1,0), so it was pulling the QTY / PRICE / AMOUNT headings back
     to the left while their numbers sat on the right - the headings floated
     off their own columns. Re-assert the numbers' alignment on the headings
     (nothing else: padding must keep coming from the shared th / td rules
     and the :last-child override, or the AMOUNT column drifts again) so every
     heading sits on the same column line as its numbers, row by row. */
  .items th.c-num { text-align: right; }
  /* table-layout: fixed reads its column widths from the first row (these
     headings), so every column width class lives on both the heading and the
     cell — otherwise the widths on the cells are ignored and the headings no
     longer sit over their own column. */
  .items th.c-qty, .items td.c-qty { width: 10%; }
  .items th.c-price, .items td.c-price { width: 16%; }
  .items th.c-amount, .items td.c-amount { width: 18%; }
  .c-strong { font-weight: 700; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-top: 0.12in; }
  .summary { width: 3.4in; }
  .srow {
    display: flex; justify-content: space-between; gap: 0.15in;
    padding: 0.045in 0; font-size: 10pt; font-weight: 600;
  }
  .srow.net {
    margin-top: 0.05in; padding: 0.08in 0;
    border-top: 1.5px solid #000; border-bottom: 1.5px solid #000;
    font-size: 14pt; font-weight: 800;
  }
  .foot {
    margin-top: auto; margin-left: -0.25in; margin-right: -0.25in;
    padding: 0.07in 0.25in 0.08in;
    background: #2b2b2b; color: #fff;
    display: grid; grid-template-columns: 2.1in auto 1fr; gap: 0 0.12in;
    align-items: start;
  }
  .cond-head { font-size: 8.5pt; font-weight: 800; line-height: 1.3; white-space: nowrap; }
  .cond-line { font-size: 7pt; line-height: 1.3; margin-bottom: 0.01in; }
  .cond-line:last-child { margin-bottom: 0; }
  .foot-item { display: flex; align-items: center; gap: 0.06in; font-size: 8pt; line-height: 1.3; }
  .foot-item + .foot-item { margin-top: 0.04in; }
  .ico { width: 0.13in; height: 0.13in; flex-shrink: 0; }
  @media print { body { margin: 0; } }
`

  // One bill page for a given copy label (e.g. CUSTOMER COPY / OFFICE COPY)
  const pageHtml = (copyLabel) => `<div class="copy">
<div class="bill">
  <div class="head">
    <div class="head-logo">
      <img src="${LOGO_SRC}" alt="Polyshop.lk" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
      <div class="logo-fallback">Polyshop.lk</div>
    </div>
    <div class="head-mid">
      <div class="biz-name">${esc(business.name || '')}</div>
      ${business.address ? `<div class="biz-addr">Address: ${esc(business.address)}</div>` : ''}
      ${business.regNo ? `<div class="biz-addr">Reg No: ${esc(business.regNo)}</div>` : ''}
    </div>
    <div class="head-right"><span class="copy-tag">${esc(copyLabel)}</span></div>
  </div>

  <table class="meta">
    <tr>
      <td>
        <div class="mrow">Invoice No : ${esc(invoiceNumber || '—')}</div>
        <div class="mrow">Customer : ${esc(customerName)}</div>
        ${customerPhone ? `<div class="mrow">Phone : ${esc(customerPhone)}</div>` : ''}
      </td>
      <td class="right">
        <div class="mrow">Date : ${esc(formatBillDate(date))}</div>
        <div class="mrow">Payment Type : ${esc(methodLabel(method))}</div>
      </td>
    </tr>
  </table>

  <table class="items">
    <thead>
      <tr>
        <th class="c-code">PCODE</th>
        <th class="c-desc">DESCRIPTION</th>
        <th class="c-num c-qty">QTY</th>
        <th class="c-num c-price">PRICE</th>
        <th class="c-num c-amount">AMOUNT</th>
      </tr>
    </thead>
    <tbody>${buildItemRows(items)}</tbody>
  </table>

  <div class="totals-wrap">
    <div class="summary">
      <div class="srow"><span>Bill Amount</span><span>${rs(netAmount)}</span></div>
      <div class="srow net"><span>Net Amount</span><span>${rs(netAmount)}</span></div>
      <div class="srow"><span>${esc(payment.label)}</span><span>${rs(payment.paid)}</span></div>
      <div class="srow"><span>Balance</span><span>${rs(payment.balance)}</span></div>
    </div>
  </div>

  <div class="foot">
    <div class="foot-contact">
      <div class="foot-item">${ICON_PHONE}<span>Tel : ${esc(business.phone || '')}</span></div>
      <div class="foot-item">${ICON_MAIL}<span>Email : ${esc(business.email || '')}</span></div>
    </div>
    <div class="cond-head">Conditions :</div>
    <div class="cond-body">${conditionsHtml}</div>
  </div>
</div>
</div>`

  const copiesHtml = pageHtml('CUSTOMER COPY')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(invoiceNumber || 'Bill')}</title>
<style>${styles}</style>
</head>
<body>${copiesHtml}</body>
</html>`
}

// ── Print driver ──────────────────────────────────────────────────────────────
// Writes the bill into a hidden same-origin iframe and calls print() on it, so
// the app page itself is never printed and no pop-up blocker is involved.
const printHtml = (html) => {
  if (typeof document === 'undefined') return

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('title', 'Bill print frame')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  document.body.appendChild(frame)

  const win = frame.contentWindow
  const doc = win.document
  doc.open()
  doc.write(html)
  doc.close()

  const triggerPrint = () => {
    try {
      win.focus()
      win.print()
    } catch (err) {
      console.error('Bill printing failed:', err)
    } finally {
      // Give the browser time to hand the job over to the printer driver
      setTimeout(() => frame.remove(), 3000)
    }
  }

  if (doc.readyState === 'complete') {
    setTimeout(triggerPrint, 150)
  } else {
    frame.addEventListener('load', () => setTimeout(triggerPrint, 150), { once: true })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
// Prints the bill for a sale. Accepts the same shape used by the POS page and
// by the "print bill again" action on the last-sale chip.
export const printSaleReceipt = async ({
  businessId,
  copyLabel = 'CUSTOMER COPY',
  ...bill
} = {}) => {
  const business = await getBusinessInfo(businessId)
  printHtml(buildBillHtml({ ...bill, copyLabel, business }))
  return business
}


