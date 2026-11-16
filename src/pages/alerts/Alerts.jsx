import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Clock3, Filter, RefreshCw, Zap } from 'lucide-react'
import { alertsService } from '../../services/alertsService'
import { useRBAC } from '../../context/RBACContext'
import { P } from '../../utils/permissions'
import { todayISO } from '../../services/purchasesService'
import Loader from '../../components/shared/Loader'
import { CreditDueBanner, CreditDuePopup, useSupplierCredit } from '../../components/purchases/CreditDueReminder'

const ALERT_TYPES = [
  { value: '', label: 'All types' },
  { value: 'low_stock', label: 'Low stock' },
  { value: 'out_of_stock', label: 'Stockout' },
  { value: 'dead_stock', label: 'Dead stock' },
  { value: 'late_delivery', label: 'Late delivery' },
  { value: 'supplier_credit_due', label: 'Supplier credit due' },
]

const SEVERITIES = [
  { value: '', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const severityColors = {
  critical: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  high: { bg: '#fff7ed', text: '#f97316', border: '#fed7aa' },
  medium: { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
  low: { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' },
}

const typeLabels = {
  low_stock: 'Low stock',
  out_of_stock: 'Stockout',
  dead_stock: 'Dead stock',
  late_delivery: 'Late delivery',
  supplier_credit_due: 'Supplier credit due',
}

// Shared across Purchases / Alerts / Suppliers: one automatic credit shout per day.
const CREDIT_POPUP_KEY = 'forgera:supplier-credit-popup'

const Alerts = () => {
  const navigate = useNavigate()
  const { can } = useRBAC()
  const canPurchases = can(P.VIEW_PURCHASES)
  const credit = useSupplierCredit({ enabled: canPurchases })
  const [creditOpen, setCreditOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [resolved, setResolved] = useState('false')
  const [type, setType] = useState('')
  const [severity, setSeverity] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState(null)
  const [checkError, setCheckError] = useState('')

  const loadAlerts = async () => {
    setLoading(true)
    try {
      const data = await alertsService.getAll({
        resolved: resolved === '' ? undefined : resolved === 'true',
        type: type || undefined,
        severity: severity || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        limit: 200,
      })
      setAlerts(data || [])
      return data || []
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAlerts() }, [resolved, type, severity, startDate, endDate])

  // Credit engine: remind about supplier payments that are overdue or fall due
  // within the week — popup once per day, banner always available below.
  const creditAlertedRef = useRef(false)
  useEffect(() => {
    if (creditAlertedRef.current || credit.loading || !canPurchases) return
    creditAlertedRef.current = true
    if (credit.summary.overdueCount + credit.summary.dueSoonCount === 0) return
    if (sessionStorage.getItem(CREDIT_POPUP_KEY) === todayISO()) return
    sessionStorage.setItem(CREDIT_POPUP_KEY, todayISO())
    setCreditOpen(true)
  }, [credit.loading, credit.summary.overdueCount, credit.summary.dueSoonCount, canPurchases])

  // If the table is empty on first load, run the alert engine once so the
  // page is never just an empty void — the alerts are generated, not stored.
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (bootstrappedRef.current || loading) return
    bootstrappedRef.current = true
    if (alerts.length === 0 && resolved === 'false') {
      handleRunCheck(true)
    }
  }, [alerts, loading])

  const handleRunCheck = async (silent = false) => {
    setChecking(true)
    setCheckError('')
    if (!silent) setCheckResult(null)
    try {
      const result = await alertsService.runCheck()
      setCheckResult(result)
      await loadAlerts()
    } catch (err) {
      if (!silent) setCheckError(err.message || 'Failed to run the alert check')
    } finally {
      setChecking(false)
    }
  }

  const groupedCounts = useMemo(() => ({
    critical: alerts.filter(a => a.severity === 'critical').length,
    high: alerts.filter(a => a.severity === 'high').length,
    medium: alerts.filter(a => a.severity === 'medium').length,
    low: alerts.filter(a => a.severity === 'low').length,
  }), [alerts])

  const handleResolve = async (id) => {
    setSavingId(id)
    try {
      await alertsService.resolve(id)
      await loadAlerts()
    } finally {
      setSavingId(null)
    }
  }

  const handleResolveAll = async () => {
    setSavingId('all')
    try {
      await alertsService.resolveAll()
      await loadAlerts()
    } finally {
      setSavingId(null)
    }
  }

  const getTarget = (alert) => {
    if (alert.alert_type === 'supplier_credit_due') {
      return '/purchases'
    }
    if (alert.related_purchase_order_id || alert.alert_type === 'late_delivery') {
      return '/finance'
    }
    return alert.product_id || alert.products?.id ? `/inventory/edit/${alert.product_id || alert.products?.id}` : null
  }

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-subtitle">Unified stock and delivery alerts across the system</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="dashboard-refresh" type="button" onClick={() => handleRunCheck(false)} disabled={checking}>
            <Zap size={15} />
            {checking ? 'Checking…' : 'Run check'}
          </button>
          <button className="dashboard-refresh" type="button" onClick={loadAlerts}>
            <RefreshCw size={15} />
            Refresh
          </button>
          <button className="dashboard-refresh" type="button" onClick={handleResolveAll} disabled={savingId === 'all'}>
            <CheckCircle2 size={15} />
            Resolve all
          </button>
        </div>
      </div>

      {canPurchases && (
        <div style={{ marginBottom: 18 }}>
          <CreditDueBanner credit={credit} onOpen={() => setCreditOpen(true)} />
        </div>
      )}

      {(checkError || checkResult) && (
        <div
          style={{
            marginBottom: 18,
            padding: '12px 16px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: checkError ? '#fef2f2' : '#f0fdf4',
            color: checkError ? '#dc2626' : '#16a34a',
            border: `1px solid ${checkError ? '#fecaca' : '#bbf7d0'}`,
          }}
        >
          {checkError ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {checkError || (() => {
            const created = checkResult?.created
            const resolved = checkResult?.resolved
            const open = checkResult?.current_open_alerts
            const parts = []
            if (created !== undefined) parts.push(`${created} new`)
            if (resolved !== undefined) parts.push(`${resolved} auto-resolved`)
            if (open !== undefined) parts.push(`${open} open alerts`)
            return parts.length ? `Alert check complete: ${parts.join(', ')}.` : 'Alert check complete.'
          })()}
        </div>
      )}

      <div className="dashboard-stat-grid" style={{ marginBottom: 18 }}>
        <div className="dashboard-stat dashboard-stat-red"><div className="dashboard-stat-icon"><AlertTriangle size={18} /></div><div><p>Critical</p><strong>{groupedCounts.critical}</strong></div></div>
        <div className="dashboard-stat dashboard-stat-orange"><div className="dashboard-stat-icon"><AlertTriangle size={18} /></div><div><p>High</p><strong>{groupedCounts.high}</strong></div></div>
        <div className="dashboard-stat dashboard-stat-yellow"><div className="dashboard-stat-icon"><Clock3 size={18} /></div><div><p>Medium</p><strong>{groupedCounts.medium}</strong></div></div>
        <div className="dashboard-stat dashboard-stat-green"><div className="dashboard-stat-icon"><CheckCircle2 size={18} /></div><div><p>Low</p><strong>{groupedCounts.low}</strong></div></div>
      </div>

      <section className="card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Filter size={15} />
          <strong style={{ fontSize: 13 }}>Filters</strong>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label>
            <div className="form-label">Status</div>
            <select className="input-base" value={resolved} onChange={e => setResolved(e.target.value)}>
              <option value="false">Unresolved</option>
              <option value="true">Resolved</option>
              <option value="">All</option>
            </select>
          </label>
          <label>
            <div className="form-label">Type</div>
            <select className="input-base" value={type} onChange={e => setType(e.target.value)}>
              {ALERT_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <div className="form-label">Severity</div>
            <select className="input-base" value={severity} onChange={e => setSeverity(e.target.value)}>
              {SEVERITIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <div className="form-label">From</div>
            <input className="input-base" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </label>
          <label>
            <div className="form-label">To</div>
            <input className="input-base" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="card" style={{ padding: 20 }}>
        {loading ? (
          <Loader />
        ) : alerts.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)' }}>No alerts match the current filters.</div>
        ) : (
          <div className="table-scroll-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Type</th>
                  <th>Message</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {alerts.map(alert => {
                  const colors = severityColors[alert.severity] || severityColors.medium
                  const target = getTarget(alert)
                  return (
                    <tr key={alert.id}>
                      <td>
                        <span style={{
                          display: 'inline-flex',
                          padding: '4px 10px',
                          borderRadius: 999,
                          background: colors.bg,
                          color: colors.text,
                          border: `1px solid ${colors.border}`,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>{alert.severity}</span>
                      </td>
                      <td>{typeLabels[alert.alert_type] || alert.alert_type}</td>
                      <td>{alert.message}</td>
                      <td>{alert.created_at ? new Date(alert.created_at).toLocaleString() : '—'}</td>
                      <td>{alert.resolved ? 'Resolved' : 'Open'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {target && (
                            <button className="btn-secondary" type="button" onClick={() => navigate(target)}>
                              Open source
                            </button>
                          )}
                          {!alert.resolved && (
                            <button className="btn-primary" type="button" onClick={() => handleResolve(alert.id)} disabled={savingId === alert.id}>
                              Resolve
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canPurchases && (
        <CreditDuePopup
          open={creditOpen}
          onClose={() => setCreditOpen(false)}
          credit={credit}
          onChanged={() => loadAlerts()}
        />
      )}
    </div>
  )
}

export default Alerts
