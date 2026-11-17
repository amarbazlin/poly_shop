// Invoice, Quotation & Delivery Note PDF generation using jsPDF
// Install: npm install jspdf jspdf-autotable

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { getBusinessInfo } from './businessInfo'

// Business header details are shared with the POS bill printer (cached there)
export { getBusinessInfo }

const ACCENT = [249, 115, 22]   // orange
const DARK   = [13, 17, 23]     // near black

// ── Shared header ─────────────────────────────────────────────────────────────
const drawHeader = (doc, title, number, date, status, business) => {
  // Dark header bar
  doc.setFillColor(...DARK)
  doc.rect(0, 0, 210, 38, 'F')

  // Business name
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(255, 255, 255)
  doc.text(business.name, 14, 16)

  // Document type badge
  doc.setFillColor(...ACCENT)
  doc.roundedRect(140, 6, 56, 10, 2, 2, 'F')
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 168, 12.5, { align: 'center' })

  // Business details
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(180, 180, 180)
  doc.text(`${business.address}  |  ${business.phone}  |  ${business.email}`, 14, 24)
  if (business.regNo) doc.text(`Reg: ${business.regNo}`, 14, 30)

  // Document number & date
  doc.setTextColor(...ACCENT)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(number, 196, 24, { align: 'right' })
  doc.setTextColor(180, 180, 180)
  doc.setFont('helvetica', 'normal')
  doc.text(date, 196, 30, { align: 'right' })
  if (status) {
    doc.setTextColor(255, 255, 255)
    doc.text(status, 196, 36, { align: 'right' })
  }

  // Orange underline
  doc.setFillColor(...ACCENT)
  doc.rect(0, 38, 210, 1.5, 'F')
}

// ── Customer box ──────────────────────────────────────────────────────────────
const drawCustomerBox = (doc, customer, yStart) => {
  doc.setFillColor(245, 245, 245)
  doc.roundedRect(14, yStart, 90, 28, 2, 2, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 100, 100)
  doc.text('BILL TO', 18, yStart + 7)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text(customer.name || '—', 18, yStart + 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(80, 80, 80)
  if (customer.phone)   doc.text(`Tel: ${customer.phone}`,   18, yStart + 20)
  if (customer.address) doc.text(customer.address,           18, yStart + 26)
}

// ── Items table column layout ─────────────────────────────────────────────────
// Each column keeps ONE alignment for its heading and its numbers so the
// heading sits on the same column line as the values below it, row by row:
// Qty / Unit are centred, the money columns are right-aligned.
const ITEM_COLS = [
  { cellWidth: 10, halign: 'center' },   // #
  { cellWidth: 70, halign: 'left'   },   // Product
  { cellWidth: 15, halign: 'center' },   // Qty
  { cellWidth: 15, halign: 'center' },   // Unit
  { cellWidth: 30, halign: 'right'  },   // Unit Price (Rs.)
  { cellWidth: 30, halign: 'right'  },   // Total (Rs.)
]

const ITEM_COLUMN_STYLES = ITEM_COLS.reduce((acc, col, i) => ({ ...acc, [i]: col }), {})

// ── Items table ───────────────────────────────────────────────────────────────
const drawItemsTable = (doc, items, yStart) => {
  doc.autoTable({
    startY: yStart,
    margin: { left: 14, right: 14 },
    head: [['#', 'Product', 'Qty', 'Unit', 'Unit Price (Rs.)', 'Total (Rs.)']],
    body: items.map((item, i) => [
      i + 1,
      item.product_name || item.products?.product_name || '—',
      item.quantity,
      item.unit || item.products?.unit || 'pcs',
      parseFloat(item.unit_price).toFixed(2),
      parseFloat(item.subtotal).toFixed(2),
    ]),
    headStyles: {
      fillColor: DARK,
      textColor: 255,
      fontSize: 8,
      fontStyle: 'bold',
    },
    // jspdf-autotable never copies a column's `halign` onto its heading cell
    // (verified against 3.8.4: heads fall back to left), and one head-level
    // `halign` would centre the money headings away from their numbers. So the
    // heading of every column is aligned explicitly to match the data below it.
    didParseCell: (data) => {
      if (data.section === 'head') {
        data.cell.styles.halign = ITEM_COLS[data.column.index]?.halign || 'left'
      }
    },
    columnStyles: ITEM_COLUMN_STYLES,
    bodyStyles: { fontSize: 8.5, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    styles: { lineColor: [220, 220, 220], lineWidth: 0.1 },
  })
  return doc.lastAutoTable.finalY
}

// ── Totals block ──────────────────────────────────────────────────────────────
const drawTotals = (doc, { subtotal, discount = 0, tax = 0, total }, y) => {
  const rows = [
    ['Subtotal', `Rs. ${parseFloat(subtotal).toFixed(2)}`],
  ]
  if (discount > 0) rows.push(['Discount', `- Rs. ${parseFloat(discount).toFixed(2)}`])
  if (tax > 0)      rows.push(['Tax', `Rs. ${parseFloat(tax).toFixed(2)}`])
  rows.push(['TOTAL', `Rs. ${parseFloat(total).toFixed(2)}`])

  doc.autoTable({
    startY: y + 4,
    margin: { left: 120, right: 14 },
    body: rows,
    bodyStyles: { fontSize: 8.5 },
    columnStyles: { 0: { textColor: [100, 100, 100] }, 1: { halign: 'right', fontStyle: 'bold', textColor: DARK } },
    didDrawCell: (data) => {
      if (data.row.index === rows.length - 1) {
        doc.setFillColor(...ACCENT)
        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.text(data.cell.text[0], data.cell.x + (data.column.index === 1 ? data.cell.width - 4 : 4), data.cell.y + 6,
          { align: data.column.index === 1 ? 'right' : 'left' })
      }
    },
    styles: { lineColor: [220, 220, 220], lineWidth: 0.1 },
  })
  return doc.lastAutoTable.finalY
}

// ── Footer ────────────────────────────────────────────────────────────────────
const drawFooter = (doc, notes = '', business) => {
  const y = doc.internal.pageSize.height - 22
  doc.setFillColor(245, 245, 245)
  doc.rect(0, y, 210, 22, 'F')
  doc.setFillColor(...ACCENT)
  doc.rect(0, y, 210, 0.8, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.text(`${business.name}`, 105, y + 13, { align: 'center' })
  doc.text(`Tel: ${business.phone}`, 105, y + 18, { align: 'center' })
  doc.text(`Email: ${business.email}`, 105, y + 22, { align: 'center' })
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

export const generateInvoicePDF = async (sale, businessId) => {
  const business = await getBusinessInfo(businessId)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const date = new Date(sale.created_at).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })

  drawHeader(doc, 'INVOICE', sale.invoice_number, date, sale.payment_method?.toUpperCase(), business)
  drawCustomerBox(doc, sale.customers || { name: 'Walk-in Customer' }, 46)

  // Payment method badge
  doc.setFillColor(240, 240, 240)
  doc.roundedRect(120, 46, 76, 28, 2, 2, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 100, 100)
  doc.text('PAYMENT METHOD', 158, 53, { align: 'center' })
  doc.setFontSize(11)
  doc.setTextColor(...DARK)
  doc.text((sale.payment_method || 'cash').toUpperCase(), 158, 62, { align: 'center' })
  if (sale.is_credit) {
    doc.setTextColor(249, 115, 22)
    doc.setFontSize(8)
    doc.text('CREDIT SALE', 158, 70, { align: 'center' })
  }

  const itemsEndY = drawItemsTable(doc, sale.sales_items || [], 82)
  const totalsEndY = drawTotals(doc, {
    subtotal: sale.total_amount,
    discount: sale.discount_amount || 0,
    total: sale.total_amount,
  }, itemsEndY)
  drawFooter(doc, sale.notes, business)

  doc.save(`${sale.invoice_number}.pdf`)
  return doc
}

export const generateQuotationPDF = async (quotation, businessId) => {
  const business = await getBusinessInfo(businessId)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const date = new Date(quotation.created_at || Date.now()).toLocaleDateString('en-LK')
  const validUntil = quotation.valid_until ? new Date(quotation.valid_until).toLocaleDateString('en-LK') : '—'

  drawHeader(doc, 'QUOTATION', quotation.quote_number, date, null, business)
  drawCustomerBox(doc, quotation.customers || { name: quotation.customer_name || 'Customer' }, 46)

  doc.setFillColor(240, 240, 240)
  doc.roundedRect(120, 46, 76, 28, 2, 2, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 100, 100)
  doc.text('VALID UNTIL', 158, 53, { align: 'center' })
  doc.setFontSize(11)
  doc.setTextColor(...DARK)
  doc.text(validUntil, 158, 62, { align: 'center' })

  const itemsEndY = drawItemsTable(doc, quotation.quotation_items || [], 82)
  drawTotals(doc, { subtotal: quotation.total_amount, total: quotation.total_amount }, itemsEndY)
  drawFooter(doc, quotation.notes || 'Prices valid for the period shown. Subject to availability.', business)

  doc.save(`${quotation.quote_number}.pdf`)
  return doc
}

export default { generateInvoicePDF, generateQuotationPDF }