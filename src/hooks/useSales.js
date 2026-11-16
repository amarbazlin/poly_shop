import { useState, useEffect, useCallback } from 'react'
import { salesService } from '../services/salesService'
import { useAuth } from '../context/AuthContext'

export const useSales = (options = {}) => {
  const { businessId } = useAuth()
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await salesService.getAll({ ...options, businessId })
      setSales(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [JSON.stringify(options), businessId])

  useEffect(() => { fetch() }, [fetch])

  return { sales, loading, error, refetch: fetch }
}

export const useSalesSummary = (days = 30) => {
  const { businessId } = useAuth()
  const [summary, setSummary] = useState(null)
  const [chartData, setChartData] = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      salesService.getSummary(days, businessId),
      salesService.getDailyChart(days, businessId),
      salesService.getTopProducts(10, null, businessId),
    ]).then(([s, chart, top]) => {
      setSummary(s)
      setChartData(chart)
      setTopProducts(top)
    }).catch(console.error)
      .finally(() => setLoading(false))
  }, [days, businessId])

  return { summary, chartData, topProducts, loading }
}