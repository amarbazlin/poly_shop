import { useState, useEffect, useCallback } from 'react'
import { customerService } from '../services/customerService'
import { useAuth } from '../context/AuthContext'

export const useCustomers = (filters = {}) => {
  const { businessId } = useAuth()
  const [customers, setCustomers] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await customerService.getAll({ ...filters, businessId })
      setCustomers(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [JSON.stringify(filters), businessId])

  useEffect(() => { fetch() }, [fetch])
  return { customers, loading, error, refetch: fetch }
}

export const useCustomerSummary = () => {
  const { businessId } = useAuth()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    customerService.getSummary(businessId)
      .then(setSummary)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [businessId])

  return { summary, loading }
}