import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import RoleGuard from '../components/auth/RoleGuard'
import MainLayout from '../components/layout/MainLayout'
import { P, ROLES } from '../utils/permissions'

// Auth
import Login from '../pages/auth/Login'

// Core pages
import Dashboard        from '../pages/dashboard/Dashboard'
import POS              from '../pages/pos/POS'
import Inventory        from '../pages/inventory/Inventory'
import AddProduct       from '../pages/inventory/AddProduct'
import EditProduct      from '../pages/inventory/EditProduct'
import Sales            from '../pages/sales/Sales'
import Suppliers        from '../pages/suppliers/Suppliers'
import Purchases        from '../pages/purchases/Purchases'
import Customers        from '../pages/customers/Customers'
import CustomerDetail   from '../pages/customers/CustomerDetail'
import Analytics        from '../pages/analytics/Analytics'
import Finance          from '../pages/finance/Finance'
import Alerts           from '../pages/alerts/Alerts'
import Settings         from '../pages/settings/Settings'

// Access denied
import { AccessDenied } from '../components/auth/RoleGuard'

const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<Login />} />

    {/* ── All routes require authentication ── */}
    <Route element={<ProtectedRoute />}>
      <Route element={<MainLayout />}>

        {/* Dashboard — every authenticated role */}
        <Route index element={<Dashboard />} />

        {/* ── Inventory ── */}
        <Route element={<RoleGuard permission={P.VIEW_INVENTORY} />}>
          <Route path="/inventory" element={<Inventory />} />
        </Route>
        <Route element={<RoleGuard permission={P.MANAGE_INVENTORY} />}>
          <Route path="/inventory/add"      element={<AddProduct />} />
          <Route path="/inventory/edit/:id" element={<EditProduct />} />
        </Route>

        {/* ── Customers ── */}
        <Route element={<RoleGuard permission={P.VIEW_CUSTOMERS} />}>
          <Route path="/customers"     element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
        </Route>

        {/* ── Sales ── */}
        <Route element={<RoleGuard permission={P.VIEW_SALES} />}>
          <Route path="/sales" element={<Sales />} />
          <Route path="/pos" element={<POS />} />
        </Route>

        {/* ── Suppliers ── */}
        <Route element={<RoleGuard permission={P.VIEW_SUPPLIERS} />}>
          <Route path="/suppliers" element={<Suppliers />} />
        </Route>

        {/* ── Purchases — supplier bills & credit ── */}
        <Route element={<RoleGuard permission={P.VIEW_PURCHASES} />}>
          <Route path="/purchases" element={<Purchases />} />
        </Route>

        {/* ── Analytics ── */}
        <Route element={<RoleGuard permission={P.VIEW_ANALYTICS} />}>
          <Route path="/analytics" element={<Analytics />} />
        </Route>

        {/* ── Finance — Owner / GM / Accountant ── */}
        <Route element={<RoleGuard permission={P.VIEW_FINANCE} />}>
          <Route path="/finance" element={<Finance />} />
        </Route>

        {/* ── Alerts ── */}
        <Route element={<RoleGuard permission={P.VIEW_ALERTS} />}>
          <Route path="/alerts" element={<Alerts />} />
        </Route>

        {/* ── Settings — everyone, but tabs gated internally ── */}
        <Route path="/settings" element={<Settings />} />

        {/* ── Access denied page ── */}
        <Route path="/access-denied" element={<AccessDenied />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Route>
  </Routes>
)

export default AppRoutes
