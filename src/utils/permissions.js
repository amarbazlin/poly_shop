// =============================================
// HardwareAI — Role-Based Access Control
// 6-tier role hierarchy (simplified)
// =============================================

// ── All permission keys ────────────────────────────────────────────────────────
export const P = {
  // Dashboard
  VIEW_DASHBOARD:      'view:dashboard',

  // Analytics & reporting
  VIEW_ANALYTICS:      'view:analytics',
  VIEW_PROFITS:        'view:profits',
  VIEW_MARGINS:        'view:margins',
  EXPORT_REPORTS:      'export:reports',

  // Inventory
  VIEW_INVENTORY:      'view:inventory',
  MANAGE_INVENTORY:    'manage:inventory',
  MANAGE_STOCK:        'manage:stock',
  DELETE_PRODUCTS:     'delete:products',

  // Sales
  VIEW_SALES:          'view:sales',
  CREATE_SALES:        'create:sales',
  MANAGE_SALES:        'manage:sales',
  CREATE_QUOTATIONS:   'create:quotations',

  // Suppliers
  VIEW_SUPPLIERS:      'view:suppliers',
  MANAGE_SUPPLIERS:    'manage:suppliers',

  // Purchases (buying stock / supplier bills & credit)
  VIEW_PURCHASES:      'view:purchases',
  MANAGE_PURCHASES:    'manage:purchases',

  // Customers
  VIEW_CUSTOMERS:      'view:customers',
  MANAGE_CUSTOMERS:    'manage:customers',
  MANAGE_CREDITS:      'manage:credits',
  VIEW_CREDITS:        'view:credits',

  // Users & settings
  MANAGE_USERS:        'manage:users',
  MANAGE_ROLES:        'manage:roles',
  MANAGE_SETTINGS:     'manage:settings',
  MANAGE_PRICING:      'manage:pricing',

  // Finance
  VIEW_FINANCE:        'view:finance',
  MANAGE_FINANCE:      'manage:finance',

  // Alerts
  VIEW_ALERTS:         'view:alerts',

  // Delete
  DELETE_RECORDS:      'delete:records',
}

// ── Role identifiers ──────────────────────────────────────────────────────────
export const ROLES = {
  SUPER_ADMIN:          'super_admin',
  GENERAL_MANAGER:      'general_manager',
  BRANCH_MANAGER:       'branch_manager',
  INVENTORY_MANAGER:    'inventory_manager',
  SALES_REP:            'sales_rep',
  ACCOUNTANT:           'accountant',
}

// ── Human-readable role labels ─────────────────────────────────────────────────
export const ROLE_LABELS = {
  super_admin:          'Super Admin / Owner',
  general_manager:      'General Manager',
  branch_manager:       'Branch Manager',
  inventory_manager:    'Inventory Manager',
  sales_rep:            'Sales Representative',
  accountant:           'Accountant',
}

// ── Role badge colours ────────────────────────────────────────────────────────
export const ROLE_COLORS = {
  super_admin:          { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  general_manager:      { bg: '#fff7ed', color: '#f97316', border: '#fed7aa' },
  branch_manager:       { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  inventory_manager:    { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  sales_rep:            { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  accountant:           { bg: '#fdf4ff', color: '#9333ea', border: '#e9d5ff' },
}

// ── Permission map — what each role can do ─────────────────────────────────────
// '*' means all permissions (super_admin only)
const ALL = Object.values(P)

export const ROLE_PERMISSIONS = {
  // 1. Super Admin — unrestricted
  [ROLES.SUPER_ADMIN]: ALL,

  // 2. General Manager
  [ROLES.GENERAL_MANAGER]: [
    P.VIEW_DASHBOARD, P.VIEW_ANALYTICS, P.VIEW_PROFITS, P.VIEW_MARGINS,
    P.EXPORT_REPORTS, P.VIEW_FINANCE,
    P.VIEW_INVENTORY, P.MANAGE_INVENTORY, P.MANAGE_STOCK, P.VIEW_INVENTORY_INTEL,
    P.VIEW_SALES, P.CREATE_SALES, P.MANAGE_SALES, P.CREATE_QUOTATIONS,
    P.VIEW_SUPPLIERS, P.MANAGE_SUPPLIERS,
    P.VIEW_PURCHASES, P.MANAGE_PURCHASES,
    P.VIEW_CUSTOMERS, P.MANAGE_CUSTOMERS, P.MANAGE_CREDITS, P.VIEW_CREDITS,
    P.MANAGE_USERS,
    P.VIEW_ALERTS,
  ],

  // 3. Branch Manager
  [ROLES.BRANCH_MANAGER]: [
    P.VIEW_DASHBOARD, P.VIEW_ANALYTICS,
    P.VIEW_INVENTORY, P.MANAGE_INVENTORY, P.MANAGE_STOCK, P.VIEW_INVENTORY_INTEL,
    P.VIEW_SALES, P.CREATE_SALES, P.MANAGE_SALES, P.CREATE_QUOTATIONS,
    P.VIEW_SUPPLIERS, P.MANAGE_SUPPLIERS,
    P.VIEW_PURCHASES, P.MANAGE_PURCHASES,
    P.VIEW_CUSTOMERS, P.MANAGE_CUSTOMERS, P.MANAGE_CREDITS, P.VIEW_CREDITS,
    P.VIEW_ALERTS,
  ],

  // 4. Inventory Manager / Storekeeper
  [ROLES.INVENTORY_MANAGER]: [
    P.VIEW_DASHBOARD,
    P.VIEW_INVENTORY, P.MANAGE_INVENTORY, P.MANAGE_STOCK, P.VIEW_INVENTORY_INTEL,
    P.VIEW_SUPPLIERS, P.VIEW_PURCHASES,
    P.VIEW_ALERTS,
  ],

  // 5. Sales Representative / Cashier
  [ROLES.SALES_REP]: [
    P.VIEW_DASHBOARD,
    P.VIEW_INVENTORY,      // read-only stock lookup
    P.VIEW_SALES, P.CREATE_SALES, P.CREATE_QUOTATIONS,
    P.VIEW_CUSTOMERS,
    P.VIEW_ALERTS,
    P.VIEW_INVENTORY_INTEL,
  ],

  // 6. Accountant / Finance Officer
  [ROLES.ACCOUNTANT]: [
    P.VIEW_DASHBOARD,
    P.VIEW_SALES,
    P.VIEW_CUSTOMERS, P.VIEW_CREDITS, P.MANAGE_CREDITS,
    P.EXPORT_REPORTS,
    P.VIEW_FINANCE, P.MANAGE_FINANCE,
    P.VIEW_PURCHASES, P.MANAGE_PURCHASES,
    P.VIEW_ALERTS,
    P.VIEW_INVENTORY_INTEL,
  ],
}

// ── Nav item permission requirements ──────────────────────────────────────────
// Each route maps to the minimum permission needed to see it in the sidebar
export const NAV_PERMISSIONS = {
  '/':                        P.VIEW_DASHBOARD,
  '/inventory':               P.VIEW_INVENTORY,
  '/customers':               P.VIEW_CUSTOMERS,
  '/sales':                   P.VIEW_SALES,
  '/suppliers':               P.VIEW_SUPPLIERS,
  '/purchases':               P.VIEW_PURCHASES,
  '/analytics':               P.VIEW_ANALYTICS,
  '/finance':                 P.VIEW_FINANCE,
  '/alerts':                  P.VIEW_ALERTS,
  '/inventory-intelligence':  P.VIEW_INVENTORY_INTEL,
  '/settings':                P.VIEW_DASHBOARD,
}

// ── Helper: resolve permissions for a role string ──────────────────────────────
export const getPermissionsForRole = (role) =>
  ROLE_PERMISSIONS[role] || []

// ── Helper: check a single permission ─────────────────────────────────────────
export const roleHasPermission = (role, permission) => {
  const perms = getPermissionsForRole(role)
  return perms.includes(permission)
}