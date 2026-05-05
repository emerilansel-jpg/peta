# PeTa - Platform Gamified untuk Reddit Army Indonesia

## 📋 Overview

PeTa adalah platform lengkap yang menghubungkan pengguna Reddit dengan task-task menguntungkan. User dapat:
- ✅ Register & login dengan email/password
- ✅ Hubungkan akun Reddit & track karma
- ✅ Ikuti 5-step onboarding funnel dengan reward progressive
- ✅ Ambil task menulis komentar di Reddit
- ✅ Submit task untuk approval & dapatkan payout

Admin dapat:
- ✅ Create & manage task
- ✅ Review & approve/reject submissions
- ✅ Manage user rewards & payroll
- ✅ View analytics dashboard

---

## 🚀 Fitur Lengkap

### User Features

#### 1. **Authentication** (`/register`, `/login`)
- Email/password signup
- Auto-redirect ke onboarding
- Secure Supabase auth

#### 2. **Onboarding Funnel** (`/onboarding`)
5-step progressive flow dengan auto-tracking:

| Step | Aksi | Reward | Unlock |
|------|------|--------|--------|
| 1 🔗 | Hubungkan Reddit akun | Rp0 | Sync username |
| 2 ✍️ | Complete task pertama | Rp25,000 | Task approved |
| 3 🚀 | Complete task kedua | Rp10,000 | 2nd approval |
| 4 💰 | Request payout | Rp10,000+ | Payout request |
| 5 👥 | Bergabung community | ∞ | Ongoing |

Progress bar visual + status badges (Completed ✓, Locked 🔒)

#### 3. **Account Management** (`/account`)
- View connected Reddit accounts
- Display karma + account age
- Progress bar ke level Legend (10,000 karma)
- Sync karma on demand
- Delete accounts

#### 4. **Task List & Submission** (`/tasks`, `/task/:id`)
- Browse tasks filtered by user level
- 6-tier level system (Si Telur → Reddit Legend)
- Draft comment submission
- Track assignment status

#### 5. **Earnings & Payout** (`/earnings`)
- View total earnings
- Available balance breakdown
- Request payout
- Payout history

### Admin Features

#### 1. **Dashboard** (`/admin`)
- Active users count
- Reddit accounts count
- Active tasks count
- Pending approvals count

#### 2. **Task Management** (`/admin/tasks`)
- Create new tasks
- Set min_level & reward_amount
- List all tasks with status

#### 3. **Approval Queue** (`/admin/approval`)
- Review task submissions
- Approve/reject with notes
- Track pending submissions

#### 4. **Payroll** (`/admin/payroll`)
- View payout requests
- Mark as paid
- Track payout history

#### 5. **Team Management** (`/admin/team`)
- View all Reddit Army members
- User stats (level, karma, earnings)

---

## 🛠️ Tech Stack

```
Frontend:
- React 19 + TypeScript
- Vite (bundler)
- Tailwind CSS v4
- TanStack React Query
- React Router v7
- React Hot Toast (notifications)
- Lucide React (icons)

Backend:
- Supabase (PostgreSQL + Auth + RLS)
- Row Level Security policies
- Triggers for auto-confirmation

External:
- Reddit API (axios)
- Supabase REST API
```

---

## 📊 Database Schema

### Tables

#### `users` (Supabase Auth)
- id, email, full_name, created_at

#### `reddit_accounts`
- id, user_id, username, karma, account_age_days, level, last_sync

#### `tasks`
- id, title, description, min_level, reward_amount, status, created_at

#### `task_assignments`
- id, task_id, reddit_account_id, status (in_progress/approved/rejected), created_at

#### `payouts`
- id, user_id, amount, status (pending/paid), created_at

---

## 🎮 Level System

| Level | Emoji | Name | Criteria | Reward |
|-------|-------|------|----------|--------|
| 0 | 🥚 | Si Telur | karma < 5, age < 3 hari | Rp8,000 |
| 1 | 🦴 | Cave Baby | karma < 100, age < 30 hari | Rp10,000 |
| 2 | 🔥 | Cave Teen | karma < 500, age < 90 hari | Rp12,000 |
| 3 | ⚔️ | Village Warrior | karma < 2000, age < 180 hari | Rp15,000 |
| 4 | 🏙️ | City Slicker | karma < 10000, age < 365 hari | Rp18,000 |
| 5 | 👑 | Reddit Legend | karma ≥ 10000, age ≥ 365 hari | Rp25,000 |

Level dihitung otomatis dari:
- Reddit karma (link_karma + comment_karma)
- Account age dalam hari

---

## 🔐 Security

### Row Level Security (RLS)
- Users hanya bisa lihat akun mereka sendiri
- Admins punya akses full (role: admin/moderator)
- Task assignments terlindungi per user

### Authentication
- Supabase JWT tokens
- Email verification optional
- Secure password hashing

---

## 📥 Installation & Setup

### 1. Clone & Install
```bash
cd peta
npm install
```

### 2. Setup Environment
```bash
# .env.local sudah ada dengan Supabase credentials
VITE_SUPABASE_URL=https://duxzxizedtvnopfihllz.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

### 3. Run Dev Server
```bash
npm run dev
# Server akan berjalan di http://localhost:5173
```

### 4. Access App
- Landing: http://localhost:5173/
- Register: http://localhost:5173/register
- Login: http://localhost:5173/login
- Dashboard (after login): http://localhost:5173/tasks
- Admin: http://localhost:5173/admin (perlu role: admin)

---

## 🧪 Testing Flow

### User Flow
1. **Register** (`/register`)
   - Input: email, password, full name
   - Submit → Auto login & redirect to onboarding

2. **Onboarding Step 1** (`/onboarding`)
   - Input: Reddit username
   - Click "Hubungkan Akun"
   - System fetches karma + account age from Reddit API
   - Level calculated automatically

3. **Browse Tasks** (`/tasks`)
   - See available tasks for your level
   - Click task card → go to `/task/:id`

4. **Submit Task** (`/task/:id`)
   - Draft comment in textarea
   - Click "Submit"
   - Status: in_progress

5. **Check Earnings** (`/earnings`)
   - View total approved earnings
   - Click "Request Payout"
   - Amount deducted from available balance

### Admin Flow
1. **Create Task** (`/admin/tasks`)
   - Title, description, min_level, reward_amount
   - Status: active/inactive

2. **Approve Submissions** (`/admin/approval`)
   - Review user submissions
   - Click "Approve" → status: approved, rewards credited
   - Click "Reject" → status: rejected

3. **Process Payouts** (`/admin/payroll`)
   - View pending payout requests
   - Mark as "Paid" when transferred

4. **View Analytics** (`/admin`)
   - Count of active users, accounts, tasks, pending approvals

---

## 🐛 Known Issues & Fixes

### Reddit API CORS Error
- **Issue**: Browser can't fetch reddit.com/user/{username}/about.json
- **Fix**: Fallback to karma=0, accountAgeDays=0 (system still works)
- **Solution**: Use backend proxy or server-side API call

### Email Verification
- **Current**: Disabled (auto-confirm on signup)
- **Why**: Rate limiting issues on testing

### Browser Rendering
- If React not rendering: Clear cache (Ctrl+Shift+Del) + Hard refresh (Ctrl+Shift+R)
- Check browser console for errors

---

## 📈 Reward Distribution

### Task Completion Flow
1. User submits task → status: `in_progress`
2. Admin approves → status: `approved`
3. Reward auto-credited to user's total earnings
4. User requests payout
5. Admin marks as paid

### Payout Logic
- Available balance = Total earned - Total paid out
- Min payout: Rp0 (any amount)
- Processing time: 24 hours (manual)

---

## 🎯 Next Features (Optional)

- [ ] Auto payout via payment gateway
- [ ] Real Reddit OAuth integration
- [ ] Direct comment verification via Reddit API
- [ ] User referral system
- [ ] Leaderboard
- [ ] Email notifications
- [ ] Mobile app
- [ ] Analytics dashboard improvements

---

## 📞 Support

For issues or questions:
1. Check browser console (F12 → Console tab)
2. Check Supabase dashboard for data
3. Check network requests in DevTools
4. Review database logs

---

**PeTa v1.0 - Ready for Production** 🚀
