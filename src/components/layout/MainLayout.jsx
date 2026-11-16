import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'
import { useAlerts } from '../../hooks/useAlerts'
import { useBreakpoint } from '../../hooks/useBreakpoint'

const SWIPE_THRESHOLD = 60
const EDGE_THRESHOLD = 30
const SPRING_TRANSITION = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)'

const MainLayout = () => {
  const { alerts, unresolvedCount } = useAlerts()
  const { isMobile, isTablet } = useBreakpoint()
  const isCompact = isMobile || isTablet
  const location = useLocation()

  // Sidebar open state — closed by default on mobile, always open on desktop
  const [sidebarOpen, setSidebarOpen] = useState(!isCompact)
  // Desktop: collapse the sidebar to an icon-only rail (persisted)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('forgera:sidebar-collapsed') === '1' } catch { return false }
  })
  const sidebarRef = useRef(null)

  useEffect(() => {
    try { localStorage.setItem('forgera:sidebar-collapsed', sidebarCollapsed ? '1' : '0') } catch { /* ignore */ }
  }, [sidebarCollapsed])

  // Edge-swipe state (mobile only)
  const edgeSwipe = useRef({
    startX: 0,
    startY: 0,
    isSwiping: false,
    swipedFromEdge: false,
  })

  // Close sidebar on route change (mobile / tablet)
  useEffect(() => {
    if (isCompact) setSidebarOpen(false)
  }, [location.pathname, isCompact])

  // When screen resizes to desktop, keep sidebar open
  useEffect(() => {
    if (!isCompact) setSidebarOpen(true)
  }, [isCompact])


  const toggleSidebar = () => {
    // Mobile: open/close the drawer. Desktop: collapse/expand to the icon rail.
    if (isCompact) setSidebarOpen(o => !o)
    else setSidebarCollapsed(c => !c)
  }
  const collapseSidebar = () => setSidebarCollapsed(true)
  const expandSidebar   = () => setSidebarCollapsed(false)
  const closeSidebar  = () => setSidebarOpen(false)
  const openSidebar   = () => setSidebarOpen(true)

  // ── Edge swipe to open sidebar (mobile only) ──
  const handleMainTouchStart = useCallback((e) => {
    if (!isCompact) return
    const touch = e.touches[0]
    edgeSwipe.current.startX = touch.clientX
    edgeSwipe.current.startY = touch.clientY
    edgeSwipe.current.swipedFromEdge = touch.clientX <= EDGE_THRESHOLD

    if (edgeSwipe.current.swipedFromEdge && !sidebarOpen) {
      edgeSwipe.current.isSwiping = true
    } else {
      edgeSwipe.current.isSwiping = false
    }
  }, [isCompact, sidebarOpen])

  const handleMainTouchMove = useCallback((e) => {
    if (!isCompact || !edgeSwipe.current.isSwiping || sidebarOpen) return
    const touch = e.touches[0]
    const deltaX = touch.clientX - edgeSwipe.current.startX

    if (deltaX <= 0) {
      // Not swiping right — cancel
      edgeSwipe.current.isSwiping = false
      return
    }

    // Follow the finger in real time
    if (sidebarRef.current) {
      const sideW = sidebarRef.current.offsetWidth || 280
      const offset = -sideW + deltaX
      const clamped = Math.max(-sideW, Math.min(0, offset))
      sidebarRef.current.style.transition = 'none'
      sidebarRef.current.style.transform = `translateX(${clamped}px)`
    }
  }, [isCompact, sidebarOpen])

  const handleMainTouchEnd = useCallback((e) => {
    if (!isCompact || !edgeSwipe.current.isSwiping) return

    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - edgeSwipe.current.startX
    const deltaY = touch.clientY - edgeSwipe.current.startY
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY)

    if (sidebarRef.current) {
      sidebarRef.current.style.transition = SPRING_TRANSITION
    }

    if (deltaX > SWIPE_THRESHOLD && isHorizontal && edgeSwipe.current.swipedFromEdge) {
      openSidebar()
    } else {
      // Snap back closed
      if (sidebarRef.current) {
        sidebarRef.current.style.transform = 'translateX(-100%)'
      }
    }

    edgeSwipe.current.isSwiping = false
    edgeSwipe.current.swipedFromEdge = false
  }, [isCompact, sidebarOpen])

  // Attach touch listeners on the main content for edge swipe
  useEffect(() => {
    // We attach on the document so we can catch touches near the left edge
    // regardless of what element the user touches
    document.addEventListener('touchstart', handleMainTouchStart, { passive: true })
    document.addEventListener('touchmove', handleMainTouchMove, { passive: true })
    document.addEventListener('touchend', handleMainTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleMainTouchStart)
      document.removeEventListener('touchmove', handleMainTouchMove)
      document.removeEventListener('touchend', handleMainTouchEnd)
    }
  }, [handleMainTouchStart, handleMainTouchMove, handleMainTouchEnd])

  return (
    <div style={styles.root}>
      {/* ── Backdrop (mobile only) ── */}
      {isCompact && (
        <div
          className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`}
          onClick={closeSidebar}
        />
      )}

      {/* ── Sidebar ── */}
      <Sidebar
        ref={sidebarRef}
        alertCount={unresolvedCount}
        isOpen={sidebarOpen}
        isMobile={isCompact}
        collapsed={!isCompact && sidebarCollapsed}
        onCollapse={collapseSidebar}
        onExpand={expandSidebar}
        onClose={closeSidebar}
        onOpen={openSidebar}
      />

      {/* ── Main area ── */}
      <div
        style={{
          ...styles.main,
          marginLeft: isCompact
            ? 0
            : (sidebarCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)'),
          transition: 'margin-left 0.25s ease',
        }}
      >
        <Navbar
          alertCount={unresolvedCount}
          alerts={alerts}
          onToggleSidebar={toggleSidebar}
          isMobile={isCompact}
        />
        <div style={styles.content}>
          <Outlet />
        </div>
      </div>

    </div>
  )
}

const styles = {
  root: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    background: 'var(--content-bg)',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
}

export default MainLayout