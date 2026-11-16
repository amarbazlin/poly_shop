import { createUserClient } from '../lib/supabase.js'

const MANAGER_ROLES = new Set(['super_admin', 'general_manager'])

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const supabase = createUserClient(token)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired session' })
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, role, full_name, email, business_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return res.status(403).json({ error: 'User profile not found' })
    }

    req.accessToken = token
    req.user = user
    req.profile = profile
    req.businessId = profile.business_id
    req.supabase = supabase
    next()
  } catch (err) {
    console.error('Auth middleware error:', err)
    return res.status(500).json({ error: 'Authentication failed' })
  }
}

export function requireManagerRole(req, res, next) {
  if (!MANAGER_ROLES.has(req.profile?.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }
  next()
}