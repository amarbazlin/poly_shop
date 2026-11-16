import { API_ROOT, authHeaders, readJson } from './apiClient'

async function request(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: { ...(await authHeaders()), ...options.headers },
  })

  return readJson(response, `Request failed for ${path}`)
}

export const locationService = {
  /** Active locations for dropdowns */
  getActive: () => request('/api/locations'),

  /** All locations including inactive (settings management) */
  getAll: () => request('/api/locations/all'),

  create: (payload) => request('/api/locations', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  update: (id, payload) => request(`/api/locations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),

  deactivate: (id) => request(`/api/locations/${id}/deactivate`, {
    method: 'PATCH',
  }),
}

export default locationService
