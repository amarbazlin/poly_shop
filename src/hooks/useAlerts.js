import { useState, useEffect } from 'react'
import { alertsService } from '../services/alertsService'
import { useAuth } from '../context/AuthContext'

export const useAlerts = () => {
  const { businessId } = useAuth()
  const [alerts, setAlerts] = useState([])
  const [unresolvedCount, setUnresolvedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchAlerts = async () => {
    setLoading(true)
    try {
      const [data, count] = await Promise.all([
        alertsService.getAll({ resolved: false, business_id: businessId }),
        alertsService.getUnresolvedCount({ business_id: businessId }),
      ])
      setAlerts(data || [])
      setUnresolvedCount(count)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAlerts() }, [])

  const resolveAlert = async (id) => {
    await alertsService.resolve(id, { business_id: businessId })
    await fetchAlerts()
  }

  const resolveAll = async () => {
    await alertsService.resolveAll({ business_id: businessId })
    await fetchAlerts()
  }

  return { alerts, unresolvedCount, loading, resolveAlert, resolveAll, refetch: fetchAlerts }
}