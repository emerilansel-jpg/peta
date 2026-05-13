import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
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
import { RedditOrderDetail } from './modules/reddit/pages/RedditOrderDetail';
import { RedditTopup } from './modules/reddit/pages/RedditTopup';
import { RedditSignup } from './modules/reddit/pages/RedditSignup';
import { RedditLogin } from './modules/reddit/pages/RedditLogin';
import { RedditReviews } from './modules/reddit/pages/RedditReviews';
import { RedditFeatureRequests } from './modules/reddit/pages/RedditFeatureRequests';
import { AdminOverview } from './modules/reddit/pages/admin/AdminOverview';
import { AdminOrders as RedditAdminOrders } from './modules/reddit/pages/admin/AdminOrders';
import { AdminTickets as RedditAdminTickets } from './modules/reddit/pages/admin/AdminTickets';
import { AdminClients as RedditAdminClients } from './modules/reddit/pages/admin/AdminClients';
import { AdminFinance as RedditAdminFinance } from './modules/reddit/pages/admin/AdminFinance';
import { AdminReviews as RedditAdminReviews } from './modules/reddit/pages/admin/AdminReviews';
import { AdminFeatureRequests as RedditAdminFeatureRequests } from './modules/reddit/pages/admin/AdminFeatureRequests';

// Admin Pages
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminRedditAccounts } from './pages/admin/RedditAccounts';
import { AdminTaskQueue } from './pages/admin/TaskQueue';
import { AdminApprovalQueue } from './pages/admin/ApprovalQueue';
import { AdminTeam } from './pages/admin/Team';
import { AdminPayroll } from './pages/admin/Payroll';
import { AdminBroadcast } from './pages/admin/Broadcast';
import { AdminGuard } from './components/AdminGuard';

import './App.css';
import './index.css';

const queryClient = new QueryClient();

// Hostname-based home redirect.
// straight.ltd is the Straight Ltd product → / should go to /reddit.
// penghasilantambahan.com (and localhost) → / stays at PeTa landing.
function HostnameHomeRouter() {
  const location = useLocation();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = window.location.hostname;
    if (location.pathname === '/' && /(^|\.)straight\.ltd$/i.test(host)) {
      window.location.replace('/reddit');
    }
  }, [location.pathname]);
  return null;
}

function HomePage() {
  if (typeof window !== 'undefined' && /(^|\.)straight\.ltd$/i.test(window.location.hostname)) {
    return <Navigate to="/reddit" replace />;
  }
  return <Landing />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider />
      <BrowserRouter>
        <HostnameHomeRouter />
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<HomePage />} />
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
          <Route path="/reddit/signup" element={<RedditSignup />} />
          <Route path="/reddit/login" element={<RedditLogin />} />
          <Route path="/reddit/dashboard" element={<RedditDashboard />} />
          <Route path="/reddit/new-order" element={<RedditNewOrder />} />
          <Route path="/reddit/orders" element={<RedditOrders />} />
          <Route path="/reddit/orders/:orderId" element={<RedditOrderDetail />} />
          <Route path="/reddit/topup" element={<RedditTopup />} />
          <Route path="/reddit/reviews" element={<RedditReviews />} />
          <Route path="/reddit/feature-requests" element={<RedditFeatureRequests />} />
          {/* Reddit Admin Routes */}
          <Route path="/reddit/admin" element={<AdminGuard><AdminOverview /></AdminGuard>} />
          <Route path="/reddit/admin/orders" element={<AdminGuard><RedditAdminOrders /></AdminGuard>} />
          <Route path="/reddit/admin/tickets" element={<AdminGuard><RedditAdminTickets /></AdminGuard>} />
          <Route path="/reddit/admin/tickets/:ticketId" element={<AdminGuard><RedditAdminTickets /></AdminGuard>} />
          <Route path="/reddit/admin/clients" element={<AdminGuard><RedditAdminClients /></AdminGuard>} />
          <Route path="/reddit/admin/clients/:userId" element={<AdminGuard><RedditAdminClients /></AdminGuard>} />
          <Route path="/reddit/admin/reviews" element={<AdminGuard><RedditAdminReviews /></AdminGuard>} />
          <Route path="/reddit/admin/feature-requests" element={<AdminGuard><RedditAdminFeatureRequests /></AdminGuard>} />
          <Route path="/reddit/admin/finance" element={<AdminGuard><RedditAdminFinance /></AdminGuard>} />

          {/* Admin Routes (guarded) */}
          <Route path="/admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
          <Route path="/admin/accounts" element={<AdminGuard><AdminRedditAccounts /></AdminGuard>} />
          <Route path="/admin/tasks" element={<AdminGuard><AdminTaskQueue /></AdminGuard>} />
          <Route path="/admin/approval" element={<AdminGuard><AdminApprovalQueue /></AdminGuard>} />
          <Route path="/admin/team" element={<AdminGuard><AdminTeam /></AdminGuard>} />
          <Route path="/admin/payroll" element={<AdminGuard><AdminPayroll /></AdminGuard>} />
          <Route path="/admin/broadcast" element={<AdminGuard><AdminBroadcast /></AdminGuard>} />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
