import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/Toast';

// Pages
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Onboarding } from './pages/Onboarding';
import { Tasks } from './pages/Tasks';
import { TaskDetail } from './pages/TaskDetail';
import { KarmaMission } from './pages/KarmaMission';
import { Account } from './pages/Account';
import { Earnings } from './pages/Earnings';

// Reddit Upvotes Pages
import { RedditLanding } from './modules/reddit/pages/RedditLanding';
import { RedditDashboard } from './modules/reddit/pages/RedditDashboard';
import { RedditNewOrder } from './modules/reddit/pages/RedditNewOrder';
import { RedditOrders } from './modules/reddit/pages/RedditOrders';
import { RedditTopup } from './modules/reddit/pages/RedditTopup';
import { RedditAdmin } from './modules/reddit/pages/RedditAdmin';

// Admin Pages
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminRedditAccounts } from './pages/admin/RedditAccounts';
import { AdminTaskQueue } from './pages/admin/TaskQueue';
import { AdminApprovalQueue } from './pages/admin/ApprovalQueue';
import { AdminTeam } from './pages/admin/Team';
import { AdminPayroll } from './pages/admin/Payroll';
import { AdminGuard } from './components/AdminGuard';

import './App.css';
import './index.css';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider />
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/onboarding" element={<Onboarding />} />

          {/* Army Routes */}
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/task/:taskId" element={<TaskDetail />} />
          <Route path="/karma-mission" element={<KarmaMission />} />
          <Route path="/account" element={<Account />} />
          <Route path="/earnings" element={<Earnings />} />

          {/* Reddit Upvotes Routes */}
          <Route path="/reddit" element={<RedditLanding />} />
          <Route path="/reddit/dashboard" element={<RedditDashboard />} />
          <Route path="/reddit/new-order" element={<RedditNewOrder />} />
          <Route path="/reddit/orders" element={<RedditOrders />} />
          <Route path="/reddit/topup" element={<RedditTopup />} />
          <Route path="/reddit/admin" element={<AdminGuard><RedditAdmin /></AdminGuard>} />

          {/* Admin Routes (guarded) */}
          <Route path="/admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
          <Route path="/admin/accounts" element={<AdminGuard><AdminRedditAccounts /></AdminGuard>} />
          <Route path="/admin/tasks" element={<AdminGuard><AdminTaskQueue /></AdminGuard>} />
          <Route path="/admin/approval" element={<AdminGuard><AdminApprovalQueue /></AdminGuard>} />
          <Route path="/admin/team" element={<AdminGuard><AdminTeam /></AdminGuard>} />
          <Route path="/admin/payroll" element={<AdminGuard><AdminPayroll /></AdminGuard>} />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
