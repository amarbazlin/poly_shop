import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, LogOut, ChevronDown, Settings, Menu, AlertTriangle, Package, ShoppingBag, Clock } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useRBAC } from '../../context/RBACContext'
import { ROLE_LABELS, ROLE_COLORS } from '../../utils/permissions'
import { formatDate } from '../../utils/formatters'
import AppLogo from '../shared/AppLogo'

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }

const Navbar = ({ alertCount = 0, alerts = [], onToggleSidebar, isMobile }) => {
  const { profile, signOut } = useAuth()
  const { role }             = useRBAC()
  const navigate             = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)

  const groupedAlerts = useMemo(() => {
    const sorted = [...(alerts || [])].sort((a, b) => {
      const severityDelta = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
      if (severityDelta !== 0) return severityDelta
      return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    })

    return {
      critical: sorted.filter(alert => alert.severity === 'critical'),
      high: sorted.filter(alert => alert.severity === 'high'),
      medium: sorted.filter(alert => alert.severity === 'medium'),
      low: sorted.filter(alert => alert.severity === 'low'),
    }
  }, [alerts])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const today    = formatDate(new Date(), 'EEEE, dd MMM yyyy')
  const roleCfg  = ROLE_COLORS[role] || { bg: '#f3f4f6', color: '#6b7280' }
  const initials = profile?.full_name
    ?.split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U'

  const getAlertTarget = (alert) => {
    if (alert.related_purchase_order_id || alert.alert_type === 'late_delivery') {
      return '/finance'
    }
    const productId = alert.product_id || alert.products?.id
    return productId ? `/inventory/edit/${productId}` : '/alerts'
  }

  const getAlertIcon = (alert) => {
    if (alert.alert_type === 'late_delivery') return ShoppingBag
    if (alert.alert_type === 'dead_stock') return Clock
    return Package
  }

  return (
    <header className="app-navbar" style={{
      ...S.navbar,
      height: isMobile ? 56 : 64,
      padding: isMobile ? '0 14px' : '0 28px',
    }}>

      {/* ── Left: hamburger (mobile) OR greeting (desktop) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Hamburger — mobile / tablet only */}
        {isMobile && (
          <button
            onClick={onToggleSidebar}
            style={S.iconBtn}
            aria-label="Toggle menu"
          >
            <Menu size={18} color="var(--text-secondary)" />
          </button>
        )}

        {/* Greeting — hidden on mobile to save space */}
        {!isMobile && (
          <div>
            <h1 style={S.greeting}>
              Welcome back, {profile?.full_name?.split(' ')[0] || 'User'} 👋
            </h1>
            <p style={S.date}>{today}</p>
          </div>
        )}

        {/* Mobile: show logo + brand */}
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AppLogo size={24} />
            <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Forgera OS
            </span>
          </div>
        )}
      </div>

      {/* ── Right: actions ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setAlertsOpen(open => !open)}
            style={{
              ...S.iconBtn,
              position: 'relative',
              width: 38,
              height: 38,
            }}
            aria-label="Alerts"
          >
            <Bell size={17} color="var(--text-secondary)" />
            {alertCount > 0 && (
              <span style={S.badge}>{alertCount > 99 ? '99+' : alertCount}</span>
            )}
          </button>

          {alertsOpen && (
            <>
              <div style={S.dropdownOverlay} onClick={() => setAlertsOpen(false)} />
              <div style={{ ...S.dropdown, right: 0, minWidth: isMobile ? 300 : 380, maxWidth: '90vw' }}>
                <div style={{ padding: '14px 16px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Alert Center</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{alertCount} unresolved alerts</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setAlertsOpen(false); navigate('/alerts') }}
                      style={{
                        border: '1px solid var(--card-border)',
                        background: 'var(--card-bg)',
                        borderRadius: 8,
                        padding: '7px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Open all
                    </button>
                  </div>
                </div>

                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {Object.entries(groupedAlerts).map(([severity, items]) => (
                    items.length > 0 && (
                      <div key={severity} style={{ borderTop: '1px solid var(--card-border)' }}>
                        <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                          {severity}
                        </div>
                        {items.slice(0, 4).map(alert => {
                          const Icon = getAlertIcon(alert)
                          const target = getAlertTarget(alert)
                          return (
                            <button
                              key={alert.id}
                              type="button"
                              onClick={() => { setAlertsOpen(false); navigate(target) }}
                              style={{
                                width: '100%',
                                textAlign: 'left',
                                display: 'flex',
                                gap: 10,
                                alignItems: 'flex-start',
                                padding: '12px 16px',
                                border: 'none',
                                borderTop: '1px solid rgba(0,0,0,0.03)',
                                background: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(249,115,22,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Icon size={14} color="#f97316" />
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35 }}>{alert.message}</div>
                                <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text-muted)' }}>
                                  {new Date(alert.created_at).toLocaleString()}
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )
                  ))}

                  {alertCount === 0 && (
                    <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
                      No unresolved alerts.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>


        {/* Profile dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            style={S.profileBtn}
            onClick={() => setDropdownOpen(o => !o)}
            aria-label="Profile menu"
          >
            <div style={S.avatar}>{initials}</div>
            {/* Hide name/role text on mobile */}
            {!isMobile && (
              <div style={S.profileInfo}>
                <span style={S.profileName}>{profile?.full_name || 'User'}</span>
                <span style={{ ...S.profileRole, color: roleCfg.color }}>{ROLE_LABELS[role] || role}</span>
              </div>
            )}
            <ChevronDown
              size={13} color="var(--text-muted)"
              style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
            />
          </button>

          {dropdownOpen && (
            <>
              <div style={S.dropdownOverlay} onClick={() => setDropdownOpen(false)} />
              <div style={{
                ...S.dropdown,
                right: 0,
                minWidth: isMobile ? 200 : 230,
              }}>
                {/* User info header */}
                <div style={S.dropdownHeader}>
                  <div style={{ ...S.avatar, width: 36, height: 36, fontSize: 14, borderRadius: 10 }}>
                    {initials}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {profile?.full_name}
                    </div>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, fontFamily: 'Outfit, sans-serif',
                      background: roleCfg.bg, color: roleCfg.color,
                      padding: '1px 7px', borderRadius: 99, display: 'inline-block', marginTop: 2,
                    }}>
                      {ROLE_LABELS[role] || role}
                    </span>
                  </div>
                </div>

                <div style={S.dropdownDivider} />

                <button
                  style={S.dropdownItem}
                  onClick={() => { navigate('/settings'); setDropdownOpen(false) }}
                >
                  <Settings size={14} /> Profile & Settings
                </button>

                <div style={S.dropdownDivider} />

                <button
                  style={{ ...S.dropdownItem, color: 'var(--danger)', marginBottom: 4 }}
                  onClick={handleSignOut}
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>

    </header>
  )
}

const S = {
  navbar: {
    background: 'var(--card-bg)',
    borderBottom: '1px solid var(--card-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0, zIndex: 50,
    boxShadow: 'var(--shadow-xs)',
    flexShrink: 0,
  },
  greeting: {
    fontFamily: 'Outfit, sans-serif',
    fontSize: 15, fontWeight: 700,
    color: 'var(--text-primary)', margin: 0,
  },
  date: { fontSize: 11.5, color: 'var(--text-muted)', margin: '2px 0 0' },
  iconBtn: {
    width: 36, height: 36, borderRadius: 9,
    border: '1px solid var(--card-border)',
    background: 'var(--card-bg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    padding: '0 4px',
    borderRadius: 999,
    background: '#ef4444',
    color: '#fff',
    fontSize: 9.5,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid var(--card-bg)',
  },
  profileBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 8px 4px 4px',
    borderRadius: 10, border: '1px solid var(--card-border)',
    background: 'var(--card-bg)', cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  avatar: {
    width: 28, height: 28, borderRadius: 7,
    background: 'linear-gradient(135deg, #f97316, #ea6c00)',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 800, fontFamily: 'Outfit, sans-serif', flexShrink: 0,
  },
  profileInfo: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  profileName: { fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' },
  profileRole: { fontSize: 10, fontWeight: 600, fontFamily: 'Outfit, sans-serif' },
  dropdownOverlay: { position: 'fixed', inset: 0, zIndex: 199 },
  dropdown: {
    position: 'absolute', top: 'calc(100% + 8px)',
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-lg)',
    zIndex: 200, overflow: 'hidden',
  },
  dropdownHeader: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '14px 16px',
  },
  dropdownDivider: { height: 1, background: 'var(--card-border)' },
  dropdownItem: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 16px', width: '100%',
    border: 'none', background: 'none',
    cursor: 'pointer', fontSize: 13,
    color: 'var(--text-secondary)',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'background 0.12s',
    WebkitTapHighlightColor: 'transparent',
  },
}

export default Navbar