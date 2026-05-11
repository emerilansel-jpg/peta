# Reddit Upvotes Feature

Credit-based system for Reddit upvote orders. Users top-up credits via admin approval, then spend credits ordering upvotes for Reddit threads.

## Database Schema

**New tables:**
- `credit_transactions` — ledger of credit changes (topup, spend, adjust, refund)
- `reddit_upvote_orders` — user orders for upvotes (pending/processing/completed/cancelled)
- `reddit_topup_requests` — user requests to add credits (pending/approved/rejected)

**Changes to existing tables:**
- `users`: added `credit_balance` column (INTEGER, default 0)

## Routes

### User Routes
- `/reddit` — Landing page (public)
- `/reddit/dashboard` — Dashboard home (protected)
- `/reddit/new-order` — Create new upvote order (protected)
- `/reddit/orders` — View order history (protected)
- `/reddit/topup` — Request credit top-up (protected)

### Admin Routes
- `/reddit/admin` — Manage pending topups & orders (admin-only)

## Flow

### User: Top-Up Credits
1. User goes to `/reddit/topup`
2. Submits amount + payment method
3. Creates `reddit_topup_requests` row with `status='pending'`
4. Admin reviews and approves via `/reddit/admin`
5. Approval RPC `fn_admin_approve_topup()` inserts `credit_transactions` and updates `users.credit_balance`

### User: Order Upvotes
1. User goes to `/reddit/new-order`
2. Enters thread URL, subreddit, # upvotes
3. Total cost calculated: `requested_upvotes * 10 credits`
4. On submit: calls RPC `fn_create_reddit_upvote_order()`
5. RPC atomically:
   - Checks if balance >= cost
   - Creates `reddit_upvote_orders` row with `status='pending'`
   - Inserts `credit_transactions` row with negative amount (spend)
   - Updates `users.credit_balance`

### Admin: Process Orders
1. Admin goes to `/reddit/admin` → "Orders Pending" tab
2. Reviews thread URL and requested upvotes
3. Can mark order as:
   - `processing` — admin is working on it
   - `completed` — upvotes delivered
   - `cancelled` — order is cancelled

## API Functions

**Client-side (`src/modules/reddit/lib/api.ts`):**
- `getCreditsBalance()` — fetch user's current balance
- `getCreditsHistory(limit)` — fetch transaction history
- `getRedditOrders()` — fetch user's orders
- `createRedditOrder(threadUrl, subreddit, upvotes, notes)` — RPC call
- `getTopupRequests()` — fetch user's topup requests
- `createTopupRequest(amount, paymentMethod, proofUrl)` — create request
- Admin functions: `getAdminPendingTopups()`, `adminApproveTopup()`, `adminRejectTopup()`, `getAdminPendingOrders()`, `adminUpdateOrderStatus()`

**Server-side RPCs:**
- `fn_create_reddit_upvote_order()` — atomic order creation + credit deduction
- `fn_admin_approve_topup()` — approve topup + add credits
- `fn_admin_reject_topup()` — reject topup + save reason

## Deployment

### 1. Apply Migration
```bash
cd peta
supabase db push  # or push to specific project
```

Alternatively, manually run the migration SQL on your Supabase project.

### 2. Environment Variables
No new env vars needed. Uses existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

### 3. Vercel Deployment
Standard build process:
```bash
npm run build
```

No special configuration needed.

## Testing Locally

1. Ensure Supabase project is linked
2. Apply migration
3. Start dev server
4. Test user flow: `/reddit` → `/reddit/dashboard` → `/reddit/topup` → `/reddit/new-order` → `/reddit/orders`
5. Test admin flow: `/reddit/admin` (requires `role='admin'`)

## Future Enhancements (Launching Soon)

- `Comments` — post comments to Reddit threads
- `Threads` — create new threads in subreddits
- Proof upload for topup requests (file storage integration)
- Refund system for cancelled orders
- Credit expiry policy
- Analytics dashboard (admin view of credit spend by user)

## Security

- All endpoints protected by RLS policies
- RPC functions use SECURITY DEFINER to bypass RLS for authorized operations
- Only authenticated users can create orders and topup requests
- Only admins can approve topups and manage orders
- Credit balance mutations only via RPC (cannot be updated directly via API)
