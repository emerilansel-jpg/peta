# PayPal Sandbox Testing Guide

## The PayPal "Log Out" screen you saw

The error you got — "Anda login ke rekening penjual untuk pembelian ini" — happens because you logged in with your **Business/Merchant** sandbox account when checkout requires a **Buyer/Personal** sandbox account.

Sandbox PayPal won't let the merchant pay themselves. You need to log out and use the **Personal** test account.

## Get your sandbox BUYER account

1. Go to https://developer.paypal.com/dashboard/accounts
2. Switch the toggle at top to **Sandbox** (not Live)
3. You'll see two pre-created accounts:
   - `sb-XXX@business.example.com` — **Business** (this is the merchant — DO NOT use this for checkout)
   - `sb-XXX@personal.example.com` — **Personal** (this is the buyer — USE THIS)
4. Click the Personal account row
5. Copy the **email** (sandbox email)
6. Click `...` → **View/Edit Account** → **Profile** tab
7. The **System-Generated Password** is shown (or change it to something you remember)

## Test checkout

1. http://localhost:5173/reddit/topup
2. Pick package → click PayPal yellow button
3. PayPal opens. If it shows you logged-in as business already, click **Log Out**
4. Login with the **Personal** sandbox account (the `@personal.example.com` one)
5. Confirm payment → returns to dashboard with credit added

## URL note

The URL stays `paypal.com` for both sandbox and live. The PayPal JS SDK auto-detects sandbox mode from your Client ID. You don't need to use `sandbox.paypal.com` manually.

## Switch to Live (real payments)

When you're ready to charge real money:

1. Go to https://developer.paypal.com/dashboard/applications
2. Switch top toggle to **Live**
3. Click **Create App** → name "RedditBoost Production" → Type: Merchant
4. Copy the new **Client ID** (different from sandbox)
5. Update `.env.local`:
   ```
   VITE_PAYPAL_CLIENT_ID=<your-LIVE-client-id>
   ```
6. Restart dev server

Sandbox and Live apps are completely separate. No auto-conversion.
