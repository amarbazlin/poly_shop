import { supabase } from './supabase'

export const analyticsService = {
  // Revenue over time
  getRevenueChart: async (days = 90, businessId = null) => {
    const from = new Date()
    from.setDate(from.getDate() - days)

    let q = supabase
      .from('sales')
      .select('total_amount, created_at')
      .gte('created_at', from.toISOString())
      .order('created_at')

    if (businessId) q = q.eq('business_id', businessId)

    const { data, error } = await q
    if (error) throw error

    // Group by week
    const grouped = {}
    ;(data || []).forEach(s => {
      const d = new Date(s.created_at)
      const week = `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-LK', { month: 'short', day: 'numeric' }).slice(0, 6)
      const key = s.created_at.slice(0, 7) + '-' + String(Math.ceil(d.getDate() / 7))
      if (!grouped[key]) grouped[key] = { name: label, revenue: 0, cost: 0 }
      grouped[key].revenue += parseFloat(s.total_amount)
    })
    return Object.values(grouped)
  },

  // Category breakdown
  getCategoryBreakdown: async (businessId = null) => {
    let q = supabase
      .from('products')
      .select(`quantity, cost_price, categories ( name )`)
      .eq('status', 'active')

    if (businessId) q = q.eq('business_id', businessId)

    const { data, error } = await q
    if (error) throw error

    const grouped = {}
    ;(data || []).forEach(p => {
      const cat = p.categories?.name || 'Uncategorized'
      if (!grouped[cat]) grouped[cat] = { name: cat, value: 0, count: 0 }
      grouped[cat].value += p.quantity * p.cost_price
      grouped[cat].count += 1
    })
    return Object.values(grouped).sort((a, b) => b.value - a.value)
  },

  // Stock health overview
  getStockHealth: async (businessId = null) => {
    let q = supabase
      .from('products')
      .select('quantity, reorder_level, cost_price')
      .eq('status', 'active')

    if (businessId) q = q.eq('business_id', businessId)

    const { data, error } = await q
    if (error) throw error

    const total = data?.length || 0
    const outOfStock = (data || []).filter(p => p.quantity === 0).length
    const critical = (data || []).filter(p => p.quantity > 0 && p.quantity <= p.reorder_level * 0.5).length
    const low = (data || []).filter(p => p.quantity > p.reorder_level * 0.5 && p.quantity <= p.reorder_level).length
    const healthy = total - outOfStock - critical - low

    return [
      { name: 'Healthy', value: healthy, color: '#22c55e' },
      { name: 'Low', value: low, color: '#f59e0b' },
      { name: 'Critical', value: critical, color: '#ef4444' },
      { name: 'Out', value: outOfStock, color: '#9ca3af' },
    ]
  },
}

export default analyticsService