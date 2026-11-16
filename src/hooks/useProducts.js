import { useState, useEffect, useCallback } from 'react'
import { productService } from '../services/productService'
import { useAuth } from '../context/AuthContext'

export const useProducts = (filters = {}) => {
  const { businessId } = useAuth()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await productService.getAll({ ...filters, businessId })
      setProducts(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [JSON.stringify(filters), businessId])

  useEffect(() => { fetch() }, [fetch])

  return { products, loading, error, refetch: fetch }
}

export const useProductSummary = () => {
  const { businessId } = useAuth()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    productService.getSummary(businessId)
      .then(setSummary)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [businessId])

  return { summary, loading }
}

export const useCategories = () => {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    productService.getCategories()
      .then(setCategories)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { categories, loading }
}