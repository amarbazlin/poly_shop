import { API_URL, authHeaders, readJson } from './apiClient'

async function downloadBlob(url, filename) {
  const response = await fetch(url, { headers: await authHeaders() })
  if (!response.ok) {
    let message = 'Download failed'
    try { message = (await response.json()).error || message } catch (e) {}
    throw new Error(`${message} (HTTP ${response.status})`)
  }
  const blob = await response.blob()
  const blobUrl = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(blobUrl)
}

export const reportService = {
  // ── Inventory Report ──────────────────────────────────────────────────
  async getInventoryReport(params = {}) {
    const q = new URLSearchParams()
    if (params.location_id) q.append('location_id', params.location_id)
    q.append('format', 'json')
    const res = await fetch(`${API_URL}/reports/inventory?${q}`, { headers: await authHeaders() })
    return readJson(res, 'Failed to fetch inventory report')
  },
  async downloadInventoryPDF(params = {}) {
    const q = new URLSearchParams()
    if (params.location_id) q.append('location_id', params.location_id)
    q.append('format', 'pdf')
    await downloadBlob(`${API_URL}/reports/inventory?${q}`, `forgera-inventory-report-${new Date().toISOString().slice(0, 10)}.pdf`)
  },
  async downloadInventoryExcel(params = {}) {
    const q = new URLSearchParams()
    if (params.location_id) q.append('location_id', params.location_id)
    q.append('format', 'excel')
    await downloadBlob(`${API_URL}/reports/inventory?${q}`, `forgera-inventory-report-${new Date().toISOString().slice(0, 10)}.xlsx`)
  },

  // ── Supplier Report ───────────────────────────────────────────────────
  async getSupplierReport(params = {}) {
    const q = new URLSearchParams()
    if (params.date_from) q.append('date_from', params.date_from)
    if (params.date_to) q.append('date_to', params.date_to)
    q.append('format', 'json')
    const res = await fetch(`${API_URL}/reports/suppliers?${q}`, { headers: await authHeaders() })
    return readJson(res, 'Failed to fetch supplier report')
  },
  async downloadSupplierPDF(params = {}) {
    const q = new URLSearchParams()
    if (params.date_from) q.append('date_from', params.date_from)
    if (params.date_to) q.append('date_to', params.date_to)
    q.append('format', 'pdf')
    await downloadBlob(`${API_URL}/reports/suppliers?${q}`, `forgera-supplier-report-${new Date().toISOString().slice(0, 10)}.pdf`)
  },
  async downloadSupplierExcel(params = {}) {
    const q = new URLSearchParams()
    if (params.date_from) q.append('date_from', params.date_from)
    if (params.date_to) q.append('date_to', params.date_to)
    q.append('format', 'excel')
    await downloadBlob(`${API_URL}/reports/suppliers?${q}`, `forgera-supplier-report-${new Date().toISOString().slice(0, 10)}.xlsx`)
  },

  // ── Purchase Report ───────────────────────────────────────────────────
  async getPurchaseReport(params = {}) {
    const q = new URLSearchParams()
    if (params.date_from) q.append('date_from', params.date_from)
    if (params.date_to) q.append('date_to', params.date_to)
    if (params.supplier_id) q.append('supplier_id', params.supplier_id)
    q.append('format', 'json')
    const res = await fetch(`${API_URL}/reports/purchases?${q}`, { headers: await authHeaders() })
    return readJson(res, 'Failed to fetch purchase report')
  },
  async downloadPurchasePDF(params = {}) {
    const q = new URLSearchParams()
    if (params.date_from) q.append('date_from', params.date_from)
    if (params.date_to) q.append('date_to', params.date_to)
    if (params.supplier_id) q.append('supplier_id', params.supplier_id)
    q.append('format', 'pdf')
    await downloadBlob(`${API_URL}/reports/purchases?${q}`, `forgera-purchase-report-${new Date().toISOString().slice(0, 10)}.pdf`)
  },
  async downloadPurchaseExcel(params = {}) {
    const q = new URLSearchParams()
    if (params.date_from) q.append('date_from', params.date_from)
    if (params.date_to) q.append('date_to', params.date_to)
    if (params.supplier_id) q.append('supplier_id', params.supplier_id)
    q.append('format', 'excel')
    await downloadBlob(`${API_URL}/reports/purchases?${q}`, `forgera-purchase-report-${new Date().toISOString().slice(0, 10)}.xlsx`)
  },

  // ── Sales Report ──────────────────────────────────────────────────────
  async getSalesReport(params = {}) {
    const q = new URLSearchParams()
    if (params.date_from) q.append('date_from', params.date_from)
    if (params.date_to) q.append('date_to', params.date_to)
    q.append('format', 'json')
    const res = await fetch(`${API_URL}/reports/sales?${q}`, { headers: await authHeaders() })
    return readJson(res, 'Failed to fetch sales report')
  },
  async downloadSalesPDF(params = {}) {
    const q = new URLSearchParams()
    if (params.date_from) q.append('date_from', params.date_from)
    if (params.date_to) q.append('date_to', params.date_to)
    q.append('format', 'pdf')
    await downloadBlob(`${API_URL}/reports/sales?${q}`, `forgera-sales-report-${new Date().toISOString().slice(0, 10)}.pdf`)
  },
  async downloadSalesExcel(params = {}) {
    const q = new URLSearchParams()
    if (params.date_from) q.append('date_from', params.date_from)
    if (params.date_to) q.append('date_to', params.date_to)
    q.append('format', 'excel')
    await downloadBlob(`${API_URL}/reports/sales?${q}`, `forgera-sales-report-${new Date().toISOString().slice(0, 10)}.xlsx`)
  },
}

export default reportService
