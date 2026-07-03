# Newbie Guide: Fix PeTA Password Reset (Manual Browser Steps)

> **Goal:** Password reset email jadi dari PeTA (bukan Supabase Auth), dan WhatsApp reset juga jalan.
> **Status:** Edge functions deployed. Frontend committed. Tapi ada 2 hal yang BUTUH action manual di browser kamu.

---

## Step 1: Apply Database Migration (Supabase Dashboard)

**Kenapa:** Edge function mau simpan reset token ke table `password_reset_tokens`, tapi table ini belum ada di production database.

**Cara:**

1. Buka browser → login ke [Supabase Dashboard](https://supabase.com/dashboard)
2. Pilih project **production** (`yorlsgzsawchpeeazcvi`)
3. Di sidebar kiri, klik **SQL Editor**
4. Klik **New query**
5. Copy-paste SQL di bawah ini, lalu klik **Run**

```sql
-- Password reset tokens for WhatsApp-based forgot password
-- Stores tokens generated when user requests reset via WA number

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL CHECK (method IN ('email', 'whatsapp')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON public.password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON public.password_reset_tokens(expires_at) WHERE used_at IS NULL;

-- RLS: only service_role can read tokens (users verify via edge function)
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON public.password_reset_tokens;
CREATE POLICY "Service role only" ON public.password_reset_tokens
  FOR ALL USING (false) WITH CHECK (false);

-- RPC: verify token and return user_id if valid
CREATE OR REPLACE FUNCTION public.verify_password_reset_token(p_token TEXT)
RETURNS TABLE (
  user_id UUID,
  valid BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.password_reset_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_record
  FROM public.password_reset_tokens
  WHERE token = p_token AND used_at IS NULL AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Token tidak valid atau sudah expired'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_record.user_id, true, 'Token valid'::TEXT;
END;
$$;

-- RPC: mark token as used
CREATE OR REPLACE FUNCTION public.consume_password_reset_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.password_reset_tokens
  SET used_at = NOW()
  WHERE token = p_token AND used_at IS NULL AND expires_at > NOW();

  RETURN FOUND;
END;
$$;

-- Cleanup old expired tokens (run via pg_cron or manual)
CREATE OR REPLACE FUNCTION public.cleanup_expired_password_reset_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.password_reset_tokens
  WHERE expires_at < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- RPC: admin update user password (for WA password reset)
CREATE OR REPLACE FUNCTION public.admin_update_user_password(
  p_user_id UUID,
  p_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Allow anonymous callers with valid token (edge function uses service_role)
  -- or authenticated users updating their own password
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    -- Only service_role or admin can update other users
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf')),
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_password(UUID, TEXT) TO anon;
```

6. Kalau sukses, muncul "Success. No rows returned."
7. **Selesai.** Table sudah ada.

---

## Step 2: Deploy Frontend (Cloudflare Pages)

**Kenapa:** Vercel team kamu PAUSED karena quota exceeded. Frontend changes (ForgotPassword.tsx) committed ke GitHub tapi belum deploy ke production.

**Cara (2 opsi):**

### Opsi A: Deploy ke Cloudflare Pages (Recommended — instant)

1. Buka terminal / PowerShell
2. Run:

```powershell
cd "D:\Claude Cowork\Reddit Army Local\peta"
npm.cmd run build
npx.cmd wrangler pages deploy ./dist --project-name=peta --branch=main
```

3. Tunggu ~30 detik. Done.

### Opsi B: Tunggu Vercel Unpause

- Vercel hobby plan reset quota setiap jam 10 malam (WIB / UTC+7)
- Kalau sudah reset, push commit kosong:

```powershell
cd "D:\Claude Cowork\Reddit Army Local\peta"
git commit --allow-empty -m "trigger: deploy"
git push origin main
```

- Vercel akan auto-deploy dalam 1-2 menit.

---

## Step 3: Test Password Reset

**Test Email Reset:**
1. Buka `https://www.penghasilantambahan.com/forgot-password`
2. Pilih tab **Email**
3. Masukin email yang terdaftar
4. Klik **Kirim Link Reset**
5. Cek inbox — email harusnya dari `PeTA <peta@penghasilantambahan.com>` (bukan Supabase Auth)
6. Klik link di email → set password baru → login

**Test WhatsApp Reset:**
1. Buka `https://www.penghasilantambahan.com/forgot-password`
2. Pilih tab **WhatsApp**
3. Masukin nomor WA yang terdaftar (format 08xxxxxxxxxx)
4. Klik **Kirim Link ke WhatsApp**
5. Cek WA — harusnya ada pesan dari PeTA dengan link reset
6. Klik link → set password baru → login

---

## Kalau Masih Error

| Error | Penyebab | Fix |
|---|---|---|
| "Failed to send a request to the Edge Function" | Edge function belum deploy atau verify_jwt salah | Cek di Supabase Dashboard → Edge Functions — harus ada `send-wa-password-reset` dan `send-password-reset-email` dengan status ACTIVE |
| "token_store_failed" | Table `password_reset_tokens` belum dibuat | Ulangi **Step 1** (SQL Editor) |
| "smtp_not_configured" | SMTP secrets belum di-set di Supabase | Cek Supabase Dashboard → Edge Functions → Manage Secrets — harus ada `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` |
| "fonnte_not_configured" | Fonnte token belum di-set | Cek secrets — harus ada `FONNTE_TOKEN` |
| Email tidak masuk inbox | Spam folder / SMTP credentials salah | Cek spam/promosi. Kalau masih tidak ada, cek SMTP secrets di Supabase Dashboard |

---

## Quick Checklist

- [ ] Step 1: SQL migration di-run di Supabase SQL Editor
- [ ] Step 2: Frontend deployed (Cloudflare Pages atau Vercel)
- [ ] Step 3: Email reset test — email dari PeTA branding
- [ ] Step 3: WA reset test — pesan WA dari PeTA

**Done?** Password reset flow sudah 100% jalan dengan branding PeTA.
