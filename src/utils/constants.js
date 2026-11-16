// Multi-business deployment: default fallback business ID for new users
// whose profile has no business_id linked yet. Change this when onboarding
// a new business (currently id 3 for Polyshop).
export const DEFAULT_BUSINESS_ID = 3

// App info
export const APP_NAME = 'HardwareAI'
export const APP_VERSION = '2.0.0'

// Stock status thresholds
export const STOCK_STATUS = {
  OUT_OF_STOCK: 'out_of_stock',
  CRITICAL:     'critical',
  LOW:          'low',
  NORMAL:       'normal',
  OVERSTOCKED:  'overstocked',
}

export const getStockStatus = (quantity, reorderLevel) => {
  if (quantity === 0)                           return STOCK_STATUS.OUT_OF_STOCK
  if (quantity <= reorderLevel * 0.5)           return STOCK_STATUS.CRITICAL
  if (quantity <= reorderLevel)                 return STOCK_STATUS.LOW
  if (quantity >= reorderLevel * 5)             return STOCK_STATUS.OVERSTOCKED
  return STOCK_STATUS.NORMAL
}

// Payment methods (cheque removed per shop request)
export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'credit']

// Transaction types
export const TRANSACTION_TYPES = {
  SALE:       'sale',
  PURCHASE:   'purchase',
  ADJUSTMENT: 'adjustment',
  RETURN:     'return',
  DAMAGE:     'damage',
}

// Alert severity
export const ALERT_SEVERITY = {
  LOW:      'low',
  MEDIUM:   'medium',
  HIGH:     'high',
  CRITICAL: 'critical',
}

// Alert types
export const ALERT_TYPES = {
  LOW_STOCK:    'low_stock',
  OUT_OF_STOCK: 'out_of_stock',
  PRICE_ANOMALY:'price_anomaly',
  DEAD_STOCK:   'dead_stock',
  REORDER:      'reorder',
}

// Roles
export const USER_ROLES = {
  ADMIN:   'admin',
  MANAGER: 'manager',
  STAFF:   'staff',
}

// Customer types
export const CUSTOMER_TYPES = {
  RETAIL:      'retail',
  CONTRACTOR:  'contractor',
  WHOLESALE:   'wholesale',
  VIP:         'vip',
}

export const CUSTOMER_TYPE_COLORS = {
  retail:     '#3b82f6',
  contractor: '#f97316',
  wholesale:  '#8b5cf6',
  vip:        '#22c55e',
}

// Units for products
export const PRODUCT_UNITS = [
  'pcs', 'kg', 'g', 'litre', 'ml', 'box', 'bag', 'roll',
  'bundle', 'pair', 'set', 'sheet', 'meter', 'feet', 'ton',
]

// Date range options
export const DATE_RANGES = [
  { label: '7D',  value: 7   },
  { label: '1M',  value: 30  },
  { label: '3M',  value: 90  },
  { label: '6M',  value: 180 },
  { label: '1Y',  value: 365 },
]

// Sidebar nav items — centralised so both Sidebar and Routes use same structure
export const NAV_ITEMS = [
  { path: '/',             label: 'Dashboard',   icon: 'LayoutDashboard', exact: true },
  { path: '/inventory',    label: 'Inventory',   icon: 'Package'   },
  { path: '/customers',    label: 'Customers',   icon: 'Users2'    },
  { path: '/sales',        label: 'Sales',       icon: 'ShoppingCart' },
  { path: '/suppliers',    label: 'Suppliers',   icon: 'Building2' },
  { path: '/analytics',    label: 'Analytics',   icon: 'BarChart3' },
  { path: '/settings', label: 'Settings', icon: 'Settings' },
]
