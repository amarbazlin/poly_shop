import React, { useState, useEffect } from 'react'
import { MapPin } from 'lucide-react'
import { locationService } from '../../services/locationService'
import { useAuth } from '../../context/AuthContext'
import Loader from '../shared/Loader'

/**
 * Reusable branch/location selector.
 * - Single location: shows disabled field, auto-selects
 * - Multiple locations: dropdown, defaults to user's home location or first alphabetically
 */
const LocationSelect = ({
  value,
  onChange,
  label = 'Branch / Location',
  required = false,
  disabled = false,
}) => {
  const { profile } = useAuth()
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    locationService.getActive()
      .then(data => {
        if (cancelled) return
        const list = data || []
        setLocations(list)

        if (list.length === 1) {
          const onlyId = String(list[0].id)
          if (value !== onlyId && value !== list[0].id) {
            onChange?.(list[0].id)
          }
          return
        }

        if (list.length > 1 && (value === null || value === undefined || value === '')) {
          const homeId = profile?.location_id
          const homeMatch = homeId != null
            ? list.find(l => l.id === homeId || String(l.id) === String(homeId))
            : null
          const defaultLoc = homeMatch || list[0]
          onChange?.(defaultLoc.id)
        }
      })
      .catch(err => {
        if (!cancelled) setError(err.message || 'Failed to load branches')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.location_id])

  if (loading) {
    return (
      <div className="form-group">
        {label && <label>{label}{required && ' *'}</label>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
          <Loader size={18} />
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading branches…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="form-group">
        {label && <label>{label}{required && ' *'}</label>}
        <div style={{ fontSize: 12.5, color: 'var(--danger)', padding: '8px 0' }}>{error}</div>
      </div>
    )
  }

  if (locations.length === 0) {
    return (
      <div className="form-group">
        {label && <label>{label}{required && ' *'}</label>}
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 0' }}>
          No active branches configured.
        </div>
      </div>
    )
  }

  const selected = locations.find(l => String(l.id) === String(value))

  // Single branch — no interactive dropdown
  if (locations.length === 1) {
    const loc = locations[0]
    return (
      <div className="form-group">
        {label && <label>{label}{required && ' *'}</label>}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 12px',
          border: '1.5px solid var(--card-border)',
          borderRadius: 9,
          background: 'var(--content-bg)',
          opacity: 0.85,
        }}>
          <MapPin size={14} color="var(--text-muted)" />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
            {loc.name}
          </span>
        </div>
        {loc.address && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
            {loc.address}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="form-group">
      {label && <label>{label}{required && ' *'}</label>}
      <select
        className="input-base"
        value={value ?? ''}
        onChange={e => onChange?.(e.target.value ? parseInt(e.target.value, 10) : null)}
        required={required}
        disabled={disabled}
      >
        <option value="">Select branch</option>
        {locations.map(loc => (
          <option key={loc.id} value={loc.id}>{loc.name}</option>
        ))}
      </select>
      {selected?.address && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
          {selected.address}
        </span>
      )}
    </div>
  )
}

export default LocationSelect
