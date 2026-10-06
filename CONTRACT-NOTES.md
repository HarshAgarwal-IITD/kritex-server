# Contract notes (Stage 1, `server-contract`)

Judgment calls made while turning ARCHITECTURE.md §4 into DTOs + stub routes. Fold the accepted ones
back into ARCHITECTURE.md §3/§4, then delete this file. `openapi.json` is the source of truth;
`test/contract.e2e-spec.ts` lists every operationId with its method, path and auth.

## Conventions

- **81 operations**: 78 new and 3 existing (`getHealth`, `createQuery`, `listQueries`, unchanged).
  Every new route is a stub that throws `AppException('NOT_IMPLEMENTED', 501, '<operationId> not implemented yet')`
  via `src/common/exceptions/not-implemented.ts`. Input is validated before the stub runs, so bad input gives 400.
- **operationIds** are camelCase. Admin routes start with `admin` (e.g. `adminListOrders`). Customer `/me/*` routes use `My`
  (e.g. `listMyOrders`).
- **Tags**: `catalog`, `account`, `cart`, `checkout`, `quotes`, `shipping`, `webhooks`, `queries`, `health`,
  `admin-catalog`, `admin-orders`, `admin-quotes`, `admin-customers`, `admin-coupons`, `admin-queries`,
  `admin-dashboard`, `admin-users`.
- **Lists**: a non-paginated list is `{ items }`, never a bare array, so fields can be added later. A paginated list is
  `{ items, page, limit, total }`, with `?page` (1-based, default 1) and `?limit` (default 20, max 100). The one exception is
  `GET /admin/queries`, which returns a bare `QueryDto[]` as specified ("same response as GET /queries").
- **Money** is integer paise everywhere (`moneySchema`, which also accepts query params such as `minPrice`/`maxPrice`). `gstRate` is a
  number in percent (`5`, `12`, `18`). Prisma stores it as `Decimal(5,2)`, so services must convert with `Number()`.
- **Totals** (`totalsSchema`, used by cart, checkout quote, placed order and order detail) has the fields `subtotal, discount, shipping,
taxTotal, cgst, sgst, igst, total, currency: 'INR'`. Prices are GST-inclusive, so `total = subtotal - discount + shipping` and
  `taxTotal = cgst + sgst + igst` is the GST already inside `total`. Without an address, the cart preview assumes an intra-state sale
  (CGST+SGST).
- **Dates** are ISO-8601 UTC strings (`z.iso.datetime()`).
- **Query booleans** accept only the strings `"true"`/`"false"` (`queryBooleanSchema`).
- **Errors** use `@ApiErrors(...)` (`src/common/decorators/api-errors.decorator.ts`). The description names the specific
  `error.code` values. **422** is used for business-rule failures (`COUPON_*`, `CART_EMPTY`, `CART_HAS_ISSUES`,
  `NOT_PURCHASABLE`, `GSTIN_STATE_MISMATCH`, `SHIPROCKET_ERROR`). **409** is used for state/concurrency conflicts (`OUT_OF_STOCK`,
  `INSUFFICIENT_STOCK`, `INVALID_TRANSITION`, `PRICE_CHANGED`, `IDEMPOTENCY_KEY_REUSED`, slug/SKU/code taken).
- **IDs**: admin routes take `:id` (cuid). Customer routes take the human number: `/me/orders/:number` (`KTX-100001`) and
  `/me/quotes/:number` (format `KTQ-100001` suggested). The number params are upper-cased with the pattern `[A-Z0-9-]{3,32}`.
- **Delete** routes return `204` with no body. Products and coupons are archived/deactivated instead of deleted once orders
  reference them.
- **Mutation status codes**: cart mutations, `POST /checkout/quote`, `POST /checkout/verify` and admin action routes
  (`/status`, `/ship`, …) return **200**. Creates return **201** (including `POST /checkout` and quote accept).

## Auth metadata (`src/common/decorators/`)

- `@Public()` sets `isPublic` metadata. `@Roles(...roles)` sets `roles` metadata, adds the cookie security requirement, and documents
  401/403. `@Authenticated()` adds the cookie security requirement and documents 401 for "any signed-in user" routes; it only makes
  the default explicit. `@CurrentUser()` returns `req.user` (`SessionUser { id, email, name, role, emailVerified }`) or `undefined`.
  **No guard is enforced yet.** AUTH-2 adds a global AuthGuard that reads `isPublic`/`roles` with
  `reflector.getAllAndOverride([handler, class])`.
- OpenAPI security scheme `session`: an `apiKey` in a cookie named `better-auth.session_token` (Better Auth's default; the cookie becomes
  `__Secure-better-auth.session_token` over HTTPS). If AUTH-1 changes the cookie prefix, update `SESSION_COOKIE_NAME`.
- Public routes: catalog (4), cart (6), checkout (3), `POST /quotes`, `GET /orders/:number/tracking`, both webhooks, health, `POST /queries`.
  `/admin/users/*` is `@Roles('ADMIN')`. Every other `/admin/*` route is `@Roles('STAFF','ADMIN')`.
- The Better Auth endpoints are listed in the OpenAPI `info.description` and not documented as operations. The list assumes the
  `emailOTP` plugin; adjust it if AUTH-1 configures it differently.
- Customer handlers pass `user?.id ?? ''` to services until the guard guarantees `user`. AUTH-2 should tighten this to `user.id`.
- `GET /admin/queries` and `PATCH /admin/queries/:id` are deliberately **501 stubs**. Implementing the list now would expose
  enquiry PII without a guard. The API-key `GET /queries` stays unchanged (additive-only rule). It can be retired once the website
  switches to `adminListQueries`.

## Module placement (routes live in the module that owns the data)

| Route(s)                                                                                           | Module / controller                                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/me`, `/me/addresses*`, `/me/business-profile`                                                    | `customers/me.controller.ts`                                                   |
| `/admin/customers*`, `/admin/business-profiles*`                                                   | `customers/admin/admin-customers.controller.ts`                                |
| `/me/orders*`                                                                                      | `orders/my-orders.controller.ts`                                               |
| `/admin/orders*` (except shiprocket)                                                               | `orders/admin/admin-orders.controller.ts`                                      |
| `/admin/orders/:id/shiprocket`, `/orders/:number/tracking`, `/webhooks/shiprocket`                 | `shipping/`                                                                    |
| `/webhooks/razorpay`                                                                               | `payments/`                                                                    |
| `/orders/:number/invoice`                                                                          | `invoices/`                                                                    |
| `/me/quotes*`, `/quotes`, `/admin/quotes*`                                                         | `quotes/`                                                                      |
| `/cart*` (incl. coupon apply/remove)                                                               | `cart/`                                                                        |
| `/admin/coupons*`                                                                                  | `coupons/admin/` (CouponService.validate from PR-3 also belongs in `coupons/`) |
| `/admin/products*`, `/admin/variants*`, `/admin/inventory`, `/admin/categories*`, `/admin/uploads` | `catalog/admin/`                                                               |
| `/admin/dashboard`                                                                                 | `dashboard/`                                                                   |
| `/admin/users*`                                                                                    | `users/`                                                                       |
| `/admin/queries*`                                                                                  | `queries/admin/`                                                               |

No `auth`, `tax` or `notifications` modules were created. Better Auth arrives in AUTH-1, and tax/notifications have no routes.

## Endpoints added or interpreted beyond §4

- `GET /orders/:number/tracking?email=` is the **public tracking** endpoint (OPS-3/OPS-5). It requires the order email to prevent
  order-number enumeration and is throttled to 20/min.
- `GET /admin/business-profiles?status=` is the approvals queue ADM-8 needs. §4 only lists approve and reject.
- `POST /admin/business-profiles/:id/reject` takes `{ reason }`, which is shown to the customer.
- `POST /admin/quotes/:id/reject` was added because `REJECTED` needs an actor. §4 only had respond.
- **Admin categories CRUD** (`/admin/categories`, CAT-5/ADM-4) was added; §4 doesn't list it.
- **Variants:** `GET /admin/products/:id/variants` lists them. `POST /admin/products/:id/variants` **generates** variants from the
  options (cartesian product) and is idempotent: it creates missing combinations and deactivates removed ones when
  `deactivateMissing`. `PATCH /admin/variants/:id` edits SKU, title, price and isActive.
- **Stock:** `PATCH /admin/variants/:id/stock` takes `{ delta (≠0), reason: RESTOCK|ADJUST|RETURN, note? }`. A delta (not an
  absolute value) keeps the InventoryMovement audit simple. ORDER/RELEASE are system-only reasons.
- **Inventory:** `GET /admin/inventory?lowStock=true&threshold=5` treats `lowStock` as a boolean filter, with a separate `threshold`
  that defaults to 5.
- **Import:** `POST /admin/products/import?dryRun=` takes `multipart/form-data` with field `file` (CSV, max 5 MB) and returns
  `{ dryRun, rows, created, updated, skipped, errors[{row, field, message}] }`.
- **Uploads:** `POST /admin/uploads` takes `{ purpose, filename, contentType, size }` and returns
  `{ key, uploadUrl, method: 'PUT', headers, publicUrl, expiresAt }`.
- **Customer list:** `GET /admin/customers` and `GET /admin/customers/:id` (§4 says "list, detail").
- **Staff users:** `GET/POST /admin/users` and `PATCH /admin/users/:id`. POST invites a STAFF/ADMIN user and sends a set-password
  email. PATCH changes role/name/`disabled`; `disabled` maps to Better Auth admin plugin's `banned`. There is no DELETE: demote or
  disable instead. Expected errors are `CANNOT_MODIFY_SELF` and `LAST_ADMIN`.
- **Orders CSV:** `GET /admin/orders/export.csv` takes the same filters as the list, without pagination, and returns `text/csv`.
  Content headers are set only on success, so errors stay JSON.
- **Order notes:** `POST /admin/orders/:id/note` takes `{ message, internal = true }`.
- **Cancel:** `POST /admin/orders/:id/cancel` takes `{ reason, restock = true, refund = true, notifyCustomer = true }`.
- **Refund:** `POST /admin/orders/:id/refund` takes `{ amount, reason, restockItems[] }`. Partial refunds are allowed. The final
  status comes from the `refund.processed` webhook.
- **Mark paid:** `POST /admin/orders/:id/mark-paid` takes `{ reference (UTR/PO), amount?, paidAt?, note? }` and moves the order
  AWAITING_PAYMENT → PAID.
- **Manual ship:** `POST /admin/orders/:id/ship` takes `{ carrier, awb?, trackingUrl?, notifyCustomer }`. It is the manual fallback.
  The Shiprocket path is `/admin/orders/:id/shiprocket`.
- **Status changes:** `POST /admin/orders/:id/status` takes `{ status, note?, notifyCustomer }`. The admin order detail returns
  `allowedTransitions` so the UI only offers valid moves.
- **Returns:** `POST /me/orders/:number/return` takes `{ type: RETURN|EXCHANGE, reason: SIZE_ISSUE|DEFECTIVE|WRONG_ITEM|OTHER,
items[{orderItemId, quantity, exchangeVariantId?}], notes? }`. Order items therefore expose `id`.

## Field-level decisions

- **Catalog**: product cards carry `price: {min,max} | null` and `compareAtPrice`. `price` is null for ENQUIRY_ONLY or unpriced
  products, following ADR-011 ("no price shown"). The PDP adds `purchasable: boolean`, computed per viewer
  (RETAIL, or B2B_ONLY for approved B2B), so the UI can pick the CTA without re-implementing the rule. `priceTiers` is
  **optional**: the key is absent unless the viewer is approved B2B. Variants expose `inStock` only, never stock counts, and only
  active variants are returned. `GET /products` also accepts `saleChannel`. `sort` is `newest` by default.
  `GET /search/suggest` returns `{ items: [{ type: product|category, slug, name, image, categorySlug }] }`, with `limit` defaulting
  to 8 (max 20).
- **Cart**: guest carts use an httpOnly cookie `kritex_cart` (`GUEST_CART_COOKIE`). The guest token is not part of the contract.
  Each line has `issue: OUT_OF_STOCK | INSUFFICIENT_STOCK | UNAVAILABLE | NOT_PURCHASABLE | null`, and the cart has `hasIssues`
  and `itemCount`. `POST /cart/items` adds to an existing quantity. `PATCH` sets it, and `0` removes the line. Quantity max is 999
  per line. Every cart mutation returns the full `CartDto`.
- **Checkout**: addresses are always full objects (`addressInputSchema`). The frontend fills them from saved addresses; there is no
  `addressId` shortcut. `gstin` requires `businessName`. `POST /checkout` takes these fields:
  - `email` and `phone`
  - `shippingAddress` and an optional `billingAddress`
  - `gstin?` and `businessName?`
  - `paymentMethod` (defaults to `RAZORPAY`)
  - `notes?` and `saveAddress?`
  - `expectedTotal?`: the server returns 409 `PRICE_CHANGED` if the recomputed total differs.

  It returns `PlacedOrderDto { orderNumber, status, paymentMethod, totals, reservedUntil, razorpay | null, bankTransfer | null }`.
  The `razorpay` block also carries `currency`, `name`, `description` and `prefill` for Checkout.js. The `Idempotency-Key` header
  is documented as required. A 400 `IDEMPOTENCY_KEY_REQUIRED` is the service's job, because Nest pipes don't run on `@Headers`.
  `idempotencyKeySchema` in `common/dto/common.ts` is the format, and `Order.idempotencyKey` exists in the schema.
  `POST /checkout/quote` also returns `interState` and the allowed `paymentMethods`. `POST /checkout/verify` returns
  `{ orderNumber, status, paid }`.

- **Quote accept** (`POST /me/quotes/:number/accept`) needs an address and a payment method, because quotes have no address. It takes
  the same `Idempotency-Key` and returns the same `PlacedOrderDto` as checkout. A user sees quotes created while signed in plus
  quotes whose email matches their verified email. A guest who sent an RFQ must sign up with the same email to accept.
- **Quotes**: `POST /quotes` has a `website` honeypot field, like the enquiry form. A filled honeypot gets a fake 201. The customer
  sees Kritex's message as `responseMessage`, mapped from `Quote.adminNotes`. `quotedTotal` and `lineTotal` are derived. Respond
  takes `{ items[{itemId, quotedUnitPrice, variantId?}], validUntil, message? }`, and re-responding while QUOTED is allowed.
- **Order detail (customer)** contains: `paymentStatus` (latest payment), `timeline` (customer-visible events only), `invoice`
  (`{number, issuedAt} | null`), `quoteNumber`, `reservedUntil`, `canCancel` and `canRequestReturn`. The admin detail adds `id`, `userId`,
  `payments`, `refunds`, the full `events` (with `actor` and `internal`), shipments with Shiprocket ids/label, and `allowedTransitions`.
- **Invoice**: `GET /orders/:number/invoice` returns `{ number, issuedAt, url (signed, short-lived), expiresAt }`. The order owner
  or STAFF/ADMIN may call it. Guests get the invoice by email.
- **Addresses**: `stateCode` is the **2-digit GST state code** (`"27"` = Maharashtra), an enum of current codes in
  `common/dto/india.ts`. The tax module can compare it with the GSTIN prefix and the seller state. `state` is the display name.
  `pincode` is `/^[1-9]\d{5}$/`. `phone` is an Indian mobile `/^(?:\+91)?[6-9]\d{9}$/` with no spaces, so the frontend must
  normalise it. `country` is the literal `'IN'` (Q5).
- **GSTIN** is trimmed, upper-cased and checked against `/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/`. Checksum and state-code
  match are left to TaxService (PR-1).
- **Coupons**: `value` is a whole percent (1–100) for PERCENT, paise for FLAT, and 0 for FREE_SHIPPING. Codes are upper-cased with the pattern
  `[A-Z0-9_-]{3,32}`.
- **Dashboard** contains:
  - `revenue {today, last7Days}` (paid orders; "today" starts at 00:00 IST)
  - `orders {today, last7Days, byStatus[{status, count}]}`
  - `lowStock[]` (max 20)
  - `pendingQuotes`, `newEnquiries`, `pendingBusinessProfiles` and `awaitingPaymentOrders`

## Alignment with the Prisma schema (merged from `server-db`, 1201d3f)

Enum values match Prisma except for the following. **Schema follow-ups for server-db (or the owning agent):**

1. **`OrderStatus.AWAITING_PAYMENT`** is in the contract (bank transfer / PO, per the brief) but **not in the Prisma enum**. A
   migration must add it before B2B-4. Until then, no route can return it.
2. **`PaymentMethod`**: Prisma has `RAZORPAY | COD | BANK_TRANSFER`. Responses use the full enum (`paymentMethodSchema`, including COD).
   Request bodies (checkout, quote accept) use `checkoutPaymentMethodSchema = RAZORPAY | BANK_TRANSFER`, because there is no COD at
   launch (Q4). Enabling COD later only widens the request enum, which is additive.
3. **`ShipmentStatus`** follows Prisma: `PENDING | READY_TO_SHIP | SHIPPED | IN_TRANSIT | OUT_FOR_DELIVERY | DELIVERED | RTO | CANCELLED`.
   `Shipment.carrier` is nullable in Prisma, so it is nullable in the DTO.
4. Fields in the contract with **no column yet**. Each is nullable or derived, so stubs and early implementations can return null:
   - `BusinessProfile.rejectionReason`: add a column. The DTO's `reviewedAt`/`reviewedBy` map to `approvedAt`/`approvedBy`; consider
     renaming those columns to `reviewedAt`/`reviewedById`, since rejects set them too.
   - `Quote.respondedAt`: add a column, or derive it from the `quote.responded` time.
   - `Shipment.labelUrl`: add a column, or fetch it from Shiprocket on demand. `manual` is derived from `shiprocketOrderId == null`.
   - `Payment.reference` (UTR/PO for bank transfers): store it in `providerPaymentId`, or add a column.
   - `OrderEvent.internal`: add a boolean, or derive it from `type` (e.g. `NOTE_INTERNAL`).
   - `User.disabled`: the Better Auth admin plugin's `banned` column (AUTH-1).
5. Columns deliberately **left out** of the contract: `Coupon.description` (no column, so it was removed from the DTO),
   `User.lastSignInAt`, `Product.sortOrder` and `Variant.sortOrder`. All of these can be added later.
6. `Refund.reason` is nullable in Prisma and in the DTO. The admin refund request still requires a reason.

## Follow-ups / open points

- **Payment retry.** No endpoint retries payment for an existing `PENDING_PAYMENT` order, for example after the Razorpay modal is
  closed and the page reloaded. The frontend can reuse `razorpay.orderId` while the page is open. Consider
  `POST /me/orders/:number/pay`, plus a guest equivalent keyed by email.
- **Webhooks** use `@Body() payload: unknown` (Shiprocket) or `@Req() rawBody` (Razorpay) with no zod parsing. The OpenAPI body is
  `{ type: object, additionalProperties: true }`, and the response is `{ received: true }`. Razorpay must verify
  `x-razorpay-signature` over `req.rawBody`, and deduplicate on `x-razorpay-event-id` / `providerPaymentId`. Shiprocket must check
  the `x-api-key` token, which is already redacted in logs.
- **Throttles** are already declared: checkout 10/min, verify 20/min, quotes 5/min, quote accept 10/min, tracking 20/min. AUTH-1
  adds the auth throttles.
- **Response types**: services return `Promise<XxxDto>`. Implementers map Prisma rows to the DTO shapes: ISO dates,
  `Decimal` → number, and JSON columns validated.
