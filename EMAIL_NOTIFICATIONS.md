# Email Notifications Setup

The edge function code is already written ([peta/supabase/functions/send-notification-email/index.ts](peta/supabase/functions/send-notification-email/index.ts)). You just need to:

1. Get a Resend API key
2. Set it as a Supabase secret
3. Deploy the function
4. Run one SQL migration to enable the trigger

Total time: ~5 minutes.

---

## Step 1: Get Resend API key

1. Sign up: https://resend.com/signup (free tier: 3,000 emails/month, 100/day)
2. Verify your email
3. Either:
   - Use their test domain `onboarding@resend.dev` for now (only sends to your own verified email)
   - OR add your own domain (e.g. `redditboost.pro`) under Domains → Add Domain, follow DNS instructions, wait for verification
4. Go to API Keys → Create API Key → Copy the `re_xxx...` key

## Step 2: Set secrets in Supabase

```bash
cd peta
supabase login   # if not already
supabase link --project-ref duxzxizedtvnopfihllz
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxx
supabase secrets set EMAIL_FROM="RedditBoost <noreply@yourdomain.com>"
```

If using their test domain instead:
```bash
supabase secrets set EMAIL_FROM="RedditBoost <onboarding@resend.dev>"
```

## Step 3: Deploy the function

```bash
supabase functions deploy send-notification-email --project-ref duxzxizedtvnopfihllz
```

You should see "Deployed Function: send-notification-email".

Test it:
```bash
curl -X POST https://duxzxizedtvnopfihllz.supabase.co/functions/v1/send-notification-email \
  -H "Authorization: Bearer <your-anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"to":"your@email.com","subject":"Test","body":"Hello from RedditBoost","type":"message"}'
```

## Step 4: Enable the DB trigger

This SQL adds the trigger that auto-invokes the function when notifications are created. Run it via Supabase SQL editor:

```sql
-- Enable pg_net for outbound HTTP from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Trigger to invoke email function on new user-facing notifications
CREATE OR REPLACE FUNCTION public.fn_send_email_on_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_user_email TEXT;
  v_function_url TEXT := 'https://duxzxizedtvnopfihllz.supabase.co/functions/v1/send-notification-email';
  v_anon_key TEXT := '<paste-your-anon-key-here>';
BEGIN
  -- Only send for user-facing notifications (skip admin notifs)
  IF NEW.target_role != 'user' THEN RETURN NEW; END IF;

  SELECT email INTO v_user_email FROM public.users WHERE id = NEW.user_id;
  IF v_user_email IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := v_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := jsonb_build_object(
      'to', v_user_email,
      'subject', NEW.title,
      'body', COALESCE(NEW.body, ''),
      'type', NEW.type,
      'link', NEW.link
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_send_email_on_notification ON public.notifications;
CREATE TRIGGER trg_send_email_on_notification AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE PROCEDURE public.fn_send_email_on_notification();
```

**Replace `<paste-your-anon-key-here>`** with your Supabase anon key (find it in [API settings](https://supabase.com/dashboard/project/duxzxizedtvnopfihllz/settings/api)).

After running this, every new notification in `public.notifications` (target_role='user') triggers an email.

## Test the full pipeline

1. Login as admin → send a message to client y3s@gmx.com
2. Check inbox at y3s@gmx.com (might be in spam)
3. Open the message → should show the RedditBoost-branded email with "View message" CTA

## Reducing email spam

Some notifications are noisy (e.g. credit changes on every order). To filter:

```sql
-- Only send emails for high-value events
CREATE OR REPLACE FUNCTION public.fn_send_email_on_notification()
...
IF NEW.type NOT IN ('message', 'order_status') THEN RETURN NEW; END IF;
...
```

This skips credit/payment/review notifs and only emails on messages + order status changes.

## Status of what I (Claude) could do for you

| Task | Did I do it? | Why |
|---|---|---|
| Wrote the edge function code | ✅ Yes | [peta/supabase/functions/send-notification-email/index.ts](peta/supabase/functions/send-notification-email/index.ts) |
| Wrote the DB trigger SQL | ✅ Yes | Above |
| Sign up to Resend on your behalf | ❌ No | Safety: I can't create accounts for you |
| Set RESEND_API_KEY secret | ❌ No | Needs your API key |
| Deploy the function | ❌ No | Needs Supabase CLI login (yours) |
| Add anon key to trigger SQL | ❌ No | You paste before running |

Steps 1-4 above are 3-5 minutes if you do them now. After that, emails just work automatically for every notification.
