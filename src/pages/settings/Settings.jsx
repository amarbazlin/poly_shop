import React, { useState, useEffect } from 'react'
import {
  User, Bell, Shield, Building2, Eye, EyeOff,
  Save, CheckCircle, Users, MapPin
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useRBAC } from '../../context/RBACContext'
import { supabase } from '../../services/supabase'
import { ROLES, ROLE_LABELS, ROLE_COLORS } from '../../utils/permissions'
import Button from '../../components/shared/Button'
import UserManagement from './UserManagement'
import BranchManagement from './BranchManagement'

// ── Role badge (small, inline) ────────────────────────────────────────────────
const RoleBadge = ({ role }) => {
  const cfg = ROLE_COLORS[role] || { bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 99,
      fontSize: 11.5, fontWeight: 700,
      fontFamily: 'Outfit, sans-serif',
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.border}`,
    }}>
      {ROLE_LABELS[role] || role}
    </span>
  )
}

// ── Section card wrapper ──────────────────────────────────────────────────────
const SectionCard = ({ title, subtitle, icon: Icon, children }) => (
  <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
    <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={15} color="#f97316" />
      </div>
      <div>
        <h3 style={{ fontFamily: 'Outfit, sans-serif', fontSize: 14, fontWeight: 700, margin: 0 }}>{title}</h3>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>{subtitle}</p>}
      </div>
    </div>
    <div style={{ padding: '18px 22px' }}>{children}</div>
  </div>
)

// ── Toggle switch ─────────────────────────────────────────────────────────────
const Toggle = ({ value, onChange, label, description }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
    <div>
      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
      {description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>}
    </div>
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 42, height: 23, borderRadius: 99,
        background: value ? '#f97316' : '#e5e7eb',
        border: 'none', cursor: 'pointer',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 2,
        left: value ? 21 : 2,
        width: 19, height: 19, borderRadius: 99,
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 0.2s',
      }} />
    </button>
  </div>
)

// ── Main Settings page ────────────────────────────────────────────────────────
const Settings = () => {
  const { user, profile, signOut, businessId } = useAuth()
  const { role, hasRole, can }     = useRBAC()

  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [activeTab, setActiveTab] = useState('profile')
  const [businessName, setBusinessName] = useState('')

  const [profileForm, setProfileForm] = useState({
    full_name: profile?.full_name || '',
    email:     user?.email || '',
  })


  const [notif, setNotif] = useState({
    lowStockAlerts: true, outOfStockAlerts: true,
    dailySummary: false, aiInsights: true, supplierAlerts: true,
  })
  const [loadingPrefs, setLoadingPrefs] = useState(false)

  const [biz, setBiz] = useState({
    businessName: '', currency: 'LKR',
    timezone: 'Asia/Colombo', lowStockThreshold: 10,
    autoGenerateAlerts: true,
  })

  // Fetch business name from the businesses table
  useEffect(() => {
    if (businessId) {
      supabase
        .from('businesses')
        .select('name')
        .eq('id', businessId)
        .single()
        .then(({ data }) => {
          if (data?.name) {
            setBusinessName(data.name)
            setBiz(b => ({ ...b, businessName: data.name }))
          }
        })
        .catch(err => console.error('Failed to fetch business name:', err))
    }
  }, [businessId])

  // Load notification preferences from DB
  useEffect(() => {
    if (!user?.id || !businessId) return
    setLoadingPrefs(true)
    supabase
      .from('user_preferences')
      .select('low_stock_alerts, out_of_stock_alerts, ai_insights, supplier_alerts, daily_summary')
      .eq('user_id', user.id)
      .eq('business_id', businessId)
      .single()
      .then(({ data }) => {
        if (data) {
          setNotif({
            lowStockAlerts: data.low_stock_alerts ?? true,
            outOfStockAlerts: data.out_of_stock_alerts ?? true,
            aiInsights: data.ai_insights ?? true,
            supplierAlerts: data.supplier_alerts ?? true,
            dailySummary: data.daily_summary ?? false,
          })
        }
      })
      .catch(err => console.error('Failed to load notification preferences:', err))
      .finally(() => setLoadingPrefs(false))
  }, [user?.id, businessId])

  useEffect(() => {
    setProfileForm({ full_name: profile?.full_name || '', email: user?.email || '' })
  }, [profile, user])

  const showSaved = () => { setSaved(true); setTimeout(() => setSaved(false), 3000) }

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      await supabase.from('users').update({ full_name: profileForm.full_name }).eq('id', user?.id)
      showSaved()
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }

  const handleSaveNotifications = async () => {
    setSaving(true)
    try {
      if (loadingPrefs) return
      await supabase.from('user_preferences').upsert({
        user_id: user.id,
        business_id: businessId,
        low_stock_alerts: notif.lowStockAlerts,
        out_of_stock_alerts: notif.outOfStockAlerts,
        ai_insights: notif.aiInsights,
        supplier_alerts: notif.supplierAlerts,
        daily_summary: notif.dailySummary,
      })
      showSaved()
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }

  const handleSaveBusiness = async () => {
    setSaving(true)
    try {
      await supabase.from('businesses').update({
        currency: biz.currency,
        timezone: biz.timezone,
        low_stock_threshold: biz.lowStockThreshold,
        auto_generate_alerts: biz.autoGenerateAlerts,
      }).eq('id', businessId)
      showSaved()
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }


  // Build tab list based on role
  const TABS = [
    { key: 'profile',      label: 'Profile',       icon: User      },
    { key: 'notifications',label: 'Notifications', icon: Bell      },
    // Business settings — GM and above
    ...(hasRole(ROLES.SUPER_ADMIN, ROLES.GENERAL_MANAGER, ROLES.BRANCH_MANAGER)
      ? [{ key: 'business', label: 'Business', icon: Building2 }]
      : []
    ),
    { key: 'security',     label: 'Security',      icon: Shield    },
    // User Management — super_admin and general_manager only
    ...(hasRole(ROLES.SUPER_ADMIN, ROLES.GENERAL_MANAGER)
      ? [{ key: 'users', label: 'Team Members', icon: Users }]
      : []
    ),
    // Branches — super_admin and general_manager only
    ...(hasRole(ROLES.SUPER_ADMIN, ROLES.GENERAL_MANAGER)
      ? [{ key: 'branches', label: 'Branches', icon: MapPin }]
      : []
    ),
  ]

  return (
    <div className="page-wrapper" style={{ maxWidth: 860, paddingBottom: 40 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage your account and preferences</p>
      </div>

      {/* Saved banner */}
      {saved && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--success-bg)', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: 'var(--success)', animation: 'fadeIn 0.2s ease' }}>
          <CheckCircle size={15} /> Changes saved successfully
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 24, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: 4, flexWrap: 'wrap' }}>
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1, minWidth: 80, padding: '8px 12px',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: activeTab === tab.key ? '#fff7ed' : 'transparent',
                color: activeTab === tab.key ? '#f97316' : 'var(--text-muted)',
                fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 600,
                transition: 'all 0.15s',
              }}
            >
              <Icon size={13} />
              <span className="hide-mobile">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Profile tab ── */}
      {activeTab === 'profile' && (
        <SectionCard title="Personal Information" subtitle="Your account details" icon={User}>
          {/* Current role display */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--content-bg)', borderRadius: 9, marginBottom: 18 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Your role:</span>
            <RoleBadge role={role} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
            <div className="form-group">
              <label>Full Name</label>
              <input className="input-base" value={profileForm.full_name} onChange={e => setProfileForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input className="input-base" value={profileForm.email} disabled style={{ opacity: 0.55 }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Contact admin to change email</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button icon={<Save />} loading={saving} onClick={handleSaveProfile}>Save Changes</Button>
          </div>
        </SectionCard>
      )}

      {/* ── Notifications tab ── */}
      {activeTab === 'notifications' && (
        <SectionCard title="Notification Preferences" subtitle="Choose which alerts you receive" icon={Bell}>
          <Toggle value={notif.lowStockAlerts}   onChange={v => setNotif(s=>({...s,lowStockAlerts:v}))}   label="Low Stock Alerts"    description="When products fall below reorder level" />
          <Toggle value={notif.outOfStockAlerts} onChange={v => setNotif(s=>({...s,outOfStockAlerts:v}))} label="Out of Stock Alerts"  description="Immediate alert when stock hits zero" />
          <Toggle value={notif.aiInsights}       onChange={v => setNotif(s=>({...s,aiInsights:v}))}       label="AI Insights"          description="AI-generated inventory recommendations" />
          <Toggle value={notif.supplierAlerts}   onChange={v => setNotif(s=>({...s,supplierAlerts:v}))}   label="Supplier Alerts"      description="Delivery delays and supplier issues" />
          <Toggle value={notif.dailySummary}     onChange={v => setNotif(s=>({...s,dailySummary:v}))}     label="Daily Summary"        description="End-of-day business summary" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button icon={<Save />} loading={saving} onClick={handleSaveNotifications}>Save Preferences</Button>
          </div>
        </SectionCard>
      )}

      {/* ── Business tab — GM and above only ── */}
      {activeTab === 'business' && hasRole(ROLES.SUPER_ADMIN, ROLES.GENERAL_MANAGER, ROLES.BRANCH_MANAGER) && (
        <SectionCard title="Business Configuration" subtitle="Store and inventory settings" icon={Building2}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
            <div className="form-group">
              <label>Business Name</label>
              <input className="input-base" value={biz.businessName} disabled style={{ opacity: 0.7, background: '#f9fafb', cursor: 'not-allowed' }} />
            </div>
            <div className="form-group">
              <label>Currency</label>
              <select className="input-base" value={biz.currency} onChange={e => setBiz(b=>({...b,currency:e.target.value}))}>
                <option value="LKR">LKR — Sri Lankan Rupee</option>
                <option value="USD">USD — US Dollar</option>
              </select>
            </div>
            <div className="form-group">
              <label>Timezone</label>
              <select className="input-base" value={biz.timezone} onChange={e => setBiz(b=>({...b,timezone:e.target.value}))}>
                <option value="Asia/Colombo">Asia/Colombo (IST +5:30)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div className="form-group">
              <label>Default Low Stock Threshold</label>
              <input className="input-base" type="number" min="1" value={biz.lowStockThreshold} onChange={e => setBiz(b=>({...b,lowStockThreshold:parseInt(e.target.value)||10}))} />
            </div>
          </div>
          <Toggle value={biz.autoGenerateAlerts} onChange={v => setBiz(b=>({...b,autoGenerateAlerts:v}))} label="Auto-Generate Low Stock Alerts" description="Automatically create alerts when stock falls below reorder level" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button icon={<Save />} loading={saving} onClick={handleSaveBusiness}>Save Settings</Button>
          </div>
        </SectionCard>
      )}

      {/* ── Security tab ── */}
      {activeTab === 'security' && (
        <>
          <SectionCard title="Password" subtitle="Your login password status" icon={Shield}>
            <div style={{ maxWidth: 400 }}>
              <div className="form-group">
                <label>Current Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input-base"
                    type={showPass ? 'text' : 'password'}
                    value="••••••••"
                    disabled
                    style={{ paddingRight: 44, opacity: 0.7, background: '#f9fafb' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}
                  >
                    {showPass ? <EyeOff size={15} color="var(--text-muted)" /> : <Eye size={15} color="var(--text-muted)" />}
                  </button>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  Password cannot be changed here. Contact admin for password changes.
                </span>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Danger Zone" subtitle="Irreversible account actions" icon={Shield}>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#dc2626', marginBottom: 3 }}>Sign Out</div>
                <div style={{ fontSize: 12.5, color: '#9ca3af' }}>Sign out from all devices</div>
              </div>
              <Button variant="danger" onClick={signOut}>Sign Out</Button>
            </div>
          </SectionCard>
        </>
      )}

      {/* ── Team Members tab — super_admin + GM only ── */}
      {activeTab === 'users' && hasRole(ROLES.SUPER_ADMIN, ROLES.GENERAL_MANAGER) && (
        <SectionCard title="Team Members" subtitle="Manage users and their roles" icon={Users}>
          <UserManagement />
        </SectionCard>
      )}

      {/* ── Branches tab — super_admin + GM only ── */}
      {activeTab === 'branches' && hasRole(ROLES.SUPER_ADMIN, ROLES.GENERAL_MANAGER) && (
          <SectionCard title="Branches" subtitle="Manage store locations and branches" icon={MapPin}>
          <BranchManagement businessId={businessId} />
        </SectionCard>
      )}

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: 'var(--text-muted)' }}>
        {businessName} · Powered by <span style={{ color: '#f97316', fontWeight: 600 }}>Forgera</span>
      </div>
    </div>
  )
}

export default Settings