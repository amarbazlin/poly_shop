// =============================================
// WhatsApp Service — Meta Cloud API (Option 1)
// =============================================
//
// SETUP STEPS:
// ─────────────────────────────────────────────
// 1. Go to https://developers.facebook.com/apps
// 2. Create a new App → Business type
// 3. Add "WhatsApp" product to your app
// 4. Under WhatsApp > API Setup:
//    - Copy the "Temporary access token" (or create a permanent System User token)
//    - Copy the "Phone number ID"
// 5. Under WhatsApp > Message Templates:
//    - Create a template named: "reorder_request"
//    - Category: UTILITY
//    - Language: English
//    - See the template body format in comments below
// 6. Add to your .env file:
//    VITE_META_WHATSAPP_TOKEN=your_token_here
//    VITE_META_PHONE_NUMBER_ID=your_phone_number_id
//    VITE_BUSINESS_NAME=Rathna Traders
//    VITE_BUSINESS_PHONE=+94XXXXXXXXX
//    VITE_REORDER_TIME=17:30
// ─────────────────────────────────────────────
//
// TEMPLATE BODY to use in Meta Business Manager:
// ─────────────────────────────────────────────
// Template name: reorder_request
// Category:      UTILITY
// Body:
//   Hello {{1}},
//
//   This is a purchase order request from *{{2}}*.
//
//   Please find the order details below:
//
//   {{3}}
//
//   Kindly confirm availability and expected delivery date.
//
//   Thank you,
//   {{2}}
//   Contact: {{4}}
// =============================================

const META_TOKEN           = import.meta.env.VITE_META_WHATSAPP_TOKEN   || 'EAATgvIhBh0gBRjj56vq8xnUd9C4z1T24ZCMCSydGyzFFXKLyiyS2w1KsFerhK6OV8svZBJJkGcDhx0Ha64CZALDmxgZC8NU4rLobnf29YZCOJXKTBnZBrZCBBbEltu8rwBVa1xfOs6NzjgTGrBE3ZCOlihARzy3Flny9HKYWtvY1oLCPPO623n0mmVCfMxV71fG6HWftfobQaFSfrvjdtZBAaPaGCuRjArVZA2FBoCXZADc6VpxhXcoEYj6wZAbcPkrCIH41ww1zmZBYPtsuSQEAKRJiXFkmda2bBUEsiz3bf5AZDZD'
const META_PHONE_NUMBER_ID = import.meta.env.VITE_META_PHONE_NUMBER_ID  || '1182294788292616'
const BUSINESS_NAME        = import.meta.env.VITE_BUSINESS_NAME         || 'Rathna Traders'
const BUSINESS_PHONE       = import.meta.env.VITE_BUSINESS_PHONE        || ''
const APP_URL              = import.meta.env.VITE_APP_URL               || ''
const API_VERSION          = 'v19.0'
const API_URL              = `https://graph.facebook.com/${API_VERSION}/${META_PHONE_NUMBER_ID}/messages`

/** Base URL for deep links in WhatsApp messages */
export const getAppUrl = () => {
  if (APP_URL) return APP_URL.replace(/\/$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

/** Link to view supplier bills in the Finance module */
export const getPurchaseOrderUrl = (invoiceNumber) => {
  const base = getAppUrl()
  if (!base) return ''
  return `${base}/finance`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Normalises Sri Lankan numbers to WhatsApp international format
// 0771234567 → 94771234567  |  +94771234567 → 94771234567
export const cleanPhoneNumber = (raw) => {
  if (!raw) return ''
  let num = raw.replace(/[\s\-().+]/g, '')
  if (num.startsWith('0'))  num = '94' + num.slice(1)
  if (num.length === 9)     num = '94' + num
  return num
}

const assertCredentials = () => {
  if (!META_TOKEN)           throw new Error('VITE_META_WHATSAPP_TOKEN is not set in .env')
  if (!META_PHONE_NUMBER_ID) throw new Error('VITE_META_PHONE_NUMBER_ID is not set in .env')
}

// ── Core API call ─────────────────────────────────────────────────────────────

const callMetaAPI = async (payload) => {
  assertCredentials()
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${META_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json()
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`
    console.error('[WhatsApp API Error]', data.error)
    throw new Error(msg)
  }
  return data
}

// ── Send TEMPLATE message (required for business-initiated messages) ───────────

export const sendTemplateMessage = async ({
  to,
  templateName = 'reorder_request',
  languageCode = 'en',
  variables    = [],
}) => {
  const phone = cleanPhoneNumber(to)
  if (!phone) throw new Error('Invalid phone number')

  const components = variables.length > 0
    ? [{ type: 'body', parameters: variables.map(v => ({ type: 'text', text: String(v) })) }]
    : []

  return callMetaAPI({
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                phone,
    type:              'template',
    template: {
      name:       templateName,
      language:   { code: languageCode },
      components,
    },
  })
}

// ── Send plain TEXT message (only within an open 24-hour window) ──────────────

export const sendTextMessage = async (to, body) => {
  const phone = cleanPhoneNumber(to)
  if (!phone) throw new Error('Invalid phone number')

  return callMetaAPI({
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                phone,
    type:              'text',
    text: { preview_url: false, body },
  })
}

// ── Build order item block for {{3}} variable ─────────────────────────────────

const buildOrderBlock = (items) =>
  items.map((item, i) =>
    `${i + 1}. ${item.product_name}\n` +
    `   Qty: ${item.suggested_qty} ${item.unit || 'pcs'}\n` +
    `   Unit cost: Rs. ${Number(item.cost_price || 0).toFixed(2)}`
  ).join('\n\n')

// ── Send a confirmed purchase order to supplier ───────────────────────────────

export const sendPurchaseOrderToSupplier = async ({ supplier, items, invoiceNumber }) => {
  const phone = cleanPhoneNumber(supplier.phone)
  if (!phone) {
    throw new Error(`No valid phone number for ${supplier.supplier_name}`)
  }

  const orderBlock = items.map((item, i) =>
    `${i + 1}. ${item.product_name}\n` +
    `   Qty: ${item.quantity} ${item.unit || 'pcs'}\n` +
    `   Unit cost: Rs. ${Number(item.unit_cost || 0).toFixed(2)}`
  ).join('\n\n')

  const total = items.reduce((s, i) => s + parseFloat(i.subtotal || 0), 0)
  const purchaseUrl = getPurchaseOrderUrl(invoiceNumber)

  let orderText =
    `PO Number: ${invoiceNumber}\n\n` +
    orderBlock +
    `\n\nTotal: Rs. ${total.toFixed(2)}`

  if (purchaseUrl) {
    orderText += `\n\nView full order details:\n${purchaseUrl}`
  }

  return sendTemplateMessage({
    to: phone,
    templateName: 'reorder_request',
    variables: [
      supplier.supplier_name,
      BUSINESS_NAME,
      orderText,
      BUSINESS_PHONE || 'N/A',
    ],
  })
}
// ── Send a payment reminder for an overdue credit sale (Finance AR) ──────────

export const sendPaymentReminder = async ({ customerName, invoiceNumber, amount, dueDate, daysOverdue, phone }) => {
  if (!phone) throw new Error(`No phone number on file for ${customerName || 'customer'}`)

  const overdueText = daysOverdue > 0
    ? `This payment is ${daysOverdue} day(s) overdue.`
    : 'This payment is due now.'

  const body =
    `Dear ${customerName || 'Customer'},\n\n` +
    `Friendly reminder from ${BUSINESS_NAME}:\n` +
    `Invoice ${invoiceNumber || ''} — Rs. ${Number(amount || 0).toFixed(2)}` +
    (dueDate ? ` (due ${dueDate})` : '') + '\n' +
    `${overdueText}\n\n` +
    `Please arrange payment at your earliest convenience. Thank you.`

  const res = await sendTextMessage(phone, body)
  return { ...res, sentTo: customerName }
}

export default {
  sendTemplateMessage,
  sendTextMessage,
  sendPurchaseOrderToSupplier,
  cleanPhoneNumber,
  getAppUrl,
  getPurchaseOrderUrl,
}
