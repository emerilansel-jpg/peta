import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/Toast';

// Pages
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Onboarding } from './pages/Onboarding';
import { Tasks } from './pages/Tasks';
import { TaskDetail } from './pages/TaskDetail';
import { KarmaMission } from './pages/KarmaMission';
import { Account } from './pages/Account';
import { Earnings } from './pages/Earnings';
import { UpdatePassword } from './pages/UpdatePassword';
import { ResetWhatsApp } from './pages/ResetWhatsApp';

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
import { RankingForumPage } from './modules/reddit/pages/RankingForumPage';
import { WaitlistPage } from './modules/reddit/pages/WaitlistPage';
import { AiVisibilityPage } from './modules/reddit/pages/AiVisibilityPage';
import { TermsPage } from './modules/reddit/pages/TermsPage';
import { PrivacyPage } from './modules/reddit/pages/PrivacyPage';
import { RefundsPage } from './modules/reddit/pages/RefundsPage';
import { ContactPage } from './modules/reddit/pages/ContactPage';
import { RedditForgotPassword } from './modules/reddit/pages/RedditForgotPassword';
import { RedditResetPassword } from './modules/reddit/pages/RedditResetPassword';
import { AdminOverview } from './modules/reddit/pages/admin/AdminOverview';
import { AdminOrders as RedditAdminOrders } from './modules/reddit/pages/admin/AdminOrders';
import { AdminTickets as RedditAdminTickets } from './modules/reddit/pages/admin/AdminTickets';
import { AdminClients as RedditAdminClients } from './modules/reddit/pages/admin/AdminClients';
import { AdminFinance as RedditAdminFinance } from './modules/reddit/pages/admin/AdminFinance';
import { AdminReviews as RedditAdminReviews } from './modules/reddit/pages/admin/AdminReviews';
import { AdminFeatureRequests as RedditAdminFeatureRequests } from './modules/reddit/pages/admin/AdminFeatureRequests';
import { AdminSettings as RedditAdminSettings } from './modules/reddit/pages/admin/AdminSettings';
import { AdminWaitlist } from './modules/reddit/pages/admin/AdminWaitlist';

// Admin Pages
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminRedditAccounts } from './pages/admin/RedditAccounts';
import { AdminTaskQueue } from './pages/admin/TaskQueue';
import { AdminApprovalQueue } from './pages/admin/ApprovalQueue';
import { AdminTeam } from './pages/admin/Team';
import { AdminPayroll } from './pages/admin/Payroll';
import { AdminBroadcast } from './pages/admin/Broadcast';
import { AdminInbox } from './pages/admin/Inbox';
import { AdminSecrets } from './pages/admin/Secrets';
import { AdminWaBot } from './pages/admin/WaBot';
import { AdminGuard } from './components/AdminGuard';
import { AdminRouteWrapper } from './components/AdminRouteWrapper';

import './App.css';
import './index.css';

// QueryClient defaults tuned to reduce Vercel Edge Request volume.
// Before: every page navigation refetched all queries from scratch +
// window-focus triggered another round. With ~100 army users polling
// 4 queries every 30s, this hit 2.6M edge requests / month on Hobby
// tier (3x over limit).
//
// New defaults:
// - staleTime 60s: same query across pages dedupes for 1min
// - gcTime 5min: keep cache alive across navigation
// - refetchOnWindowFocus false: stop spurious refetches on tab switch
// - retry 2: keep retries low to avoid amplification on outage
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      retry: 2,
    },
  },
});

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
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/update-password" element={<UpdatePassword />} />
          <Route path="/reset-whatsapp" element={<ResetWhatsApp />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/onboarding" element={<Onboarding />} />

          {/* Army Routes */}
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/task/:taskId" element={<TaskDetail />} />
          <Route path="/karma-mission" element={<KarmaMission />} />
          <Route path="/account" element={<Account />} />
          <Route path="/earnings" element={<Earnings />} />

          {/* Reddit Upvotes Routes */}
          <Route path="/reddit" element={<RedditLanding />} />
          <Route path="/reddit/waitlist" element={<WaitlistPage />} />
          <Route path="/reddit/signup" element={<RedditSignup />} />
          <Route path="/reddit/login" element={<RedditLogin />} />
          <Route path="/reddit/dashboard" element={<RedditDashboard />} />
          <Route path="/reddit/new-order" element={<RedditNewOrder />} />
          <Route path="/reddit/orders" element={<RedditOrders />} />
          <Route path="/reddit/orders/:orderId" element={<RedditOrderDetail />} />
          <Route path="/reddit/topup" element={<RedditTopup />} />
          <Route path="/reddit/reviews" element={<RedditReviews />} />
          <Route path="/reddit/feature-requests" element={<RedditFeatureRequests />} />
          <Route path="/reddit/ranking-forum" element={<RankingForumPage />} />
          <Route path="/reddit/ai-visibility" element={<AiVisibilityPage />} />
          <Route path="/reddit/terms" element={<TermsPage />} />
          <Route path="/reddit/privacy" element={<PrivacyPage />} />
          <Route path="/reddit/refunds" element={<RefundsPage />} />
          <Route path="/reddit/contact" element={<ContactPage />} />
          <Route path="/reddit/forgot-password" element={<RedditForgotPassword />} />
          <Route path="/reddit/reset-password" element={<RedditResetPassword />} />
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
          <Route path="/reddit/admin/settings" element={<AdminGuard><RedditAdminSettings /></AdminGuard>} />
          <Route path="/reddit/admin/waitlist" element={<AdminGuard><AdminWaitlist /></AdminGuard>} />

          {/* Admin Routes (guarded) */}
          <Route path="/admin" element={<AdminRouteWrapper><AdminGuard><AdminDashboard /></AdminGuard></AdminRouteWrapper>} />
          <Route path="/admin/accounts" element={<AdminRouteWrapper><AdminGuard><AdminRedditAccounts /></AdminGuard></AdminRouteWrapper>} />
          <Route path="/admin/tasks" element={<AdminRouteWrapper><AdminGuard><AdminTaskQueue /></AdminGuard></AdminRouteWrapper>} />
          <Route path="/admin/approval" element={<AdminRouteWrapper><AdminGuard><AdminApprovalQueue /></AdminGuard></AdminRouteWrapper>} />
          <Route path="/admin/team" element={<AdminRouteWrapper><AdminGuard><AdminTeam /></AdminGuard></AdminRouteWrapper>} />
          <Route path="/admin/payroll" element={<AdminRouteWrapper><AdminGuard><AdminPayroll /></AdminGuard></AdminRouteWrapper>} />
          <Route path="/admin/broadcast" element={<AdminRouteWrapper><AdminGuard><AdminBroadcast /></AdminGuard></AdminRouteWrapper>} />
          <Route path="/admin/inbox" element={<AdminRouteWrapper><AdminGuard><AdminInbox /></AdminGuard></AdminRouteWrapper>} />
          <Route path="/admin/secrets" element={<AdminRouteWrapper><AdminGuard><AdminSecrets /></AdminGuard></AdminRouteWrapper>} />
          <Route path="/admin/wa-bot" element={<AdminRouteWrapper><AdminGuard><AdminWaBot /></AdminGuard></AdminRouteWrapper>} />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
