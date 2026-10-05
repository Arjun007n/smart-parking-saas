# Hardware shop: catalog, cart, checkout, orders

The shop sells the gate hardware (barriers, cameras, printers, readers) online. It reuses the payment
gateway, the seller details and the invoice numbering of plan purchases (see `docs/billing.md`).

## Who does what

* **Anyone** browses the catalog on `/product` and fills a cart (kept in the browser; only product ids and
  counts are stored there). Prices are always worked out by the server (`POST /api/shop/cart`).
* **A company admin** (`COMPANY_MANAGE`) signs in, enters the delivery address at `/checkout` and pays
  online. Orders and invoices are under Dashboard > My Orders.
* **The platform (Super Admin, `PLATFORM_MANAGE`)** keeps the catalog and ships the orders under
  Dashboard > Hardware Shop.

## The catalog

* Nothing is invented: a product has **no price until the Super Admin sets one**, and a product without a
  price shows "Ask us for a price" and goes to the enquiry form, not the cart.
* Dashboard > Hardware Shop > Products and prices > **Import the starter list** adds the eight items the
  website always showed (no prices). Then set per product: price (rupees, before GST), GST rate (0, 5, 12,
  18 or 28), HSN code (printed on the invoice), stock, most per order, picture address (https only),
  highlights, "works with the software today", and whether it is shown.
* Stock empty = made to order (no count kept). A number is counted down when an order is **paid** and
  put back if a paid order is cancelled. If two buyers race for the last unit both payments are honoured
  (the money is truth) and stock stops at zero.
* If the catalog is empty or cannot load, the website falls back to its fixed list as enquiry-only cards.

## Checkout and payment

1. `POST /api/shop/checkout` prices the cart again on the server, checks stock, the delivery address
   (state decides the GST) and the optional buyer GSTIN, creates a `ShopOrder` numbered `HW/26-27/0001`
   (financial year April to March) and a payment link at the gateway.
2. The customer pays on the gateway's page (UPI, cards, net banking). The webhook
   `POST /api/payments/webhook` is the same for every kind of payment: parking exit, online booking
   fee, plan purchase, then shop order.
3. When paid: the order becomes `PAID` / delivery `PROCESSING`, stock is counted down, a **GST invoice**
   is issued (same number series as plan invoices) and emailed with the PDF, the buyer gets an in-app
   note and the seller gets an email (`SHOP_NOTIFY_EMAIL`, else `SELLER_EMAIL`).
4. Rules shared with all payments: the money is truth (a late payment on a failed or cancelled order
   still counts), a wrong amount never starts an order (admins are alerted), repeated messages change
   nothing, and a minute-by-minute sweep asks the gateway about links whose webhook never came and closes
   unpaid ones after `SHOP_LINK_HOURS` (default 24).
5. Pressing "Place order" twice with the same cart and address reuses the waiting payment link.

## GST on goods

* Goods are taxed at the **place of supply: the delivery state**. Delivery state = seller state
  (`SELLER_STATE` / `SELLER_GSTIN`): CGST + SGST (half each, the odd paisa goes to SGST). Another state: IGST.
* Each line has its own rate and HSN code. The invoice shows one row per item, a Delivery charges row when
  there is one, the taxable value, and CGST + SGST or IGST (with the rate when all rows share it).
* The invoice PDF is one page, so an order holds at most 15 different products.

## Delivery charge

Flat per order, set in `server/.env`: `SHOP_SHIPPING_FLAT` (rupees before GST, default 0 = delivery
included), `SHOP_FREE_SHIPPING_ABOVE` (free when the goods come to this much before GST, default off),
`SHOP_SHIPPING_GST` (default 18) and `SHOP_SHIPPING_SAC` (printed on the invoice; ask your accountant).

## Delivery updates

`NONE` (not paid) > `PROCESSING` > `SHIPPED` (courier required, tracking number optional) > `DELIVERED`.
Cancelling a paid order (`PROCESSING` or `SHIPPED`) needs a reason, puts the stock back and tells the buyer.
**Refunds are not automatic**: refund the payment in the gateway. The buyer is told in-app and by email on
each step. A buyer can cancel only an order still waiting for payment.

## Installation

The checkout has an "install it for me" tick. It is only a request: the platform sees it on the order and
contacts the buyer about the charge. No installation price is taken online.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/api/shop/info` | anyone: delivery terms, states, whether ordering is open |
| GET | `/api/shop/products`, `/products/:id` | anyone (published products; the stock count is private) |
| POST | `/api/shop/cart` | anyone: `{items:[{productId, qty}]}` returns priced lines, problems, totals (60 a minute) |
| POST | `/api/shop/checkout` | `COMPANY_MANAGE`: `{items, shipTo{name,phone,line1,line2?,city,state,pincode}, installationRequested?, notes?, gstin?}` |
| GET | `/api/shop/orders`, `/orders/:id` | the company's own orders |
| POST | `/api/shop/orders/:id/cancel` | cancel an unpaid order |
| POST | `/api/shop/orders/:id/simulate` | practice gateway only |
| GET | `/api/billing/invoices/:id/pdf` | invoice download (shared with plan invoices) |
| GET, POST, PUT | `/api/shop/admin/products`, `/admin/products/:id` | `PLATFORM_MANAGE` |
| POST | `/api/shop/admin/products/import-starter` | `PLATFORM_MANAGE`: only while the catalog is empty |
| GET | `/api/shop/admin/orders?status=&fulfilment=&q=`, `/admin/orders/:id` | `PLATFORM_MANAGE` |
| PUT | `/api/shop/admin/orders/:id/fulfilment` | `PLATFORM_MANAGE`: `{to: SHIPPED \| DELIVERED \| CANCELLED, courier?, trackingNumber?, note?}` |

## Not built yet

Online refunds, returns, coupons, several delivery charges by weight or pincode, order edits after
payment, a seller-side invoice cancellation or credit note, product variants and reviews. The shop and its
invoices have only been tested with the practice gateway and automated tests, not real Razorpay.

## Tests

* Unit: `node --test tests/shop.test.js`
* Integration (needs MongoDB): `tests/shop.integration.test.js` (also in `npm test`)
