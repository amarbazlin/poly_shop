/**
 * Simple in-memory cache with TTL (time-to-live) support.
 * Used to avoid redundant API calls on the same data within a short window.
 */

const CACHE_TTL_DEFAULT_MS = 5 * 60 * 1000 // 5 minutes default TTL

const store = new Map()

/**
 * Get a value from cache.
 * @param {string} key
 * @returns {any|null} Returns the cached value or null if expired/missing.
 */
export function cacheGet(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value
}

/**
 * Set a value in cache with TTL.
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs - Time to live in milliseconds (default 5 min).
 */
export function cacheSet(key, value, ttlMs = CACHE_TTL_DEFAULT_MS) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })
}

/**
 * Invalidate a specific cache key.
 * @param {string} key
 */
export function cacheInvalidate(key) {
  store.delete(key)
}

/**
 * Clear all cached entries.
 */
export function cacheClear() {
  store.clear()
}

/**
 * Generate a consistent cache key from parts.
 * @param {...string} parts
 * @returns {string}
 */
export function cacheKey(...parts) {
  return parts.join(':')
}

export default { cacheGet, cacheSet, cacheInvalidate, cacheClear, cacheKey }