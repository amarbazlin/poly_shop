import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Edit2, MapPin, Building2, AlertCircle } from 'lucide-react'
import { supabase } from '../../services/supabase'
import Modal from '../../components/shared/Modal'
import Button from '../../components/shared/Button'
import Loader from '../../components/shared/Loader'
import { formatDate } from '../../utils/formatters'

const StatusBadge = ({ status }) => {
  const active = status === 'active'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 9px', borderRadius: 99,
      fontSize: 11, fontWeight: 700,
      fontFamily: 'Outfit, sans-serif',
      background: active ? '#f0fdf4' : '#f3f4f6',
      color: active ? '#16a34a' : '#6b7280',
      border: `1px solid ${active ? '#bbf7d0' : '#e5e7eb'}`,
      textTransform: 'capitalize',
    }}>
      {status || 'unknown'}
    </span>
  )
}

const BranchFormModal = ({ open, onClose, initial, onSaved, saving, setSaving }) => {
  const isEdit = Boolean(initial?.id)
  const [form, setForm] = useState({ name: '', address: '', phone: '' })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    setForm({
      name: initial?.name || '',
      address: initial?.address || '',
      phone: initial?.phone || '',
    })
  }, [initial, open])

  const handleSave = async () => {
    if (!form.name.trim()) return alert('Branch name is required')
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        status: 'active',
      }
      if (isEdit) {
        const { error } = await supabase
          .from('locations')
          .update(payload)
          .eq('id', initial.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('locations')
          .insert([payload])
        if (error) throw error
      }
      onSaved()
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit Branch — ${initial?.name}` : 'Add Branch'}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>
            {isEdit ? 'Save Changes' : 'Add Branch'}
          </Button>
        </>
      }
    >
      <div className="form-group">
        <label>Branch Name *</label>
        <input className="input-base" value={form.name} onChange={set('name')} placeholder="e.g. Matara Main Store" />
      </div>
      <div className="form-group">
        <label>Address</label>
        <input className="input-base" value={form.address} onChange={set('address')} placeholder="Street, city" />
      </div>
      <div className="form-group">
        <label>Phone</label>
        <input className="input-base" value={form.phone} onChange={set('phone')} placeholder="0412-XXXXXX" />
      </div>
    </Modal>
  )
}

const DeactivateConfirmModal = ({ open, onClose, branch, onConfirm, saving }) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Deactivate Branch?"
    width={440}
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={saving} onClick={onConfirm}>Deactivate</Button>
      </>
    }
  >
    <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 12px' }}>
      Are you sure you want to deactivate <strong>{branch?.name}</strong>?
    </p>
    <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
      Historical data tied to this branch will be preserved. It will no longer appear in dropdowns for new transactions.
    </p>
  </Modal>
)

const BranchManagement = ({ businessId }) => {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)

  const loadLocations = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('locations')
        .select('id, name, address, phone, is_default, status, created_at, location_stock(product_id)')
        .order('name')

      if (businessId) {
        query = query.eq('business_id', businessId)
      }

      const { data, error } = await query

      if (error) throw error

      const payload = (data || []).map(row => {
        const productCount = new Set(
          (row.location_stock || []).map(ls => ls.product_id).filter(Boolean)
        ).size
        return {
          id: row.id,
          name: row.name,
          address: row.address,
          phone: row.phone,
          is_default: row.is_default,
          status: row.status,
          created_at: row.created_at,
          product_count: productCount,
        }
      })

      setLocations(payload)
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadLocations() }, [loadLocations])

  const activeCount = locations.filter(l => l.status === 'active').length
  const showSingleBranchBanner = activeCount === 1

  const handleDeactivate = async () => {
    if (!deactivateTarget) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('locations')
        .update({ status: 'inactive' })
        .eq('id', deactivateTarget.id)

      if (error) throw error
      setDeactivateTarget(null)
      await loadLocations()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Loader size={32} />
      </div>
    )
  }

  return (
    <div>
      {showSingleBranchBanner && (
        <div style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          background: '#fff7ed', border: '1px solid #fed7aa',
          borderRadius: 10, padding: '14px 16px', marginBottom: 18,
        }}>
          <Building2 size={18} color="#f97316" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#c2410c', marginBottom: 4 }}>
              Single-branch setup
            </div>
            <div style={{ fontSize: 13, color: '#9a3412', lineHeight: 1.5 }}>
              You're currently running a single-branch setup. Add a branch here when you're ready to expand.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {locations.length} branch{locations.length !== 1 ? 'es' : ''} · {activeCount} active
        </div>
        <Button icon={<Plus size={15} />} onClick={() => { setEditTarget(null); setFormOpen(true) }}>
          Add Branch
        </Button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--content-bg)', borderBottom: '1px solid var(--card-border)' }}>
              {['Name', 'Address', 'Status', 'Products', 'Created', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <AlertCircle size={20} style={{ marginBottom: 8, opacity: 0.5 }} />
                  <div>No branches yet. Add your first branch to get started.</div>
                </td>
              </tr>
            ) : locations.map(loc => (
              <tr key={loc.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MapPin size={13} color="#f97316" />
                    <span style={{ fontWeight: 600 }}>{loc.name}</span>
                  </div>
                  {loc.phone && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, paddingLeft: 21 }}>
                      {loc.phone}
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', maxWidth: 200 }}>
                  {loc.address || '—'}
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <StatusBadge status={loc.status} />
                </td>
                <td style={{ padding: '12px 14px', fontFamily: 'Outfit, sans-serif', fontWeight: 600 }}>
                  {loc.product_count ?? 0}
                </td>
                <td style={{ padding: '12px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {loc.created_at ? formatDate(loc.created_at) : '—'}
                </td>
                <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => { setEditTarget(loc); setFormOpen(true) }}
                      title="Edit branch"
                      style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid var(--card-border)', background: 'var(--card-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Edit2 size={13} color="var(--text-muted)" />
                    </button>
                    {loc.status === 'active' && (
                      <button
                        onClick={() => setDeactivateTarget(loc)}
                        title="Deactivate branch"
                        style={{
                          padding: '4px 10px', borderRadius: 7,
                          border: '1px solid #fecaca', background: '#fef2f2',
                          color: '#dc2626', fontSize: 11.5, fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                        }}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BranchFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null) }}
        initial={editTarget}
        onSaved={loadLocations}
        saving={saving}
        setSaving={setSaving}
      />

      <DeactivateConfirmModal
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        branch={deactivateTarget}
        onConfirm={handleDeactivate}
        saving={saving}
      />
    </div>
  )
}

export default BranchManagement
