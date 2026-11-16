// AI service — xAI / Grok API
// Add to your .env file: VITE_XAI_API_KEY=xai-...

const XAI_API_KEY = import.meta.env.VITE_XAI_API_KEY

const toFiniteNumber = (value, fallback = null) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const formatMargin = (sellingPrice, buyingPrice) => {
  const selling = toFiniteNumber(sellingPrice)
  const buying = toFiniteNumber(buyingPrice)
  if (selling == null || buying == null || buying <= 0) return 'Not configured'
  return `${(((selling - buying) / buying) * 100).toFixed(1)}%`
}

/**
 * Core xAI / Grok API caller (OpenAI-compatible format)
 */
const callXAI = async (systemPrompt, userContent, maxTokens = 1000) => {
  if (!XAI_API_KEY) throw new Error('VITE_XAI_API_KEY is not set in .env')

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'grok-4-0709',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`xAI API error: ${res.status} — ${err?.error?.message ?? 'Unknown error'}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Smart Reorder Recommendations ────────────────────────────────────────────
export const getReorderRecommendations = async (lowStockProducts) => {
  const system = `You are an AI procurement advisor for a Sri Lankan hardware distribution business (Rathna Traders / CPT, Matara).
Format EVERY recommendation as exactly: PRIORITY | Product Name | Recommended Qty | Reason
PRIORITY must be HIGH, MEDIUM, or LOW. One recommendation per line. No headers, no extra text.`

  const user = `Low stock products needing reorder decisions:
${JSON.stringify(lowStockProducts.map(p => ({
    product: p.product_name,
    currentStock: p.quantity,
    reorderLevel: p.reorder_level,
    supplier: p.suppliers?.supplier_name,
    leadTime: p.suppliers?.average_delivery_days,
    margin: formatMargin(p.selling_price, p.cost_price),
  })), null, 2)}

Generate prioritized reorder recommendations for each product.`

  return callXAI(system, user, 1200)
}

// ── Supplier Discovery ────────────────────────────────────────────────────────
export const getAlternativeSupplierSuggestions = async ({
  product, currentSupplier, issue, category,
}) => {
  const system = `You are a procurement advisor for a Sri Lankan hardware distribution business in Matara, Southern Province.
You know the Sri Lankan hardware supply chain — Colombo wholesale market, Chinese imports via Colombo port,
Indian suppliers (TNEB, Kerala traders), local distributors in Galle and Matara.
Provide practical, actionable supplier discovery advice. Plain text, no markdown.`

  const user = `Product: ${product}
Category: ${category || 'Hardware & Building Materials'}
Current supplier: ${currentSupplier || 'Not specified'}
Issue with current supplier: ${issue || 'Need alternatives / backup'}

Provide:
1. 3-4 specific places/channels to source this product in Sri Lanka (with area/city)
2. Import alternative if locally unavailable (country, typical lead time, minimum order)
3. Key questions to ask a new supplier before ordering
4. Red flags to watch out for when switching suppliers
5. Approximate price range to expect vs current market rate`

  return callXAI(system, user, 700)
}

// ── Supplier Negotiation Talking Points ──────────────────────────────────────
export const getSupplierNegotiationPoints = async ({
  supplierName, products, totalOrderValue, performanceIssues,
}) => {
  const system = `You are a procurement negotiation advisor for a Sri Lankan hardware distribution business.
Generate specific, confident negotiation talking points for a supplier meeting.
Be direct and practical. Plain text format.`

  const user = `Supplier: ${supplierName}
Products to negotiate on: ${JSON.stringify(products?.map(p => p.product_name) ?? [])}
Estimated annual order value: Rs. ${toFiniteNumber(totalOrderValue)?.toFixed(0) ?? '?'}
Performance issues: ${JSON.stringify(performanceIssues ?? [])}

Generate 5-6 specific negotiation talking points including:
- Price reduction justification
- Delivery improvement demands
- Volume discount thresholds to propose
- Payment terms to request`

  return callXAI(system, user, 600)
}

// ── General Inventory Q&A ────────────────────────────────────────────────────
export const askInventoryQuestion = async (question, context) => {
  const system = `You are the Forgera Inventory Advisor, an AI-powered inventory management specialist for a hardware and building materials distribution business in Sri Lanka.
Help managers make better inventory decisions. Be concise, practical, use LKR currency and Sri Lankan context. Focus on reorder decisions, stock risks, slow-moving inventory, and dead inventory.`

  return callXAI(
    system,
    `Business context: ${JSON.stringify(context)}\n\nQuestion: ${question}`
  )
}

export const aiService = {
  getReorderRecommendations,
  getAlternativeSupplierSuggestions,
  getSupplierNegotiationPoints,
  askInventoryQuestion,
}

export default aiService
