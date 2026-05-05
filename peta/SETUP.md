# PeTa Setup Guide

## ✅ Project Created Successfully!

Your complete PeTa (Penghasilan Tambahan) web app is ready to go!

### 🚀 Quick Start

The dev server is already running at **http://localhost:5173**

### 📋 Next Steps

1. **Set up Supabase Project**
   - Create a new project at [supabase.com](https://supabase.com)
   - Go to SQL Editor and paste the contents of `supabase/schema.sql` to create database tables
   - Copy your Supabase URL and Anon Key

2. **Update Environment Variables**
   - Edit `.env.local` with your Supabase credentials:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. **Enable Auth in Supabase**
   - Go to Authentication > Settings
   - Configure email/password authentication
   - Add redirect URLs: `http://localhost:5173/tasks`

4. **Create Test Admin Account**
   - In Supabase, insert a user manually with `role: 'admin'`:
   ```sql
   INSERT INTO users (id, email, full_name, role)
   VALUES ('test-admin-id', 'admin@example.com', 'Admin User', 'admin');
   ```

### 📱 App Pages

**User Pages:**
- `/` - Landing page (SEO optimized)
- `/login` - Login page
- `/register` - Registration page
- `/tasks` - Daily tasks list
- `/task/:taskId` - Task detail & submission
- `/account` - Reddit account management
- `/earnings` - Earnings & payout requests

**Admin Pages:**
- `/admin` - Dashboard with stats
- `/admin/accounts` - Reddit accounts monitoring
- `/admin/tasks` - Create & manage tasks
- `/admin/approval` - Task approval queue
- `/admin/team` - Team management
- `/admin/payroll` - Payout management

### 🎮 Level System

- **🥚 Si Telur**: karma < 5, umur < 3 hari → Rp8.000/task
- **🦴 Cave Baby**: karma < 100, umur < 30 hari → Rp10.000/task
- **🔥 Cave Teen**: karma < 500, umur < 90 hari → Rp12.000/task
- **⚔️ Village Warrior**: karma < 2000, umur < 180 hari → Rp15.000/task
- **🏙️ City Slicker**: karma < 10000, umur < 365 hari → Rp18.000/task
- **👑 Reddit Legend**: karma ≥ 10000, umur ≥ 365 hari → Rp25.000/task

### 🛠️ Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS v4
- **Database**: Supabase (PostgreSQL)
- **State Management**: TanStack React Query
- **Routing**: React Router v7
- **Notifications**: react-hot-toast
- **UI Components**: Lucide React Icons

### 📦 Key Features

✅ Gamified level system  
✅ Reddit karma sync integration  
✅ Task assignment & approval workflow  
✅ Payout management system  
✅ Admin dashboard  
✅ Mobile-first responsive design  
✅ PWA support  
✅ RLS policies for data security  
✅ React Query for efficient data fetching  
✅ Toast notifications  

### 🔌 Available Endpoints (Backend)

The app uses Supabase for backend with tables:
- `users` - User accounts
- `reddit_accounts` - Connected Reddit accounts
- `tasks` - Available tasks
- `task_assignments` - User task submissions
- `payouts` - Payout requests
- `activity_logs` - Audit logs

### 📝 Commands

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview build
npm run preview

# Lint code
npm lint
```

### 🔐 Security Features

- Row Level Security (RLS) policies enabled
- Auth-based access control
- User role-based permissions (army/admin)
- Reddit API integration for karma validation

### 🎨 Design System

- Primary Color: `#FF6B6B` (Red)
- Secondary Color: `#4ECDC4` (Teal)
- Dark: `#2D3436`
- Light: `#F5F5F5`

### 📱 Mobile Optimized

All pages are mobile-first and responsive:
- Mobile breakpoint: 768px (md)
- Touch-friendly buttons
- Optimized for Gen-Z aesthetic with emojis

### 🚀 Production Ready

Before deploying:
1. ✅ Set up proper Supabase project
2. ✅ Update environment variables
3. ✅ Configure CORS in Supabase
4. ✅ Enable Row Level Security
5. ✅ Test authentication flow
6. ✅ Set up Reddit API callback
7. ✅ Configure email notifications (optional)

### 📞 Support

For more info about Supabase, visit: https://supabase.com/docs

Enjoy building PeTa! 🚀
