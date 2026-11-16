import React from 'react'

export const CreditStatusBadge = ({ creditLimit, currentBalance }) => {
  if (!creditLimit || creditLimit === 0) {
    return (
      <span style={{ fontSize: 11, background: 'var(--content-bg)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>
        Cash only
      </span>
    )
  }

  const used    = parseFloat(currentBalance) || 0
  const limit   = parseFloat(creditLimit)
  const pct     = Math.min(100, (used / limit) * 100)
  const isOver  = used > limit
  const isHigh  = pct >= 80 && !isOver
  const color   = isOver ? '#dc2626' : isHigh ? '#d97706' : '#16a34a'
  const bg      = isOver ? '#fef2f2' : isHigh ? '#fffbeb' : '#f0fdf4'
  const label   = isOver ? 'Over limit' : isHigh ? 'Near limit' : 'Good standing'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ background: bg, color, padding: '1px 8px', borderRadius: 99, fontWeight: 700, fontSize: 11, fontFamily: 'Outfit, sans-serif' }}>{label}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>Rs.{used.toFixed(0)} / Rs.{limit.toFixed(0)}</span>
      </div>
      <div style={{ height: 4, background: '#e5e7eb', borderRadius: 99 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

export default CreditStatusBadge