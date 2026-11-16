/**
 * Forgiving product search for the Inventory table and the POS product grid.
 *
 * Shop staff type whichever form of a name or code they remember — "PC 1/2",
 * "pc-1/2", "PC12", "1/2 pc" — while the catalogue stores exactly one of them,
 * so a plain substring test misses most real queries. Every value is therefore
 * reduced to a single canonical form before comparing: accents stripped, case
 * folded, and every separator removed. The query is split into tokens that must
 * all be found, in any order, which makes the search insensitive to case,
 * accents, leading/trailing/repeated spaces and to the separators people use
 * interchangeably (space, hyphen, slash, dot, comma, bracket, quote).
 *
 * The rules favour recall over precision — showing one extra row while typing
 * is harmless, missing the product is not — and the relevance ranking below
 * keeps the best hit at the top of the list.
 */

// Combining marks left behind by NFD (é → e + U+0301), removed so "creme"
// finds "crème".
const COMBINING_MARKS = /[\u0300-\u036f]/g

// Anything that is not a letter or a digit is a separator: spaces, tabs,
// hyphens, slashes, dots, commas, quotes, brackets, symbols.
const NON_ALPHANUMERIC = /[^a-z0-9]+/g

/**
 * Canonical form of a value used for comparison — "Nail 1/2" and "nail12" both
 * collapse to "nail12".
 *
 * @param {unknown} value
 * @returns {string}
 */
export const normalizeSearchText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, '')

/**
 * Splits a query into tokens at every separator, each in canonical form:
 * "PC 1/2" → ['pc', '1', '2'], "  -  " → [].
 *
 * @param {unknown} query
 * @returns {string[]}
 */
export const tokenizeQuery = (query) =>
  String(query ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .split(NON_ALPHANUMERIC)
    .filter(Boolean)

// Field weights: the product code is how the shop identifies a product, so a
// hit there outranks one in the name, which outranks the category, which
// outranks a supplier or unit hit.
const CODE_WEIGHT = 4
const NAME_WEIGHT = 3
const CATEGORY_WEIGHT = 2
const OTHER_WEIGHT = 1

/** Canonical fields of one product, with the weight each carries. */
const fieldsFor = (product) => [
  { value: normalizeSearchText(product?.product_code), weight: CODE_WEIGHT },
  { value: normalizeSearchText(product?.product_name), weight: NAME_WEIGHT },
  { value: normalizeSearchText(product?.categories?.name), weight: CATEGORY_WEIGHT },
  { value: normalizeSearchText(product?.suppliers?.supplier_name), weight: OTHER_WEIGHT },
  { value: normalizeSearchText(product?.unit), weight: OTHER_WEIGHT },
].filter((field) => field.value)

/** Relevance of one indexed product, or 0 when it does not match at all. */
const scoreEntry = ({ fields }, tokens, compactQuery) => {
  if (!tokens.length) return 1

  const haystack = fields.map((field) => field.value).join(' ')

  // Every token must appear somewhere — order does not matter, so a search for
  // "copper 2mm" also finds "2mm Copper Wire".
  for (const token of tokens) {
    if (!haystack.includes(token)) return 0
  }

  // The first token decides the ranking (people type the distinctive part
  // first): exact field > field prefix > field substring.
  const [lead] = tokens
  let score = 0
  for (const { value, weight } of fields) {
    if (value === lead) score = Math.max(score, 12 * weight)
    else if (value.startsWith(lead)) score = Math.max(score, 9 * weight)
    else if (value.includes(lead)) score = Math.max(score, 5 * weight)
  }

  // A hit on the whole query (separators ignored) beats a partial one.
  if (fields.some((field) => field.value === compactQuery)) score += 8
  else if (fields.some((field) => field.value.includes(compactQuery))) score += 4

  return score
}

/**
 * Pre-normalises a product list once, so each keystroke only runs substring
 * tests. Memoise the result against the product list:
 *
 *   const index = useMemo(() => buildProductSearchIndex(products), [products])
 *   const results = useMemo(() => searchProductIndex(index, search), [index, search])
 *
 * @param {Array<object>} products
 * @returns {Array<{product: object, order: number, fields: Array<{value: string, weight: number}>}>}
 */
export const buildProductSearchIndex = (products) =>
  (products || []).map((product, order) => ({ product, order, fields: fieldsFor(product) }))

/**
 * Filters and ranks an index built by `buildProductSearchIndex`.
 *
 * A blank or whitespace-only query returns the list untouched, in its original
 * (server) order. Matches are ranked by relevance, and the original order is
 * the tie-breaker, so rows never jump around between keystrokes.
 *
 * @param {ReturnType<typeof buildProductSearchIndex>} index
 * @param {unknown} query
 * @returns {Array<object>} matching products
 */
export const searchProductIndex = (index, query) => {
  const entries = index || []
  const tokens = tokenizeQuery(query)

  if (!tokens.length) return entries.map((entry) => entry.product)

  const compactQuery = normalizeSearchText(query)

  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens, compactQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.order - b.entry.order)
    .map(({ entry }) => entry.product)
}
