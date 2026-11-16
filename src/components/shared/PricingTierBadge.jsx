import React from 'react'

export const PricingTierBadge = ({ tier }) => {
  if (!tier) return null
  const colors = { Retail: '#3b82f6', Contractor: '#f97316', Wholesale: '#8b5cf6', VIP: '#22c55e' }
  const color  = colors[tier.name] || '#6b7280'
  return (
    <span style={{ fontSize: 11, background: `${color}18`, color, padding: '2px 9px', borderRadius: 99, fontWeight: 700, fontFamily: 'Outfit, sans-serif', border: `1px solid ${color}30` }}>
      {tier.name} {tier.discount_percent > 0 ? `−${tier.discount_percent}%` : ''}
    </span>
  )
}

export default PricingTierBadge