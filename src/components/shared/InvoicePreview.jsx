import React, { useState } from 'react'
import { generateInvoicePDF } from '../../services/invoiceService'
import { Download } from 'lucide-react'

export const InvoicePreview = ({ sale }) => {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      generateInvoicePDF(sale)
    } catch (err) {
      alert('PDF generation failed: ' + err.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 12px', borderRadius: 7,
        border: '1px solid #fed7aa', background: '#fff7ed',
        color: '#f97316', fontSize: 12, fontWeight: 600,
        cursor: downloading ? 'not-allowed' : 'pointer',
        fontFamily: 'DM Sans, sans-serif', transition: 'all 0.15s',
        opacity: downloading ? 0.6 : 1,
      }}
    >
      <Download size={13} />
      {downloading ? 'Generating…' : 'Invoice PDF'}
    </button>
  )
}

export default InvoicePreview