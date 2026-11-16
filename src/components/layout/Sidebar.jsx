import React, { useState, useRef, useEffect, useCallback } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Package, Users2, ShoppingCart,
  ClipboardList, Building2, BarChart3, Bell,
  Sparkles, Settings, MessageSquare, Bot, Wallet,
  Receipt, X, Menu, ShoppingBag,
} from 'lucide-react'
import { useRBAC } from '../../context/RBACContext'
import { P } from '../../utils/permissions'
import AppLogo from '../shared/AppLogo'

const ICON_MAP = {
  LayoutDashboard, Package, Users2, ShoppingCart,
  ClipboardList, Building2, BarChart3, Bell,
  Sparkles, Settings, MessageSquare, Bot, Wallet,
  Receipt, ShoppingBag,
}

const NAV = [
  { path: '/',                label: 'Dashboard',      icon: 'LayoutDashboard', exact: true,  permission: null },
  { path: '/pos',             label: 'POS',            icon: 'Receipt',                        permission: P.VIEW_SALES          },
  { path: '/sales',           label: 'Sales',          icon: 'ShoppingCart',                   permission: P.VIEW_SALES          },
  { path: '/inventory',       label: 'Inventory',      icon: 'Package',                        permission: P.VIEW_INVENTORY      },
  { path: '/customers',       label: 'Customers',      icon: 'Users2',                         permission: P.VIEW_CUSTOMERS      },
  { path: '/suppliers',       label: 'Suppliers',      icon: 'Building2',                      permission: P.VIEW_SUPPLIERS      },
  { path: '/purchases',       label: 'Purchases',      icon: 'ShoppingBag',                   permission: P.VIEW_PURCHASES      },
  { path: '/analytics',       label: 'Analytics',      icon: 'BarChart3',                      permission: P.VIEW_ANALYTICS      },
  { path: '/finance',         label: 'Finance',        icon: 'Wallet',                         permission: P.VIEW_FINANCE        },
  { path: '/alerts',          label: 'Alerts',         icon: 'Bell',                           permission: P.VIEW_ALERTS, badge: true },
]

const SWIPE_THRESHOLD = 60
const SPRING_TRANSITION = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)'

const Sidebar = React.forwardRef(({
  alertCount = 0,
  isOpen,
  isMobile,
  collapsed = false,
  onCollapse,
  onExpand,
  onClose,
  onOpen,
}, ref) => {
  const location  = useLocation()
  const { can }   = useRBAC()
  const sidebarRef = useRef(null)
  const touchState = useRef({ startX: 0, startY: 0, dragX: 0, isDragging: false })

  // Icon-only rail (desktop only — the mobile drawer always shows labels)
  const isCollapsed = collapsed && !isMobile

  const isActive = (path, exact) =>
    exact ? location.pathname === path : location.pathname === path || location.pathname.startsWith(`${path}/`)

  const visibleNav = NAV.filter(item =>
    !item.permission || can(item.permission)
  )

  const getSidebarWidth = useCallback(() => {
    if (sidebarRef.current) {
      return sidebarRef.current.offsetWidth
    }
    return 280
  }, [])

  const handleTouchStart = useCallback((e) => {
    if (!isMobile) return
    const touch = e.touches[0]
    touchState.current.startX = touch.clientX
    touchState.current.startY = touch.clientY
    touchState.current.dragX = 0
    touchState.current.isDragging = true
  }, [isMobile])

  const handleTouchMove = useCallback((e) => {
  if (!isMobile || !touchState.current.isDragging) return
   e.preventDefault()
  e.stopPropagation()

    const touch = e.touches[0]
    const deltaX = touch.clientX - touchState.current.startX

    if (isOpen) {
      const sideW = getSidebarWidth()
      const clamped = Math.max(-sideW, Math.min(0, deltaX))
      touchState.current.dragX = clamped
      if (sidebarRef.current) {
        sidebarRef.current.style.transition = 'none'
        sidebarRef.current.style.transform = `translateX(${clamped}px)`
      }
    } else {
      const sideW = getSidebarWidth()
      const offset = -sideW + deltaX
      const clamped = Math.max(-sideW, Math.min(0, offset))
      touchState.current.dragX = clamped
      if (sidebarRef.current) {
        sidebarRef.current.style.transition = 'none'
        sidebarRef.current.style.transform = `translateX(${clamped}px)`
      }
    }
  }, [isMobile, isOpen, getSidebarWidth])

  const handleTouchEnd = useCallback((e) => {
    if (!isMobile || !touchState.current.isDragging) return
    touchState.current.isDragging = false

    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - touchState.current.startX
    const deltaY = touch.clientY - touchState.current.startY
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY)

    if (sidebarRef.current) {
      sidebarRef.current.style.transition = SPRING_TRANSITION
    }

    if (isOpen) {
      if (deltaX < -SWIPE_THRESHOLD && isHorizontal) {
        onClose()
      } else {
        if (sidebarRef.current) {
          sidebarRef.current.style.transform = 'translateX(0)'
        }
      }
    }
    touchState.current.dragX = 0
  }, [isMobile, isOpen, onClose])

  useEffect(() => {
    const el = sidebarRef.current
    if (!el || !isMobile) return
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isMobile, handleTouchStart, handleTouchMove, handleTouchEnd])

  useEffect(() => {
  const el = ref && ref.current ? ref.current : sidebarRef.current
  if (!isMobile || !el || touchState.current.isDragging) return
  el.style.transition = SPRING_TRANSITION
  el.style.transform = isOpen ? 'translateX(0)' : 'translateX(-100%)'

  // Prevent background page scroll when sidebar is open
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'
  } else {
    document.body.style.overflow = ''
    document.body.style.touchAction = ''
  }

  return () => {
    document.body.style.overflow = ''
    document.body.style.touchAction = ''
  }
}, [isMobile, isOpen, ref])

  return (
    <>
      <aside
        ref={ref || sidebarRef}
        style={{
          ...S.sidebar,
          ...(isCollapsed ? S.sidebarCollapsed : {}),
          transform: isMobile
            ? (isOpen ? 'translateX(0)' : 'translateX(-100%)')
            : 'translateX(0)',
          transition: `${SPRING_TRANSITION}, width 0.22s ease, min-width 0.22s ease`,
          boxShadow: isMobile && isOpen ? '4px 0 24px rgba(0,0,0,0.35)' : 'none',
          zIndex: 110,
        }}
      >
        <div style={isCollapsed ? S.logoAreaCollapsed : S.logoArea}>
          <div
            style={{ ...S.logoIcon, cursor: isCollapsed ? 'pointer' : 'default' }}
            onClick={isCollapsed ? onExpand : undefined}
            title={isCollapsed ? 'ForgeraAI — expand menu' : undefined}
          >
            <AppLogo size={26} />
          </div>
          {!isCollapsed && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.logoText}>ForgeraAI</div>
                <div style={S.logoSub}>Smart Inventory Decisions</div>
              </div>
              <button
                type="button"
                onClick={isMobile ? onClose : onCollapse}
                title={isMobile ? 'Close menu' : 'Hide sidebar (icon-only)'}
                aria-label={isMobile ? 'Close menu' : 'Hide sidebar'}
                style={S.iconBtn}
              >
                <X size={15} color="#9ca3af" />
              </button>
            </>
          )}
          {isCollapsed && (
            <button
              type="button"
              onClick={onExpand}
              title="Show sidebar"
              aria-label="Show sidebar"
              style={S.iconBtnCollapsed}
            >
              <Menu size={16} color="#9ca3af" />
            </button>
          )}
        </div>

        {!isCollapsed && <div style={S.sectionLabel}>MENU</div>}
        {isCollapsed && <div style={S.railSpacer} />}

        <nav style={S.nav}>
          {visibleNav.map(item => {
            const Icon   = ICON_MAP[item.icon]
            const active = isActive(item.path, item.exact)
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.exact}
                title={isCollapsed ? item.label : undefined}
                onClick={() => isMobile && onClose()}
                style={({ isActive: navActive }) => ({
                  ...S.navItem,
                  ...(isCollapsed ? S.navItemCollapsed : {}),
                  ...(active ? S.navItemActive : {}),
                })}
              >
                {Icon && <Icon size={isCollapsed ? 18 : 15} color={active ? '#f97316' : '#6b7280'} />}
                {!isCollapsed && <span style={S.navLabel}>{item.label}</span>}
                {item.badge && alertCount > 0 && (
                  isCollapsed
                    ? <span style={S.badgeDot} />
                    : <span style={S.badge}>{alertCount > 99 ? '99+' : alertCount}</span>
                )}
              </NavLink>
            )
          })}

          <NavLink
            to="/settings"
            title={isCollapsed ? 'Settings' : undefined}
            onClick={() => isMobile && onClose()}
            style={({ isActive: navActive }) => ({
              ...S.navItem,
              ...(isCollapsed ? S.navItemCollapsed : {}),
              ...(navActive ? S.navItemActive : {}),
            })}
          >
            <Settings size={isCollapsed ? 18 : 15} color={location.pathname === '/settings' ? '#f97316' : '#6b7280'} />
            {!isCollapsed && <span style={S.navLabel}>Settings</span>}
          </NavLink>
        </nav>

        {!isCollapsed && (
          <div style={S.footer}>
            <div style={S.footerIcon}><Sparkles size={13} color="#f97316" /></div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{
                fontSize: 11.5, fontWeight: 700, color: '#fff',
                fontFamily: 'Outfit, sans-serif',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                ForgeraAI v2.0
              </div>
              <div style={{
                fontSize: 10.5, color: '#4b5563', marginTop: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                Powered by Forgera
              </div>
            </div>
          </div>
        )}
        {isCollapsed && (
          <div style={S.footerCollapsed}>
            <div style={S.footerIcon}><Sparkles size={13} color="#f97316" /></div>
          </div>
        )}
        <style>{`
          aside::-webkit-scrollbar { display: none; }
          aside { -webkit-overflow-scrolling: touch; }
        `}</style>
      </aside>
    </>
  )
})

const S = {
  sidebar: {
  width: 'var(--sidebar-width)',
  minWidth: 'var(--sidebar-width)',
  height: '100dvh',
  background: '#0d1117',
  borderRight: '1px solid #1e2530',
  display: 'flex',
  flexDirection: 'column',
  position: 'fixed',
  top: 0, left: 0,
  zIndex: 110,
  overflowY: 'auto',
  overflowX: 'hidden',
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  overscrollBehavior: 'contain',
  WebkitOverflowScrolling: 'touch',
  maxWidth: '85vw',
},
  sidebarCollapsed: {
    width: 'var(--sidebar-collapsed-width)',
    minWidth: 'var(--sidebar-collapsed-width)',
  },
  logoArea: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '18px 14px 14px',
    borderBottom: '1px solid #1e2530', flexShrink: 0,
  },
  logoIcon: {
    width: 34, height: 34, borderRadius: 8,
    background: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    boxShadow: '0 4px 10px rgba(249,115,22,0.2)',
    overflow: 'hidden',
    padding: 2,
  },
  logoText: { fontFamily: 'Outfit,sans-serif', fontWeight: 800, fontSize: 14, color: '#fff', letterSpacing: '-0.02em' },
  logoSub:  { fontSize: 9.5, color: '#4b5563', marginTop: 1 },
  logoAreaCollapsed: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    padding: '14px 0 12px',
    borderBottom: '1px solid #1e2530', flexShrink: 0,
  },
  iconBtn: {
    background: 'rgba(255,255,255,0.07)', border: 'none',
    borderRadius: 8, width: 30, height: 30, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  iconBtnCollapsed: {
    background: 'rgba(255,255,255,0.07)', border: 'none',
    borderRadius: 8, width: 30, height: 26, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  railSpacer: { height: 10, flexShrink: 0 },
  sectionLabel:  { fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: '#374151', padding: '14px 16px 5px', fontFamily: 'Outfit,sans-serif', flexShrink: 0 },
  sectionLabel2: { fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: '#374151', padding: '12px 16px 4px', fontFamily: 'Outfit,sans-serif' },
  nav:  { display: 'flex', flexDirection: 'column', gap: 1, padding: '0 7px', flex: 1 },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '9px 10px', borderRadius: 7,
    textDecoration: 'none', color: '#8b949e',
    fontSize: 13, fontWeight: 450, transition: 'all 0.12s',
    fontFamily: 'DM Sans,sans-serif',
    WebkitTapHighlightColor: 'transparent',
    minHeight: 38,
  },
  navItemActive: { background: 'rgba(249,115,22,0.1)', color: '#fff' },
  navItemCollapsed: {
    justifyContent: 'center',
    padding: '9px 0',
    position: 'relative',
  },
  navLabel: { flex: 1 },
  badge: {
    background: '#f97316', color: '#fff', fontSize: 9.5,
    fontWeight: 700, borderRadius: 99, padding: '1px 5px',
    fontFamily: 'Outfit,sans-serif',
  },
  badgeDot: {
    position: 'absolute', top: 6, right: 12,
    width: 7, height: 7, borderRadius: '50%', background: '#f97316',
  },
  subMenu: { display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 7, marginBottom: 2 },
  subItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', borderRadius: 6,
    textDecoration: 'none', fontSize: 12.5,
    transition: 'all 0.12s', fontFamily: 'DM Sans,sans-serif',
    paddingLeft: 14,
    WebkitTapHighlightColor: 'transparent',
    minHeight: 36,
  },
  footer: {
  margin: '10px 7px 14px',
  padding: '11px 12px',
  paddingBottom: 'calc(11px + env(safe-area-inset-bottom))',
  marginBottom: 'calc(14px + env(safe-area-inset-bottom))',
  background: '#161b22',
  border: '1px solid #1e2530',
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  minWidth: 0,
  overflow: 'hidden',
  boxSizing: 'border-box',
},
  footerCollapsed: {
    margin: '10px 0 calc(14px + env(safe-area-inset-bottom))',
    padding: '9px 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  footerIcon: {
    width: 26, height: 26, borderRadius: 7,
    background: 'rgba(249,115,22,0.12)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
}

export default Sidebar