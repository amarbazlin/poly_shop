import { supabase } from './supabase'

// Business header details used on every printed document
// (invoice / quotation / delivery note PDFs and POS bills).
// Cached for 5 minutes so printing stays instant.
let businessInfoCache = null
let businessInfoCacheExpiry = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export const getBusinessInfo = async (businessId) => {
  if (businessInfoCache && Date.now() < businessInfoCacheExpiry) {
    return businessInfoCache
  }

  try {
    const { data } = await supabase
      .from('businesses')
      .select('name, address, phone, email, reg_no')
      .eq('id', businessId)
      .single()

    if (data) {
      businessInfoCache = {
        name: data.name || 'Polyshop.lk',
        address: data.address || 'No. 167/B1, Old Tangalle, Kotuwegoda, Matara',
        phone: data.phone || '041 222 3298 / 076 055 6075',
        email: data.email || 'polyshop.lk@gmail.com',
        regNo: data.reg_no || '',
      }
      businessInfoCacheExpiry = Date.now() + CACHE_TTL_MS
      return businessInfoCache
    }
  } catch (err) {
    console.error('Failed to fetch business info:', err)
  }

  // Fallback to env vars
  return {
    name:    import.meta.env.VITE_BUSINESS_NAME    || 'Polyshop.lk',
    address: import.meta.env.VITE_BUSINESS_ADDRESS || 'No. 167/B1, Old Tangalle, Kotuwegoda, Matara',
    phone:   import.meta.env.VITE_BUSINESS_PHONE   || '041 222 3298 / 076 055 6075',
    email:   import.meta.env.VITE_BUSINESS_EMAIL   || 'ceylonglobal.hq@gmail.com',
    regNo:   import.meta.env.VITE_BUSINESS_REG     || '',
  }
}
