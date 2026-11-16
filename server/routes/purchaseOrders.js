import express from 'express'
import { createUserClient } from '../lib/supabase.js'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'

const router = express.Router()

const getSupabase = (req) => {
  const token = req.headers.authorization?.split(' ')[1] || ''
  return createUserClient(token)
}

const endOfDayISO = (dateStr) => `${dateStr}T23:59:59.999Z`

// Fetch business info for PDF headers
async function getBusinessInfo(supabase, businessId) {
  if (!businessId) return { name: 'Forgera' }
  try {
    const { data } = await supabase
      .from('businesses')
      .select('name, address, phone, email')
      .eq('id', businessId)
      .single()
    if (data) {
      return {
        name: data.name || 'Forgera',
        address: data.address || '',
        phone: data.phone || '',
        email: data.email || '',
      }
    }
  } catch (err) {
    console.error('Failed to fetch business info:', err)
  }
  return { name: 'Forgera', address: '', phone: '', email: '' }
}

// GET /api/purchase-orders
router.get('/', async (req, res) => {
  const supabase = getSupabase(req)
  const { status, supplier_id, location_id, start_date, end_date, page = 1, limit = 50 } = req.query

  try {
    let query = supabase
      .from('purchases')
      .select(`
        *,
        suppliers ( id, supplier_name ),
        purchase_items ( count )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })

    if (req.businessId) query = query.eq('business_id', req.businessId)
    if (status) query = query.eq('status', status)
    if (supplier_id) query = query.eq('supplier_id', supplier_id)
    if (location_id) query = query.eq('location_id', location_id)
    if (start_date) query = query.gte('created_at', start_date)
    if (end_date) query = query.lte('created_at', endOfDayISO(end_date.slice(0, 10)))

    const from = (page - 1) * limit
    const to = from + limit - 1
    query = query.range(from, to)

    const { data, count, error } = await query

    if (error) throw error

    const formattedData = data.map(po => ({
      ...po,
      item_count: po.purchase_items?.[0]?.count || 0
    }))

    res.json({ data: formattedData, count, page: Number(page), limit: Number(limit) })
  } catch (err) {
    console.error('Error fetching purchase orders:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/purchase-orders/:id
router.get('/:id', async (req, res) => {
  const supabase = getSupabase(req)
  const { id } = req.params

  try {
    const { data: po, error } = await supabase
      .from('purchases')
      .select(`
        *,
        suppliers ( id, supplier_name, email, phone, address ),
        locations ( id, name, address ),
        purchase_items (
          id, product_id, quantity, unit_cost, subtotal,
          products ( id, product_name, product_code, unit )
        ),
        purchase_order_status_history (
          id, from_status, to_status, changed_at, notes,
          changed_by
        )
      `)
      .eq('id', id)
      .single()

    if (error) throw error
    if (!po) return res.status(404).json({ error: 'Purchase order not found' })

    if (po.purchase_order_status_history) {
      po.purchase_order_status_history.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at))
    }

    res.json(po)
  } catch (err) {
    console.error('Error fetching purchase order:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/purchase-orders
router.post('/', async (req, res) => {
  const supabase = getSupabase(req)
  const { supplier_id, location_id, expected_delivery_date, notes, items } = req.body

  try {
    if (!supplier_id) return res.status(400).json({ error: 'Supplier ID is required' })
    if (!items || !items.length) return res.status(400).json({ error: 'At least one item is required' })

    let total = 0
    const processedItems = items.map(item => {
      const q = parseFloat(item.quantity) || 0
      const c = parseFloat(item.unit_cost) || 0
      const subtotal = q * c
      total += subtotal
      return {
        product_id: item.product_id,
        quantity: q,
        unit_cost: c,
        subtotal
      }
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')
      
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('business_id, id')
      .eq('id', user.id)
      .single()
      
    if (profileError) throw profileError

    const { data: po, error: poError } = await supabase
      .from('purchases')
      .insert({
        supplier_id,
        location_id: location_id || null,
        expected_delivery_date: expected_delivery_date || null,
        notes,
        total_amount: total,
        status: 'draft',
        source: 'manual',
        created_by: profile.id,
        business_id: profile.business_id
      })
      .select()
      .single()

    if (poError) throw poError

    const itemsToInsert = processedItems.map(i => ({
      ...i,
      purchase_id: po.id
    }))

    const { error: itemsError } = await supabase
      .from('purchase_items')
      .insert(itemsToInsert)

    if (itemsError) throw itemsError

    const { error: historyError } = await supabase
      .from('purchase_order_status_history')
      .insert({
        purchase_id: po.id,
        from_status: null,
        to_status: 'draft',
        changed_by: profile.id,
        notes: 'Initial draft creation'
      })

    if (historyError) {
      console.warn('Failed to insert history row', historyError)
    }

    res.status(201).json(po)
  } catch (err) {
    console.error('Error creating purchase order:', err)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/purchase-orders/:id
router.patch('/:id', async (req, res) => {
  const supabase = getSupabase(req)
  const { id } = req.params
  const { expected_delivery_date, notes, items, location_id } = req.body

  try {
    const { data: po, error: fetchError } = await supabase
      .from('purchases')
      .select('status')
      .eq('id', id)
      .single()

    if (fetchError) throw fetchError
    if (!po) return res.status(404).json({ error: 'Purchase order not found' })

    if (po.status !== 'draft') {
      return res.status(409).json({ error: 'Cannot edit a purchase order that has left draft status. Cancel and recreate, or contact an approver.' })
    }

    let total = undefined
    let itemsToInsert = null

    if (items && items.length) {
      total = 0
      itemsToInsert = items.map(item => {
        const q = parseFloat(item.quantity) || 0
        const c = parseFloat(item.unit_cost) || 0
        const subtotal = q * c
        total += subtotal
        return {
          purchase_id: id,
          product_id: item.product_id,
          quantity: q,
          unit_cost: c,
          subtotal
        }
      })
    }

    const updates = {}
    if (expected_delivery_date !== undefined) updates.expected_delivery_date = expected_delivery_date || null
    if (notes !== undefined) updates.notes = notes
    if (location_id !== undefined) updates.location_id = location_id || null
    if (total !== undefined) updates.total_amount = total

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('purchases')
        .update(updates)
        .eq('id', id)
        
      if (updateError) throw updateError
    }

    if (itemsToInsert) {
      const { error: deleteError } = await supabase
        .from('purchase_items')
        .delete()
        .eq('purchase_id', id)
        
      if (deleteError) throw deleteError

      const { error: insertError } = await supabase
        .from('purchase_items')
        .insert(itemsToInsert)
        
      if (insertError) throw insertError
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Error updating purchase order:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/purchase-orders/:id/transition
router.post('/:id/transition', async (req, res) => {
  const supabase = getSupabase(req)
  const { id } = req.params
  const { new_status, notes } = req.body

  try {
    if (!new_status) return res.status(400).json({ error: 'new_status is required' })

    const { data, error } = await supabase.rpc('transition_purchase_order_status', {
      p_purchase_id: parseInt(id),
      p_new_status: new_status,
      p_notes: notes || null
    })

    if (error) {
      console.error('RPC Error:', error.message)
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message })
      }
      if (error.message.includes('Insufficient role')) {
        return res.status(403).json({ error: error.message })
      }
      return res.status(400).json({ error: error.message })
    }

    res.json(data)
  } catch (err) {
    console.error('Error transitioning purchase order:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/purchase-orders/:id/pdf
router.get('/:id/pdf', async (req, res) => {
  const supabase = getSupabase(req)
  const { id } = req.params

  try {
    const { data: po, error } = await supabase
      .from('purchases')
      .select(`
        *,
        suppliers ( id, supplier_name, email, phone, address ),
        locations ( id, name, address ),
        purchase_items (
          id, product_id, quantity, unit_cost, subtotal,
          products ( id, product_name, product_code, unit )
        )
      `)
      .eq('id', id)
      .single()

    if (error) throw error
    if (!po) return res.status(404).json({ error: 'Purchase order not found' })

    // Fetch dynamic business info
    const businessInfo = await getBusinessInfo(supabase, po.business_id || req.businessId)

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const DARK = [13, 17, 23]
    const ACCENT = [249, 115, 22]
    
    doc.setFillColor(...DARK)
    doc.rect(0, 0, 210, 38, 'F')
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(255, 255, 255)
    doc.text(businessInfo.name || 'Forgera', 14, 16)
    
    doc.setFillColor(...ACCENT)
    doc.roundedRect(120, 6, 76, 10, 2, 2, 'F')
    doc.setFontSize(9)
    doc.text('PURCHASE ORDER', 158, 12.5, { align: 'center' })
    
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(180, 180, 180)
    doc.text(businessInfo.address || 'Forgera System', 14, 24)
    
    doc.setTextColor(...ACCENT)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(`PO-${po.id.toString().padStart(5, '0')}`, 196, 24, { align: 'right' })
    doc.setTextColor(180, 180, 180)
    doc.setFont('helvetica', 'normal')
    const date = new Date(po.created_at).toLocaleDateString('en-US')
    doc.text(`Date: ${date}`, 196, 30, { align: 'right' })
    
    doc.setFillColor(...ACCENT)
    doc.rect(0, 38, 210, 1.5, 'F')
    
    const yStart = 46
    doc.setFillColor(245, 245, 245)
    doc.roundedRect(14, yStart, 90, 28, 2, 2, 'F')
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 100, 100)
    doc.text('SUPPLIER', 18, yStart + 7)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...DARK)
    doc.text(po.suppliers?.supplier_name || '—', 18, yStart + 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(80, 80, 80)
    if (po.suppliers?.phone) doc.text(`Tel: ${po.suppliers.phone}`, 18, yStart + 20)
    if (po.suppliers?.address) doc.text(po.suppliers.address, 18, yStart + 26)
    
    doc.setFillColor(240, 240, 240)
    doc.roundedRect(120, yStart, 76, 28, 2, 2, 'F')
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 100, 100)
    doc.text('DELIVER TO', 124, yStart + 7)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...DARK)
    doc.text(po.locations?.name || 'Main Warehouse', 124, yStart + 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(80, 80, 80)
    if (po.locations?.address) doc.text(po.locations.address, 124, yStart + 20)
    if (po.expected_delivery_date) doc.text(`Expected: ${new Date(po.expected_delivery_date).toLocaleDateString('en-US')}`, 124, yStart + 26)
    
    const tableItems = (po.purchase_items || []).map((item, i) => [
      i + 1,
      item.products?.product_name || '—',
      item.quantity,
      item.products?.unit || 'pcs',
      parseFloat(item.unit_cost).toFixed(2),
      parseFloat(item.subtotal).toFixed(2),
    ])
    
    autoTable(doc, {
      startY: 82,
      margin: { left: 14, right: 14 },
      head: [['#', 'Product', 'Qty', 'Unit', 'Unit Cost', 'Subtotal']],
      body: tableItems,
      headStyles: {
        fillColor: DARK,
        textColor: 255,
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'center',
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 70 },
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 15, halign: 'center' },
        4: { cellWidth: 30, halign: 'right' },
        5: { cellWidth: 30, halign: 'right' },
      },
      bodyStyles: { fontSize: 8.5, textColor: [40, 40, 40] },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      styles: { lineColor: [220, 220, 220], lineWidth: 0.1 },
    })
    
    const finalY = doc.lastAutoTable.finalY
    
    autoTable(doc, {
      startY: finalY + 4,
      margin: { left: 120, right: 14 },
      body: [
        ['TOTAL', `${parseFloat(po.total_amount).toFixed(2)}`]
      ],
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { textColor: [100, 100, 100], fontStyle: 'bold' }, 1: { halign: 'right', fontStyle: 'bold', textColor: DARK } },
      didDrawCell: (data) => {
        doc.setFillColor(...ACCENT)
        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.text(data.cell.text[0], data.cell.x + (data.column.index === 1 ? data.cell.width - 4 : 4), data.cell.y + 6,
          { align: data.column.index === 1 ? 'right' : 'left' })
      },
      styles: { lineColor: [220, 220, 220], lineWidth: 0.1 },
    })
    
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="PO-${po.id}.pdf"`)
    res.send(pdfBuffer)
  } catch (err) {
    console.error('Error generating PDF:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router