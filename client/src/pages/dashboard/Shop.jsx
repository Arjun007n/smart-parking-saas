import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { shopApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { dateTime, money } from '../../utils/format'
import { Alert, Badge, Button, Card, Checkbox, Field, PageLoader, Select, Textarea } from '../../components/ui'
import { PAY_TEXT, PAY_TONE, SHIP_TEXT, SHIP_TONE } from './shopStatus'

// The platform's side of the hardware shop: the catalog (prices, GST, stock) and the orders to ship.

// ------------------------------------------------------------- orders ----

function OrderCard({ order }) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState(null) // 'SHIPPED' | 'CANCELLED' | null
  const [courier, setCourier] = useState('')
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const update = useMutation({
    mutationFn: (body) => shopApi.adminSetFulfilment(order._id, body),
    onSuccess: () => {
      setAction(null)
      queryClient.invalidateQueries({ queryKey: ['shop', 'admin', 'orders'] })
    },
  })
  const ship = order.shipTo

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {order.number} <Badge tone={PAY_TONE[order.status]}>{PAY_TEXT[order.status]}</Badge>{' '}
            {order.status === 'PAID' && <Badge tone={SHIP_TONE[order.fulfilment]}>{SHIP_TEXT[order.fulfilment]}</Badge>}
          </p>
          <p className="text-sm text-slate-600">{order.company?.name || 'Company'}{order.company?.email ? ` · ${order.company.email}` : ''}{order.company?.phone ? ` · ${order.company.phone}` : ''}</p>
          <p className="text-xs text-slate-500">{dateTime(order.createdAt)}{order.paidAt ? ` · paid ${dateTime(order.paidAt)}` : ''}</p>
        </div>
        <p className="text-lg font-extrabold text-[#0b4ea2]">{money(order.total)}</p>
      </div>

      <ul className="mt-3 list-disc pl-5 text-sm text-slate-800">
        {order.lines.map((l) => <li key={l.productId}>{l.qty} × {l.name} <span className="text-slate-500">({money(l.unitPrice)} each + {l.gstPercent}% GST)</span></li>)}
      </ul>
      <p className="mt-2 text-sm text-slate-700">
        <span className="font-semibold">Deliver to:</span> {ship.name}, {ship.phone}, {ship.line1}{ship.line2 ? `, ${ship.line2}` : ''}, {ship.city}, {ship.state} {ship.pincode}
      </p>
      {order.buyerGstin && <p className="text-sm text-slate-700"><span className="font-semibold">Buyer GSTIN:</span> {order.buyerGstin}</p>}
      {order.installationRequested && <p className="text-sm font-semibold text-amber-800">Installation requested</p>}
      {order.notes && <p className="text-sm text-slate-600">Note: {order.notes}</p>}
      {order.courier && <p className="text-sm text-slate-700"><span className="font-semibold">Shipped with:</span> {order.courier}{order.trackingNumber ? `, tracking ${order.trackingNumber}` : ''}</p>}
      {order.failureReason && order.status !== 'PAID' && <p className="text-sm text-red-700">{order.failureReason}</p>}

      {order.status === 'PAID' && ['PROCESSING', 'SHIPPED'].includes(order.fulfilment) && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {!action && (
            <div className="flex flex-wrap gap-2">
              {order.fulfilment === 'PROCESSING' && <Button onClick={() => setAction('SHIPPED')}>Mark as shipped</Button>}
              {order.fulfilment === 'SHIPPED' && <Button onClick={() => update.mutate({ to: 'DELIVERED' })} loading={update.isPending}>Mark as delivered</Button>}
              <Button variant="danger" onClick={() => setAction('CANCELLED')}>Cancel order</Button>
            </div>
          )}
          {action === 'SHIPPED' && (
            <form
              className="grid gap-3 sm:grid-cols-3"
              onSubmit={(e) => { e.preventDefault(); update.mutate({ to: 'SHIPPED', courier, ...(tracking ? { trackingNumber: tracking } : {}) }) }}
            >
              <Field label="Courier" name={`courier-${order._id}`} value={courier} onChange={(e) => setCourier(e.target.value)} required maxLength={80} />
              <Field label="Tracking number (optional)" name={`track-${order._id}`} value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={80} />
              <div className="flex items-end gap-2">
                <Button type="submit" loading={update.isPending}>Save and tell the buyer</Button>
                <Button type="button" variant="secondary" onClick={() => setAction(null)}>Back</Button>
              </div>
            </form>
          )}
          {action === 'CANCELLED' && (
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); update.mutate({ to: 'CANCELLED', note }) }}
            >
              <Field label="Why is it cancelled? (the buyer is told)" name={`why-${order._id}`} value={note} onChange={(e) => setNote(e.target.value)} required maxLength={300} />
              <p className="text-xs text-slate-500">The stock is put back. The payment is NOT refunded automatically: refund it in your payment gateway.</p>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" loading={update.isPending}>Cancel the order</Button>
                <Button type="button" variant="secondary" onClick={() => setAction(null)}>Back</Button>
              </div>
            </form>
          )}
          <div className="mt-2"><Alert>{update.error && errorMessage(update.error)}</Alert></div>
        </div>
      )}
    </li>
  )
}

function Orders() {
  const [filter, setFilter] = useState('PROCESSING')
  const [search, setSearch] = useState('')
  const params = {
    ...(filter === 'UNPAID' ? { status: 'PENDING' } : filter === 'FAILED' ? { status: 'FAILED' } : filter ? { fulfilment: filter } : {}),
    ...(search.trim() ? { q: search.trim() } : {}),
  }
  const orders = useQuery({ queryKey: ['shop', 'admin', 'orders', params], queryFn: () => shopApi.adminOrders(params) })

  return (
    <Card title="Orders">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Select label="Show" name="order-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="PROCESSING">To ship (paid, being prepared)</option>
          <option value="SHIPPED">Shipped</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CANCELLED">Cancelled after payment</option>
          <option value="UNPAID">Waiting for payment</option>
          <option value="FAILED">Not paid</option>
          <option value="">All orders</option>
        </Select>
        <Field label="Search by order number or company" name="order-search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {orders.isLoading && <PageLoader />}
      {orders.error && <Alert>{errorMessage(orders.error)}</Alert>}
      {orders.data && orders.data.length === 0 && <p className="text-sm text-slate-500">No orders here.</p>}
      <ul className="space-y-3">{orders.data?.map((order) => <OrderCard key={order._id} order={order} />)}</ul>
    </Card>
  )
}

// ----------------------------------------------------------- products ----

const emptyForm = {
  name: '', category: '', brand: '', modelNumber: '', description: '', highlights: '', imageUrl: '', price: '', gstPercent: '18',
  hsn: '', stock: '', maxPerOrder: '20', worksWithSoftware: true, isActive: true, sortOrder: '0',
}
const toForm = (p) => ({
  name: p.name || '', category: p.category || '', brand: p.brand || '', modelNumber: p.modelNumber || '', description: p.description || '',
  highlights: (p.highlights || []).join('\n'), imageUrl: p.imageUrl || '', price: p.price ?? '', gstPercent: String(p.gstPercent ?? 18),
  hsn: p.hsn || '', stock: p.stock ?? '', maxPerOrder: String(p.maxPerOrder ?? 20), worksWithSoftware: p.worksWithSoftware !== false,
  isActive: p.isActive !== false, sortOrder: String(p.sortOrder ?? 0),
})
const num = (text) => (text === '' || text === null ? null : Number(text))

const toBody = (f) => ({
  name: f.name.trim(),
  category: f.category.trim(),
  brand: f.brand.trim(),
  modelNumber: f.modelNumber.trim(),
  description: f.description.trim(),
  highlights: f.highlights.split('\n').map((h) => h.trim()).filter(Boolean).slice(0, 8),
  imageUrl: f.imageUrl.trim(),
  price: num(String(f.price).trim()), // blank = "ask us for a price"
  gstPercent: Number(f.gstPercent),
  hsn: f.hsn.trim(),
  stock: num(String(f.stock).trim()), // blank = made to order, no count kept
  maxPerOrder: Number(f.maxPerOrder) || 20,
  worksWithSoftware: f.worksWithSoftware,
  isActive: f.isActive,
  sortOrder: Number(f.sortOrder) || 0,
})

function ProductForm({ product, onDone }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(() => (product ? toForm(product) : emptyForm))
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))
  const save = useMutation({
    mutationFn: () => (product ? shopApi.adminUpdateProduct(product._id, toBody(form)) : shopApi.adminCreateProduct(toBody(form))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop'] })
      onDone()
    },
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <h3 className="font-semibold text-slate-900">{product ? `Edit ${product.name}` : 'New product'}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="p-name" value={form.name} onChange={set('name')} required maxLength={120} />
        <Field label="Category" name="p-category" value={form.category} onChange={set('category')} required maxLength={60} hint="Visitors can filter by this, for example Cameras" />
        <Field label="Brand (optional)" name="p-brand" value={form.brand} onChange={set('brand')} maxLength={60} />
        <Field label="Model number (optional)" name="p-model" value={form.modelNumber} onChange={set('modelNumber')} maxLength={60} />
      </div>
      <Textarea label="Description" name="p-description" rows={3} value={form.description} onChange={set('description')} maxLength={1500} />
      <Textarea label="Highlights (one per line, up to 8)" name="p-highlights" rows={3} value={form.highlights} onChange={set('highlights')} />
      <Field label="Picture address (optional)" name="p-image" value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://…" hint="A web address starting with https://" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Price in rupees, before GST" name="p-price" type="number" min="0" step="0.01" value={form.price} onChange={set('price')} hint="Leave empty to show Ask us for a price. Nothing can be ordered without a price." />
        <Select label="GST rate" name="p-gst" value={form.gstPercent} onChange={set('gstPercent')}>
          {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
        </Select>
        <Field label="HSN code (printed on the invoice)" name="p-hsn" value={form.hsn} onChange={set('hsn')} inputMode="numeric" maxLength={10} hint="Ask your accountant" />
        <Field label="Stock" name="p-stock" type="number" min="0" step="1" value={form.stock} onChange={set('stock')} hint="Leave empty for made to order (no count kept)" />
        <Field label="Most per order" name="p-max" type="number" min="1" max="100" value={form.maxPerOrder} onChange={set('maxPerOrder')} />
        <Field label="Sort order" name="p-sort" type="number" value={form.sortOrder} onChange={set('sortOrder')} hint="Smaller numbers come first" />
      </div>
      <div className="flex flex-wrap gap-6">
        <Checkbox label="Works with the software today" checked={form.worksWithSoftware} onChange={set('worksWithSoftware')} />
        <Checkbox label="Shown on the website" checked={form.isActive} onChange={set('isActive')} />
      </div>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending}>{product ? 'Save changes' : 'Add product'}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

function Products() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null) // a product, 'new', or null
  const products = useQuery({ queryKey: ['shop', 'admin', 'products'], queryFn: shopApi.adminProducts })
  const starter = useMutation({
    mutationFn: shopApi.adminImportStarter,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shop'] }),
  })

  return (
    <Card
      title="Products"
      action={!editing && <Button onClick={() => setEditing('new')}>Add a product</Button>}
    >
      {editing && <div className="mb-6"><ProductForm key={editing === 'new' ? 'new' : editing._id} product={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /></div>}
      {products.isLoading && <PageLoader />}
      {products.error && <Alert>{errorMessage(products.error)}</Alert>}
      {products.data && products.data.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">The catalog is empty, so the website shows its fixed hardware list as enquiries only. Import the same eight items here, then set a price, GST rate and stock on each one to let customers order them online.</p>
          <Button onClick={() => starter.mutate()} loading={starter.isPending}>Import the starter list</Button>
          <Alert>{starter.error && errorMessage(starter.error)}</Alert>
        </div>
      )}
      {products.data && products.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2 pr-4">Product</th><th className="pr-4 text-right">Price</th><th className="pr-4 text-right">GST</th><th className="pr-4 text-right">Stock</th><th className="pl-4">Online</th><th /></tr>
            </thead>
            <tbody>
              {products.data.map((p) => (
                <tr key={p._id} className="border-t border-slate-100">
                  <td className="py-2 pr-4"><span className="font-semibold text-slate-900">{p.name}</span><span className="block text-xs text-slate-500">{p.category}{p.isActive ? '' : ' · hidden'}</span></td>
                  <td className="pr-4 text-right">{p.price ? money(p.price) : <span className="text-slate-400">no price</span>}</td>
                  <td className="pr-4 text-right">{p.gstPercent}%</td>
                  <td className="pr-4 text-right">{p.stock === null || p.stock === undefined ? <span className="text-slate-400">made to order</span> : p.stock}</td>
                  <td className="pl-4">{p.canBuy ? <Badge tone="green">Can be ordered</Badge> : <Badge>Enquiry only</Badge>}</td>
                  <td className="text-right"><button type="button" onClick={() => setEditing(p)} className="font-semibold text-blue-700 hover:underline">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default function Shop() {
  const [tab, setTab] = useState('orders')
  const tabClass = (active) => `rounded-lg px-4 py-2 text-sm font-semibold ${active ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Hardware shop</h1>
      <div role="tablist" aria-label="Shop sections" className="flex gap-2">
        <button type="button" role="tab" aria-selected={tab === 'orders'} className={tabClass(tab === 'orders')} onClick={() => setTab('orders')}>Orders</button>
        <button type="button" role="tab" aria-selected={tab === 'products'} className={tabClass(tab === 'products')} onClick={() => setTab('products')}>Products and prices</button>
      </div>
      {tab === 'orders' ? <Orders /> : <Products />}
    </div>
  )
}
