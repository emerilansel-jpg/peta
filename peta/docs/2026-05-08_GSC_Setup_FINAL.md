# Google Search Console — Setup Guide (5 menit)

## Why
Tanpa GSC, Google butuh ~2-6 minggu nge-discover situs. Dengan GSC, kamu submit sitemap manually + Google crawl dalam ~24-72 jam. Plus metrics: keyword ranking, click-through rate, core web vitals, indexing errors.

## Steps

### 1. Login & add property
1. Buka https://search.google.com/search-console (login pakai `n311311@gmail.com`)
2. Klik **Add property** → pilih **URL prefix**
3. Masukkan: `https://penghasilantambahan.com/` (lengkap dengan https + trailing slash)

### 2. Verify ownership — pilih HTML tag

GSC kasih kamu meta tag mirip ini:
```html
<meta name="google-site-verification" content="ABC123_TOKEN_DARI_GSC" />
```

**Copy `content` value-nya** (string panjang setelah `content=`).

### 3. Paste token ke saya
Reply chat dengan token-nya:
> "GSC token: ABC123_TOKEN_DARI_GSC"

Saya akan:
- Edit `index.html`, uncomment + paste token
- Build + push prod
- ~90 detik later → ke GSC, klik **Verify** → ✅ verified

### 4. Submit sitemap (setelah verified)
Di GSC dashboard:
1. Sidebar → **Sitemaps**
2. Add new sitemap: `sitemap.xml` (relatif, tanpa domain)
3. Submit → Google mulai crawl

### 5. Monitor (ongoing)
Cek 1× per minggu:
- **Performance** → traffic dari "Penghasilan Tambahan" keyword
- **Coverage** → indexing errors
- **Core Web Vitals** → page speed metrics

---

## Why HTML meta vs DNS verification

| Method | Setup time | Bisa di-revoke? | Recommend |
|---|---|---|---|
| HTML meta tag | 30 detik (paste + redeploy) | Ya, hapus tag → re-verify | ✅ Best for kita |
| DNS TXT record | 5 menit (Spaceship.com DNS) | Ya, hapus TXT | Pakai kalau gak bisa redeploy |
| HTML file upload | 1 menit | Ya, hapus file | Backup option |
| Google Analytics | requires GA setup | Ya | Skip — kita belum pasang GA |

Choose: **HTML meta tag** karena infra kita Vercel + automated deploy.
