import React, { useEffect, useState, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Legend, ReferenceLine
} from 'recharts'
import { RefreshCw, FileSpreadsheet, TrendingUp, TrendingDown } from 'lucide-react'
import { analyticsService } from '../../services/analyticsService'
import { reportService } from '../../services/reportService'
import { supplierService } from '../../services/supplierService'
import { locationService } from '../../services/locationService'
import { useAuth } from '../../context/AuthContext'
import { formatCurrencyShort, formatNumber } from '../../utils/formatters'
import Loader from '../../components/shared/Loader'
import Button from '../../components/shared/Button'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0d1117', border: '1px solid #1e2530', borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: 13, fontWeight: 600, fontFamily: 'Outfit, sans-serif' }}>
          {p.name}: {typeof p.value === 'number' && p.value > 500 ? formatCurrencyShort(p.value) : p.value}
        </p>
      ))}
    </div>
  )
}

const ScatterTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ background: '#0d1117', border: '1px solid #1e2530', borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ color: '#f97316', fontSize: 12, fontWeight: 700, fontFamily: 'Outfit, sans-serif' }}>{d.product_name}</p>
      <p style={{ color: '#9ca3af', fontSize: 11 }}>Units Sold: {formatNumber(d.units_sold)}</p>
      <p style={{ color: '#9ca3af', fontSize: 11 }}>Revenue: {formatCurrencyShort(d.revenue_lkr)}</p>
    </div>
  )
}

const truncateAxisLabel = (value, maxLength = 18) => {
  if (typeof value !== 'string' || value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

const SectionHeader = ({ title, subtitle }) => (
  <div style={{ marginBottom: 16 }}>
    <h3 style={{ fontFamily: 'Outfit, sans-serif', fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
    {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</p>}
  </div>
)

const CATEGORY_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4']
const STATUS_COLORS = { Healthy: '#22c55e', Low: '#f59e0b', Critical: '#ef4444', 'Out of Stock': '#9ca3af', Overstocked: '#3b82f6' }

const TABS = [
  { key: 'sales', label: 'Sales Report' },
  { key: 'inventory', label: 'Inventory Report' },
  { key: 'suppliers', label: 'Supplier Report' },
  { key: 'purchases', label: 'Purchase Report' },
]

// ── Shared sub-components ────────────────────────────────────────────────
const ReportFilters = ({ dateFrom, dateTo, onDateFromChange, onDateToChange, children }) => (
  <div className="analytics-filter-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
    <div>
      <label style={{ fontSize: 11, marginBottom: 4 }}>Date From</label>
      <input className="input-base" type="date" value={dateFrom} onChange={e => onDateFromChange(e.target.value)}
        style={{ width: 150, fontSize: 12, padding: '6px 10px' }} />
    </div>
    <div>
      <label style={{ fontSize: 11, marginBottom: 4 }}>Date To</label>
      <input className="input-base" type="date" value={dateTo} onChange={e => onDateToChange(e.target.value)}
        style={{ width: 150, fontSize: 12, padding: '6px 10px' }} />
    </div>
    {children}
  </div>
)

const KpiRow = ({ kpis }) => (
  <div className="grid-4 analytics-kpi-row" style={{ marginBottom: 20 }}>
    {kpis.map(k => (
      <div key={k.label} className="card" style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>{k.label}</div>
        <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 24, fontWeight: 800, color: k.color || 'var(--text-primary)' }}>
          {k.value}
        </div>
      </div>
    ))}
  </div>
)

const DataTable = ({ headers, rows }) => (
  <div className="table-scroll-wrapper">
    <table className="data-table">
      <thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell ?? '—'}</td>)}</tr>)}
      </tbody>
    </table>
  </div>
)

const ExportButtons = ({ onExcel, loading }) => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Button variant="secondary" size="sm" icon={<FileSpreadsheet size={14} />} onClick={onExcel} disabled={loading}>Export Excel</Button>
  </div>
)

// ── Chart wrappers for consistent sizing ─────────────────────────────────
const ChartCard = ({ title, subtitle, height = 250, children, style, className = '' }) => (
  <div className={`card analytics-chart-card ${className}`.trim()} style={{ padding: '20px 24px', ...style }}>
    <SectionHeader title={title} subtitle={subtitle} />
    <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
  </div>
)

// ═════════════════════════════════════════════════════════════════════════
// INVENTORY REPORT TAB — Phase 3 charts
// ═════════════════════════════════════════════════════════════════════════
const InventoryReportTab = () => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [locations, setLocations] = useState([])
  const [locationId, setLocationId] = useState('')

  useEffect(() => { locationService.getActive().then(setLocations).catch(() => {}) }, [])

  const load = useCallback((locId) => {
    setLoading(true)
    setError(null)
    reportService.getInventoryReport(locId ? { location_id: locId } : {})
      .then(setData).catch(err => {
        console.error(err)
        setError(err.message || 'Failed to load inventory report')
      }).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load(locationId) }, [locationId, load])

  // Category breakdown for bar chart (cost vs retail side-by-side)
  const categoryBarData = (data?.category_breakdown || []).map(c => ({
    name: c.name,
    Cost: Math.round(c.value_cost_lkr),
    Retail: Math.round(c.value_retail_lkr),
  }))

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11, marginBottom: 4 }}>Location</label>
          <select className="input-base" value={locationId} onChange={e => setLocationId(e.target.value)} style={{ width: 180, fontSize: 12, padding: '6px 10px' }}>
            <option value="">All Locations</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <ExportButtons
          onExcel={() => reportService.downloadInventoryExcel(locationId ? { location_id: locationId } : {})}
          loading={loading}
        />
      </div>
      {loading ? <Loader /> : error ? (
        <div className="card" style={{ padding: '20px 24px', background: '#fef2f2', border: '1px solid #fecaca' }}>
          <p style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 6 }}>Failed to load inventory report</p>
          <p style={{ fontSize: 12, color: '#991b1b' }}>{error}</p>
        </div>
      ) : !data ? <p style={{ color: 'var(--text-muted)' }}>No data available</p> : (
        <>
          <KpiRow kpis={[
            { label: 'Total Products', value: formatNumber(data.total_products), color: '#3b82f6' },
            { label: 'Total Units', value: formatNumber(data.total_stock_units), color: '#22c55e' },
            { label: 'Value (Cost)', value: formatCurrencyShort(data.total_stock_value_at_cost_lkr), color: '#f97316' },
            { label: 'Value (Retail)', value: formatCurrencyShort(data.total_stock_value_at_retail_lkr), color: '#a855f7' },
          ]} />

          {/* Inventory Value by Category — Bar Chart (Cost vs Retail) */}
          <ChartCard title="Inventory Value by Category" subtitle="Cost vs retail value per category" height={280} style={{ marginTop: 16 }}>
            <BarChart data={categoryBarData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => formatCurrencyShort(v).replace('Rs. ', '')} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={50} />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="rect" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="Cost" name="Cost Value" fill="#f97316" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Retail" name="Retail Value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>

          {/* Top 10 Highest-Value Tied-Up Stock — Horizontal Bar */}
          <ChartCard title="Top 10 Highest-Value Tied-Up Stock" subtitle="Products holding the most capital" height={Math.min((data.top_tied_up_stock?.length || 0) * 40 + 20, 300)} style={{ marginTop: 16 }}>
            <BarChart data={(data.top_tied_up_stock || []).slice(0, 10)} layout="vertical" margin={{ left: 135, right: 20, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" tickFormatter={v => formatCurrencyShort(v).replace('Rs. ', '')} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="product_name" tickFormatter={(value) => truncateAxisLabel(value, 20)} tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={125} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="tied_up_value_lkr" name="Tied-up Value" fill="#ef4444" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartCard>

        </>
      )}
    </>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// SUPPLIER REPORT TAB — Phase 3 charts
// ═════════════════════════════════════════════════════════════════════════
const SupplierReportTab = () => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback((params) => {
    setLoading(true)
    setError(null)
    reportService.getSupplierReport(params).then(setData).catch(err => {
      console.error(err)
      setError(err.message || 'Failed to load supplier report')
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load({}) }, [load])

  const handleApply = () => {
    const params = {}
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    load(params)
  }

  // Purchase volume by supplier — bar chart
  const volumeBarData = (data?.suppliers || []).map(s => ({
    name: s.supplier_name,
    volume: s.total_purchase_volume_lkr,
  })).sort((a, b) => b.volume - a.volume)

  // On-time delivery rate — horizontal bar
  const onTimeData = (data?.suppliers || [])
    .filter(s => s.on_time_delivery_rate != null)
    .map(s => ({
      name: s.supplier_name,
      rate: s.on_time_delivery_rate,
      color: s.on_time_delivery_rate >= 80 ? '#22c55e' : s.on_time_delivery_rate >= 50 ? '#f59e0b' : '#ef4444',
    }))
    .sort((a, b) => b.rate - a.rate)

  return (
    <>
      <ReportFilters dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo}>
        <Button variant="secondary" size="sm" onClick={handleApply} icon={<RefreshCw size={14} />}>Apply</Button>
        <ExportButtons onExcel={() => reportService.downloadSupplierExcel({ date_from: dateFrom, date_to: dateTo })} loading={loading} />
      </ReportFilters>
      {loading ? <Loader /> : error ? (
        <div className="card" style={{ padding: '20px 24px', background: '#fef2f2', border: '1px solid #fecaca' }}>
          <p style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 6 }}>Failed to load supplier report</p>
          <p style={{ fontSize: 12, color: '#991b1b' }}>{error}</p>
        </div>
      ) : !data ? <p style={{ color: 'var(--text-muted)' }}>No data available</p> : (
        <>
          <KpiRow kpis={[
            { label: 'Active Suppliers', value: formatNumber(data.total_suppliers), color: '#3b82f6' },
            { label: 'Total POs', value: formatNumber(data.total_pos), color: '#22c55e' },
            { label: 'Total Volume', value: formatCurrencyShort(data.total_purchase_volume_lkr), color: '#f97316' },
            { label: 'Period', value: `${data.date_from} to ${data.date_to}` },
          ]} />

          {/* Purchase Volume by Supplier */}
          <ChartCard title="Purchase Volume by Supplier" subtitle="LKR spent per supplier over the period" height={Math.min(volumeBarData.length * 40 + 20, 300)} style={{ marginBottom: 16 }}>
            <BarChart data={volumeBarData.slice(0, 10)} layout="vertical" margin={{ left: 100, right: 20, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" tickFormatter={v => formatCurrencyShort(v).replace('Rs. ', '')} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={100} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="volume" name="Volume (LKR)" fill="#f97316" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartCard>

          {/* On-Time Delivery Rate */}
          <ChartCard title="On-Time Delivery Rate by Supplier" subtitle="% of POs received by expected delivery date" height={Math.min(onTimeData.length * 40 + 20, 300)} style={{ marginBottom: 16 }}>
            <BarChart data={onTimeData} layout="vertical" margin={{ left: 100, right: 40, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={100} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Bar dataKey="rate" name="On-Time Rate" radius={[0, 4, 4, 0]}>
                {onTimeData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ChartCard>

          <div className="card analytics-table-card" style={{ padding: '20px 24px' }}>
            <SectionHeader title="Supplier Performance Details" subtitle="Purchase volume, lead time & on-time rate" />
            <DataTable
              headers={['Supplier', 'PO Count', 'Volume (LKR)', 'Avg Lead Time', 'On-Time Rate']}
              rows={(data.suppliers || []).map(s => [
                s.supplier_name,
                s.po_count,
                formatCurrencyShort(s.total_purchase_volume_lkr),
                s.avg_observed_lead_time_days != null ? `${s.avg_observed_lead_time_days} days` : '—',
                s.on_time_delivery_rate != null ? `${s.on_time_delivery_rate}%` : '—',
              ])}
            />
          </div>
        </>
      )}
    </>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// PURCHASE REPORT TAB — Phase 3 charts
// ═════════════════════════════════════════════════════════════════════════
const PurchaseReportTab = () => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const { businessId } = useAuth()

  useEffect(() => { supplierService.getAll({ businessId }).then(setSuppliers).catch(() => {}) }, [businessId])

  const load = useCallback((params) => {
    setLoading(true)
    setError(null)
    reportService.getPurchaseReport(params).then(setData).catch(err => {
      console.error(err)
      setError(err.message || 'Failed to load purchase report')
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load({}) }, [load])

  const handleApply = () => {
    const params = {}
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    if (supplierId) params.supplier_id = supplierId
    load(params)
  }

  // Trend data for current period only
  const trendData = (data?.trend || []).map((t, i) => {
    return {
      period: t.period,
      spend: t.total_lkr,
    }
  })

  // Spend by category — donut
  const categoryDonutData = (data?.spending_by_category || []).map(c => ({
    name: c.category,
    value: c.total_lkr,
  })).sort((a, b) => b.value - a.value)

  // Spend by supplier — bar
  const supplierBarData = (data?.spending_by_supplier || []).map(s => ({
    name: s.supplier_name,
    spend: s.total_lkr,
  })).sort((a, b) => b.spend - a.spend)

  return (
    <>
      <ReportFilters dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo}>
        <div>
          <label style={{ fontSize: 11, marginBottom: 4 }}>Supplier</label>
          <select className="input-base" value={supplierId} onChange={e => setSupplierId(e.target.value)} style={{ width: 180, fontSize: 12, padding: '6px 10px' }}>
            <option value="">All Suppliers</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
          </select>
        </div>
        <Button variant="secondary" size="sm" onClick={handleApply} icon={<RefreshCw size={14} />}>Apply</Button>
        <ExportButtons
          onExcel={() => reportService.downloadPurchaseExcel({ date_from: dateFrom, date_to: dateTo, supplier_id: supplierId || undefined })}
          loading={loading}
        />
      </ReportFilters>

      {loading ? <Loader /> : error ? (
        <div className="card" style={{ padding: '20px 24px', background: '#fef2f2', border: '1px solid #fecaca' }}>
          <p style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 6 }}>Failed to load purchase report</p>
          <p style={{ fontSize: 12, color: '#991b1b' }}>{error}</p>
        </div>
      ) : !data ? <p style={{ color: 'var(--text-muted)' }}>No data available</p> : (
        <>
          <KpiRow kpis={[
            { label: 'Total Spend', value: formatCurrencyShort(data.total_spend_lkr), color: '#f97316' },
            { label: 'PO Count', value: formatNumber(data.total_po_count), color: '#3b82f6' },
            { label: 'Items Purchased', value: formatNumber(data.total_items_purchased), color: '#22c55e' },
          ]} />

          {/* Purchasing Trend Over Time */}
          <ChartCard title="Purchasing Trend Over Time" subtitle="Weekly spend over time" height={260} style={{ marginBottom: 16 }}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => formatCurrencyShort(v).replace('Rs. ', '')} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={50} />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="line" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Area type="monotone" dataKey="spend" name="Current Period" stroke="#f97316" strokeWidth={2.5} fill="url(#spendGrad)" dot={false} />
            </AreaChart>
          </ChartCard>

          <div className="analytics-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Spend by Category — Donut */}
            <ChartCard title="Spend by Category" subtitle="Where purchasing budget is going" height={240}>
              <div className="analytics-donut-layout" style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%' }}>
                <PieChart width={160} height={200}>
                  <Pie data={categoryDonutData.slice(0, 7)} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={3} strokeWidth={0}>
                    {categoryDonutData.slice(0, 7).map((_, i) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
                <div style={{ flex: 1 }}>
                  {categoryDonutData.slice(0, 7).map((c, i) => (
                    <div key={c.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f3f4f6', fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 99, background: CATEGORY_COLORS[i % CATEGORY_COLORS.length], flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-secondary)' }}>{c.name}</span>
                      </div>
                      <span style={{ fontWeight: 700, fontFamily: 'Outfit, sans-serif', fontSize: 11 }}>{formatCurrencyShort(c.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </ChartCard>

            {/* Spend by Supplier — Bar Chart */}
            <ChartCard title="Spend by Supplier" subtitle="Where money goes by supplier" height={240}>
              <BarChart data={supplierBarData.slice(0, 10)} layout="vertical" margin={{ left: 90, right: 10, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                <XAxis type="number" tickFormatter={v => formatCurrencyShort(v).replace('Rs. ', '')} tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={90} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="spend" name="Spend (LKR)" fill="#f97316" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartCard>
          </div>

          <div className="card analytics-table-card" style={{ padding: '20px 24px' }}>
            <SectionHeader title="Detailed Spending Breakdown" subtitle="By supplier" />
            <DataTable headers={['Supplier', 'PO Count', 'Total (LKR)']}
              rows={(data.spending_by_supplier || []).map(s => [s.supplier_name, s.po_count, formatCurrencyShort(s.total_lkr)])} />
          </div>
        </>
      )}
    </>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// SALES REPORT TAB — Phase 3 charts
// ═════════════════════════════════════════════════════════════════════════
const SalesReportTab = () => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback((params) => {
    setLoading(true)
    setError(null)
    reportService.getSalesReport(params).then(setData).catch(err => {
      console.error(err)
      setError(err.message || 'Failed to load sales report')
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load({}) }, [load])

  const handleApply = () => {
    const params = {}
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    load(params)
  }

  // Revenue trend
  const trendData = (data?.revenue_trend || []).map(t => ({
    period: t.period,
    revenue: t.revenue_lkr,
  }))

  // Top and bottom performers
  const topPerformers = (data?.top_by_revenue || []).slice(0, 10)
  const bottomPerformers = (data?.bottom_by_revenue || []).slice(0, 10)

  // Scatter data for product performance
  const scatterData = (data?.product_performance || []).map(p => ({
    units_sold: p.units_sold,
    revenue_lkr: p.revenue_lkr,
    product_name: p.product_name,
  })).filter(p => p.units_sold > 0 && p.revenue_lkr > 0)

  return (
    <>
      <ReportFilters dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo}>
        <Button variant="secondary" size="sm" onClick={handleApply} icon={<RefreshCw size={14} />}>Apply</Button>
        <ExportButtons onExcel={() => reportService.downloadSalesExcel({ date_from: dateFrom, date_to: dateTo })} loading={loading} />
      </ReportFilters>
      {loading ? <Loader /> : error ? (
        <div className="card" style={{ padding: '20px 24px', background: '#fef2f2', border: '1px solid #fecaca' }}>
          <p style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 6 }}>Failed to load sales report</p>
          <p style={{ fontSize: 12, color: '#991b1b' }}>{error}</p>
        </div>
      ) : !data ? <p style={{ color: 'var(--text-muted)' }}>No data available</p> : (
        <>
          <KpiRow kpis={[
            { label: 'Total Revenue', value: formatCurrencyShort(data.total_revenue_lkr), color: '#22c55e' },
            { label: 'Transactions', value: formatNumber(data.total_transactions), color: '#3b82f6' },
            { label: 'Gross Profit', value: formatCurrencyShort(data.gross_profit_lkr), color: '#f97316' },
            { label: 'Margin', value: `${data.gross_margin_pct}%`, color: '#a855f7' },
          ]} />

          {/* Revenue Trend Over Time */}
          <ChartCard title="Revenue Trend Over Time" subtitle="Weekly revenue — filterable by date range" height={250} style={{ marginBottom: 16 }}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => formatCurrencyShort(v).replace('Rs. ', '')} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={50} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#22c55e" strokeWidth={2.5} fill="url(#salesGrad)" dot={false} />
            </AreaChart>
          </ChartCard>

          {/* Top/Bottom Performers — Side by Side */}
          <div className="analytics-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <ChartCard title="Top 10 by Revenue" subtitle="Best performing products" height={Math.min(topPerformers.length * 35 + 10, 350)}>
              <BarChart data={topPerformers} layout="vertical" margin={{ left: 120, right: 10, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                <XAxis type="number" tickFormatter={v => formatCurrencyShort(v).replace('Rs. ', '')} tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="product_name" tickFormatter={(value) => truncateAxisLabel(value, 18)} tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={110} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="revenue_lkr" name="Revenue (LKR)" fill="#22c55e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="Bottom 10 by Revenue" subtitle="Candidates for 'should I stop purchasing this?'" height={Math.min(bottomPerformers.length * 35 + 10, 350)}>
              <BarChart data={bottomPerformers} layout="vertical" margin={{ left: 120, right: 10, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                <XAxis type="number" tickFormatter={v => formatCurrencyShort(v).replace('Rs. ', '')} tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="product_name" tickFormatter={(value) => truncateAxisLabel(value, 18)} tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={110} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="revenue_lkr" name="Revenue (LKR)" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartCard>
          </div>

          {/* Product Performance: Quantity vs Revenue Scatter */}
          {scatterData.length > 0 && (
            <ChartCard title="Product Performance: Quantity vs Revenue" subtitle="Each dot is a product — x-axis = units sold, y-axis = revenue generated" height={350} style={{ marginBottom: 16 }}>
              <ScatterChart margin={{ left: 20, right: 20, top: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis type="number" dataKey="units_sold" name="Units Sold" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} label={{ value: 'Units Sold', position: 'bottom', fontSize: 11, fill: '#9ca3af' }} />
                <YAxis type="number" dataKey="revenue_lkr" name="Revenue" tickFormatter={v => formatCurrencyShort(v).replace('Rs. ', '')} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={60} label={{ value: 'Revenue', angle: -90, position: 'left', fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip content={<ScatterTooltip />} />
                <ReferenceLine y={0} stroke="#f3f4f6" />
                <ReferenceLine x={0} stroke="#f3f4f6" />
                <Scatter data={scatterData} fill="#f97316" opacity={0.7} />
              </ScatterChart>
            </ChartCard>
          )}

          <div className="card analytics-table-card" style={{ padding: '20px 24px' }}>
            <SectionHeader title="Top Sellers by Revenue" subtitle="Full list" />
            <DataTable headers={['#', 'Product', 'Qty Sold', 'Revenue (LKR)']}
              rows={(data.top_by_revenue || []).slice(0, 10).map((p, i) => [i + 1, p.product_name, formatNumber(p.qty_sold), formatCurrencyShort(p.revenue_lkr)])} />
          </div>
        </>
      )}
    </>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// MAIN ANALYTICS COMPONENT
// ═════════════════════════════════════════════════════════════════════════
const Analytics = () => {
  const [activeTab, setActiveTab] = useState('sales')

  return (
    <div className="page-wrapper analytics-page" style={{ paddingBottom: 40 }}>
      <div className="analytics-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Business performance & inventory insights</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="analytics-tabs" style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid var(--card-border)' }}>
        {TABS.map(tab => (
          <button key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 700 : 500,
              padding: '10px 20px',
              border: 'none',
              background: 'transparent',
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'all var(--transition)',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'inventory' && <InventoryReportTab />}
      {activeTab === 'suppliers' && <SupplierReportTab />}
      {activeTab === 'purchases' && <PurchaseReportTab />}
      {activeTab === 'sales' && <SalesReportTab />}

      <style>{`
        .analytics-tabs {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .analytics-tabs button {
          flex: 0 0 auto;
        }

        @media (max-width: 1024px) {
          .analytics-header,
          .analytics-filter-row,
          .analytics-donut-layout {
            flex-direction: column !important;
            align-items: stretch !important;
          }

          .analytics-two-col {
            grid-template-columns: 1fr !important;
          }

          .analytics-filter-row > div,
          .analytics-filter-row .date-range-filter,
          .analytics-filter-row button,
          .analytics-filter-row .input-base {
            width: 100% !important;
            min-width: 0 !important;
          }

          .analytics-kpi-row {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }

        @media (max-width: 768px) {
          .analytics-page {
            padding-left: 14px;
            padding-right: 14px;
          }

          .analytics-kpi-row {
            grid-template-columns: 1fr !important;
          }

          .analytics-page .card {
            padding-left: 16px !important;
            padding-right: 16px !important;
          }

          .analytics-tabs button {
            padding: 10px 14px !important;
          }
        }

        @media (min-width: 1440px) {
          .analytics-page {
            max-width: 1680px;
          }
        }

        @media (min-width: 1920px) {
          .analytics-page {
            max-width: 2200px;
          }
        }
      `}</style>
    </div>
  )
}

export default Analytics