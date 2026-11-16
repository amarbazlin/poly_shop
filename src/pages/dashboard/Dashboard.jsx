import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  Clock,
  CreditCard,
  Package,
  RefreshCw,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { salesService } from '../../services/salesService'
import { productService } from '../../services/productService'
import { inventoryIntelligenceService } from '../../services/inventoryIntelligenceService'
import { customerService } from '../../services/customerService'
import { alertsService } from '../../services/alertsService'
import { formatCurrencyShort } from '../../utils/formatters'
import StockStatusBadge from '../../components/inventory/StockStatusBadge'
import Loader from '../../components/shared/Loader'

const emptyDashboard = {
  todaySales: { total: 0, count: 0, creditTotal: 0, profit: 0 },
  inventoryValue: { totalValue: 0, totalUnits: 0, productCount: 0 },
  lowStock: [],
  criticalStock: [],
  reorder: [],
  topProducts: [],
  slowMoving: [],
  alerts: [],
}

const safeLoad = async (label, loader, fallback, errors) => {
  try {
    return await loader()
  } catch (error) {
    console.error(`Dashboard ${label} failed`, error)
    errors.push(label)
    return fallback
  }
}

const StatCard = ({ title, value, detail, icon: Icon, tone = 'orange', loading }) => (
  <div className={`dashboard-stat dashboard-stat-${tone}`}>
    <div className="dashboard-stat-icon"><Icon size={18} /></div>
    <div>
      <p>{title}</p>
      {loading ? <div className="skeleton" style={{ height: 28, width: 120 }} /> : <strong>{value}</strong>}
      {detail && <span>{detail}</span>}
    </div>
  </div>
)

const SectionHeader = ({ title, subtitle, action, onAction }) => (
  <div className="dashboard-section-header">
    <div>
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {action && (
      <button type="button" onClick={onAction}>
        {action}
        <ArrowRight size={14} />
      </button>
    )}
  </div>
)

const EmptyState = ({ children }) => (
  <div className="dashboard-empty">{children}</div>
)

const ReorderTable = ({ items, loading }) => {
  const navigate = useNavigate()

  if (loading) return <div className="dashboard-loading"><Loader /></div>
  if (!items.length) return <EmptyState>No products need reorder right now.</EmptyState>

  return (
    <div className="table-scroll-wrapper">
      <table className="data-table dashboard-decision-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Stock</th>
            <th>Days Left</th>
            <th>Recommended Qty</th>
            <th>Supplier</th>
            <th>Estimated Cost</th>
            <th>Urgency</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} onClick={() => navigate(`/inventory/edit/${item.id}`)}>
              <td>
                <div className="dashboard-product-name">{item.product_name}</div>
                <div className="dashboard-product-code">{item.product_code || item.category}</div>
              </td>
              <td>
                <strong className={item.current_stock === 0 ? 'danger-text' : ''}>{item.current_stock}</strong>
                <span className="dashboard-muted"> / {item.reorder_level}</span>
                {item.reorder_level_warning && <div className="danger-text">{item.reorder_level_warning}</div>}
              </td>
              <td>{item.days_remaining >= 900 ? 'No sales' : `${Math.ceil(item.days_remaining)} days`}</td>
              <td><strong>{item.suggested_qty}</strong></td>
              <td>
                <div>{item.supplier}</div>
                <span className={item.lead_time_configured ? 'dashboard-muted' : 'danger-text'}>
                  {item.lead_time_warning || `${item.lead_time_days} day lead`}
                </span>
              </td>
              <td>{formatCurrencyShort(item.estimated_cost ?? 0)}</td>
              <td><span className={`dashboard-pill dashboard-pill-${item.urgency}`}>{item.urgency}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ProductList = ({ items, loading, type }) => {
  if (loading) return <div className="dashboard-loading"><Loader /></div>

  if (!items.length) {
    return (
      <EmptyState>
        {type === 'critical' && 'No critical stock alerts.'}
        {type === 'top' && 'No sales data found yet.'}
        {type === 'slow' && 'No slow-moving products found.'}
        {type === 'low' && 'No low stock products.'}
      </EmptyState>
    )
  }

  return (
    <div className="dashboard-list">
      {items.map((item, index) => {
        const product = item.product || item
        const id = product.id || item.id || index
        const stock = item.current_stock ?? item.quantity
        return (
          <div className="dashboard-list-row" key={id}>
            <div className="dashboard-rank">{index + 1}</div>
            <div className="dashboard-list-main">
              <strong>{product.product_name || item.product_name}</strong>
              <span>{product.product_code || item.product_code || item.category || 'Uncategorized'}</span>
            </div>
            <div className="dashboard-list-side">
              {type === 'top' && (
                <>
                  <strong>{item.qty} sold</strong>
                  <span>{formatCurrencyShort(item.revenue ?? 0)}</span>
                </>
              )}
              {type === 'slow' && (
                <>
                  <strong>{formatCurrencyShort(item.inventory_value ?? 0)}</strong>
                  <span>{stock} in stock</span>
                </>
              )}
              {(type === 'critical' || type === 'low') && (
                <>
                  <StockStatusBadge quantity={stock} reorderLevel={item.reorder_level} />
                  <span>{stock} / {item.reorder_level}</span>
                  {item.reorder_level_warning && <span className="danger-text">{item.reorder_level_warning}</span>}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const AlertList = ({ items, loading }) => {
  const navigate = useNavigate()

  const getTarget = (alert) => {
    if (alert.related_purchase_order_id || alert.alert_type === 'late_delivery') {
      return '/finance'
    }
    const productId = alert.product_id || alert.products?.id
    return productId ? `/inventory/edit/${productId}` : '/alerts'
  }

  if (loading) return <div className="dashboard-loading"><Loader /></div>

  if (!items.length) {
    return <EmptyState>No critical alerts right now.</EmptyState>
  }

  return (
    <div className="dashboard-list">
      {items.map((alert, index) => {
        const colors = {
          critical: { bg: '#fef2f2', text: '#dc2626' },
          high: { bg: '#fff7ed', text: '#f97316' },
          medium: { bg: '#fffbeb', text: '#d97706' },
          low: { bg: '#f0fdf4', text: '#16a34a' },
        }[alert.severity] || { bg: '#fffbeb', text: '#d97706' }

        return (
          <div className="dashboard-list-row" key={alert.id} onClick={() => navigate(getTarget(alert))} role="button" tabIndex={0}>
            <div className="dashboard-rank">{index + 1}</div>
            <div className="dashboard-list-main">
              <strong>{alert.message}</strong>
              <span>{(alert.alert_type || '').replace(/_/g, ' ')}</span>
            </div>
            <div className="dashboard-list-side">
              <span style={{ background: colors.bg, color: colors.text, padding: '4px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                {alert.severity}
              </span>
              <span>{new Date(alert.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Dashboard() {
  const { businessId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(emptyDashboard)
  const [failedSections, setFailedSections] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    let active = true

    const loadDashboard = async () => {
      setLoading(true)
      const errors = []

      // First, fetch reorder analysis (this is the heaviest query — we'll reuse it for risk metrics)
      let reorderAnalysis = emptyDashboard.reorder
      let riskMetricsData = null

      // Fetch the heavy reorder analysis once and cache it
      const [reorderResult,
        todaySales,
        inventoryValue,
        lowStock,
        topProducts,
        slowMoving,
        alerts,
      ] = await Promise.all([
        safeLoad('reorder recommendations', () => inventoryIntelligenceService.getReorderAnalysis({ days: 30, businessId }), emptyDashboard.reorder, errors),
        safeLoad('today sales', () => salesService.getTodaySales(businessId), emptyDashboard.todaySales, errors),
        safeLoad('inventory value', () => productService.getInventoryValue(businessId), emptyDashboard.inventoryValue, errors),
        safeLoad('low stock products', () => productService.getBelowReorder(businessId), emptyDashboard.lowStock, errors),
        safeLoad('top products', () => salesService.getTopProducts(8, 30, businessId), emptyDashboard.topProducts, errors),
        safeLoad('slow moving products', () => inventoryIntelligenceService.getSlowMovingProducts(30, businessId), emptyDashboard.slowMoving, errors),
        safeLoad(
          'stock alerts',
          () => alertsService.getAll({
            resolved: false,
            type: ['low_stock', 'out_of_stock', 'dead_stock', 'late_delivery'],
            severity: ['critical', 'high'],
            limit: 8,
          }),
          emptyDashboard.alerts,
          errors,
        ),
      ])

      reorderAnalysis = reorderResult

      // Load risk metrics using pre-computed analysis (avoids re-fetching everything)
      riskMetricsData = await safeLoad(
        'risk metrics',
        () => inventoryIntelligenceService.getRiskMetrics(30, businessId, reorderAnalysis),
        null,
        errors,
      )

      const criticalStock = (reorderAnalysis || [])
        .filter(item => item.urgency === 'critical')
        .sort((a, b) => a.days_remaining - b.days_remaining || a.current_stock - b.current_stock)

      if (!active) return
      setData({
        todaySales,
        inventoryValue,
        lowStock,
        riskMetrics: riskMetricsData,
        criticalStock: alerts,
        reorder: reorderAnalysis,
        topProducts,
        slowMoving,
        alerts,
      })
      setFailedSections(errors)
      setLoading(false)
    }

    loadDashboard()
    return () => { active = false }
  }, [businessId])

  const reorderItems = useMemo(() => (
    (data.reorder || [])
      .filter(item => ['critical', 'high', 'medium'].includes(item.urgency))
      .sort((a, b) => {
        const urgencyScore = { critical: 3, high: 2, medium: 1, low: 0 }
        return urgencyScore[b.urgency] - urgencyScore[a.urgency] || a.days_remaining - b.days_remaining
      })
      .slice(0, 8)
  ), [data.reorder])

  const criticalCount = data.criticalStock.length
  const lowStockCount = data.lowStock.length

  const todayTotal = data.todaySales.total ?? 0
  const todayProfit = data.todaySales.profit ?? 0
  const todayMargin = todayTotal > 0 ? ((todayProfit / todayTotal) * 100).toFixed(1) : null

  return (
    <div className="page-wrapper dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Inventory decisions, stock risk, cash and credit at a glance</p>
        </div>
        <button className="dashboard-refresh" type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      {failedSections.length > 0 && (
        <div className="dashboard-warning">
          <AlertTriangle size={16} />
          Some dashboard data could not be loaded: {failedSections.join(', ')}.
        </div>
      )}

      <div className="dashboard-stat-grid">
        <StatCard
          title="Today's Sales"
          value={formatCurrencyShort(data.todaySales.total ?? 0)}
          detail={`${data.todaySales.count ?? 0} sales today`}
          icon={ShoppingCart}
          loading={loading}
        />
        <StatCard
          title="Today's Profit"
          value={formatCurrencyShort(todayProfit)}
          detail={todayMargin !== null ? `${todayMargin}% margin` : 'No sales yet today'}
          icon={Banknote}
          tone="blue"
          loading={loading}
        />
        <StatCard
          title="Current Inventory Value"
          value={formatCurrencyShort(data.inventoryValue.totalValue ?? 0)}
          detail={`${data.inventoryValue.productCount ?? 0} active products`}
          icon={Boxes}
          tone="green"
          loading={loading}
        />
        <StatCard
          title="Low Stock Products"
          value={lowStockCount}
          detail="at or below reorder level"
          icon={Package}
          tone="red"
          loading={loading}
        />
      </div>

      <div className="dashboard-primary-grid">
        <section className="card dashboard-reorder-card">
          <SectionHeader
            title="Products Recommended for Reorder"
            subtitle="Prioritized by urgency, days remaining and expected reorder cost"
            action="Open Inventory"
            onAction={() => navigate('/inventory')}
          />
          <ReorderTable items={reorderItems} loading={loading} />
        </section>

        <section className="card dashboard-alert-card">
          <SectionHeader title="Critical Stock Alerts" subtitle="Stockouts and products expected to run out within 3 days" />
          <div className="dashboard-alert-count">
            <AlertTriangle size={24} />
            <strong>{loading ? '...' : criticalCount}</strong>
            <span>open alerts</span>
          </div>
          <AlertList items={data.criticalStock.slice(0, 5)} loading={loading} />
        </section>
      </div>

      <div className="dashboard-secondary-grid">
        <section className="card dashboard-panel">
          <SectionHeader title="Top Selling Products" subtitle="Last 30 days" />
          <ProductList items={data.topProducts.slice(0, 8)} loading={loading} type="top" />
        </section>

        <section className="card dashboard-panel">
          <SectionHeader title="Slow Moving Products" subtitle="In stock with no sales in the last 30 days" />
          <ProductList items={data.slowMoving.slice(0, 8)} loading={loading} type="slow" />
        </section>

        <section className="card dashboard-panel">
          <SectionHeader title="Low Stock Products" subtitle="All items at or below reorder level" />
          <ProductList items={data.lowStock.slice(0, 8)} loading={loading} type="low" />
        </section>
      </div>

    </div>
  )
}