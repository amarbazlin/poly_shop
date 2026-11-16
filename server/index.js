import 'dotenv/config'
import { createApp } from './app.js'
import purchaseOrdersRouter from './routes/purchaseOrders.js'

const PORT = process.env.PORT || 3001

// purchaseOrders.js imports the v5-style `{ autoTable }` from jspdf-autotable,
// which is only installed here (server/node_modules). The production Vercel
// Function (api/[...path].js) bundles the root dependency set instead, so this
// router is mounted for local development only — no frontend service calls it.
const app = createApp({
  extraRoutes: (a) => a.use('/api/purchase-orders', purchaseOrdersRouter),
})

app.listen(PORT, () => {
  console.log(`Forgera API listening on http://localhost:${PORT}`)
})