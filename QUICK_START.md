# PeTa - Quick Start Guide

## ⚡ 5 Menit Setup

### Prasyarat
- Node.js 18+
- npm atau yarn
- Modern browser (Chrome, Firefox, Safari)

### Step 1: Install Dependencies
```bash
cd peta
npm install
```

### Step 2: Verify Environment
File `.env.local` sudah ada dengan Supabase credentials:
```
VITE_SUPABASE_URL=https://duxzxizedtvnopfihllz.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 3: Start Dev Server
```bash
npm run dev
```
Output:
```
➜ Local: http://localhost:5173/
```

### Step 4: Open Browser
```
http://localhost:5173/
```

---

## 👤 User Testing Checklist

### 1. Register
- [ ] Navigate to `/register`
- [ ] Input: email, password, full name
- [ ] Click "Daftar"
- [ ] ✅ Redirects to `/onboarding`
- [ ] ✅ Toast: "Registrasi berhasil!"

### 2. Onboarding - Step 1
- [ ] See "🔗 Hubungkan Akun Reddit"
- [ ] Input Reddit username (e.g., "reddit_username")
- [ ] Click "✅ Hubungkan Akun"
- [ ] ✅ Toast: "Akun Reddit berhasil dihubungkan!"
- [ ] ✅ Step progress: 1/5 → 2/5
- [ ] ✅ Button changes to "Lanjut ke Task"

### 3. Browse Tasks
- [ ] Click "Lanjut ke Task" atau navigate to `/tasks`
- [ ] See tasks filtered by user's level
- [ ] Click task card
- [ ] ✅ Navigate to `/task/:id`
- [ ] See task detail, description, reward

### 4. Submit Task
- [ ] Type comment in textarea
- [ ] Click "✅ Submit Task"
- [ ] ✅ Toast: "Task submitted!"
- [ ] ✅ Status changes to "in_progress"
- [ ] ✅ Navigate back to `/tasks`

### 5. Check Onboarding Progress
- [ ] Navigate to `/onboarding`
- [ ] ✅ Step 2 shows "Selesai ✓"
- [ ] ✅ Step 3 now active (unlock)
- [ ] ✅ Progress bar: 2/5

### 6. Earnings
- [ ] Navigate to `/earnings`
- [ ] See "Total Earnings: Rp0" (not approved yet)
- [ ] See "Available Balance: Rp0"
- [ ] See "Request Payout" button disabled

---

## 🛠️ Admin Testing Checklist

### Prerequisites
- Create admin user manually in Supabase
- Set `role: 'admin'` in user metadata

### 1. Admin Dashboard
- [ ] Navigate to `/admin`
- [ ] See stats: Users, Accounts, Tasks, Pending
- [ ] Stats update when new data added

### 2. Create Task
- [ ] Navigate to `/admin/tasks`
- [ ] Click "Buat Task Baru"
- [ ] Input: title, description, min_level (0), reward (10000)
- [ ] Click "✅ Create Task"
- [ ] ✅ Task appears in list
- [ ] ✅ Status: active

### 3. View Submissions
- [ ] Navigate to `/admin/approval`
- [ ] See user submissions (status: in_progress)
- [ ] Click "👁️ View"
- [ ] See submitted comment

### 4. Approve Submission
- [ ] Click "✅ Approve"
- [ ] Status changes to "approved"
- [ ] ✅ Reward credited to user's earnings
- [ ] ✅ Toast: "Task approved!"

### 5. User Earnings Update
- [ ] User checks `/earnings`
- [ ] ✅ Total Earnings: Rp10,000 (reward amount)
- [ ] ✅ Available Balance: Rp10,000

### 6. Request Payout
- [ ] User clicks "Request Payout"
- [ ] Payout request created
- [ ] Status: pending

### 7. Process Payout
- [ ] Admin navigate to `/admin/payroll`
- [ ] See pending payout: Rp10,000
- [ ] Click "✅ Mark as Paid"
- [ ] Status changes to "paid"
- [ ] ✅ Payout deducted from available balance

---

## 🔧 Troubleshooting

### React App Not Loading
**Symptom**: Blank page or "Cannot find module"
**Solution**:
```bash
# Clear cache
rm -rf node_modules/.vite
# Hard refresh browser
Ctrl+Shift+R (Windows/Linux)
Cmd+Shift+R (Mac)
```

### Port Already in Use
**Symptom**: "Port 5173 is already in use"
**Solution**:
```bash
# Kill process on port 5173
# Windows:
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# Mac/Linux:
lsof -ti:5173 | xargs kill -9
```

### Reddit API Error
**Symptom**: "Network Error" when connecting Reddit account
**Why**: Browser can't reach reddit.com (CORS issue)
**Fix**: App still works with fallback (karma=0, age=0)

### Supabase Connection Error
**Symptom**: "Database error" on login
**Check**:
1. `.env.local` has correct credentials
2. Supabase project active
3. Network connection OK

---

## 📦 Build for Production

```bash
npm run build
# Creates dist/ folder with optimized build

# Preview production build locally:
npm run preview
# Open http://localhost:4173/
```

---

## 🚀 Deployment Options

### Option 1: Vercel (Recommended)
```bash
npm install -g vercel
vercel
# Follow prompts, auto-detects Vite setup
```

### Option 2: Netlify
```bash
npm install -g netlify-cli
netlify deploy
# Select dist/ as publish directory
```

### Option 3: Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 5173
CMD ["npm", "run", "preview", "--", "--host"]
```

---

## 📊 Database Management

### View Data in Supabase
1. Go to https://supabase.com
2. Login to your account
3. Select project "duxzxizedtvnopfihllz"
4. View tables in SQL Editor

### Common Queries
```sql
-- See all users
SELECT * FROM users;

-- See all reddit accounts
SELECT * FROM reddit_accounts;

-- See task assignments
SELECT * FROM task_assignments;

-- See payouts
SELECT * FROM payouts;
```

---

## ✅ Final Checklist

- [ ] App installs without errors
- [ ] Dev server starts on port 5173
- [ ] Landing page loads
- [ ] Can register new account
- [ ] Redirects to onboarding
- [ ] Can submit Reddit username
- [ ] Can browse tasks
- [ ] Can submit task
- [ ] Admin can approve task
- [ ] Earnings updated
- [ ] Can request payout
- [ ] Admin can mark as paid
- [ ] Build succeeds: `npm run build`

---

## 🎉 Success!

If all checks pass, **PeTa is production-ready!** 🚀

**Next Steps:**
1. Deploy to production (Vercel/Netlify)
2. Setup custom domain
3. Configure payment gateway for auto-payout
4. Monitor user growth & analytics
5. Iterate based on user feedback

---

**Questions?** Check README_PETA.md for full documentation.
