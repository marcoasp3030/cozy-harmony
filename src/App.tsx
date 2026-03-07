import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useUserPermissions } from "@/hooks/useUserPermissions";
import AppLayout from "@/components/layout/AppLayout";
import Auth from "@/pages/Auth";

// Lazy load all pages for code splitting
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Contacts = lazy(() => import("@/pages/Contacts"));
const Campaigns = lazy(() => import("@/pages/Campaigns"));
const Automations = lazy(() => import("@/pages/Automations"));
const InboxPage = lazy(() => import("@/pages/InboxPage"));
const Templates = lazy(() => import("@/pages/Templates"));
const Reports = lazy(() => import("@/pages/Reports"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const FunnelsPage = lazy(() => import("@/pages/FunnelsPage"));
const OccurrencesPage = lazy(() => import("@/pages/OccurrencesPage"));
const AttendantsPage = lazy(() => import("@/pages/AttendantsPage"));
const QueuePage = lazy(() => import("@/pages/QueuePage"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function RoleGuard({ children, requiredRole }: { children: React.ReactNode; requiredRole: "admin" | "admin_or_supervisor" }) {
  const { isAdmin, isAdminOrSupervisor, isLoading } = useUserRole();

  if (isLoading) {
    return <PageLoader />;
  }

  const hasAccess = requiredRole === "admin" ? isAdmin : isAdminOrSupervisor;
  if (!hasAccess) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function PermissionGuard({ children, pageKey }: { children: React.ReactNode; pageKey: string }) {
  const { canAccessPage, isLoading } = useUserPermissions();
  
  if (isLoading) return <PageLoader />;
  if (!canAccessPage(pageKey)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AuthRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Auth />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/auth" element={<AuthRedirect />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/contacts" element={<PermissionGuard pageKey="contacts"><Contacts /></PermissionGuard>} />
              <Route path="/campaigns" element={<PermissionGuard pageKey="campaigns"><Campaigns /></PermissionGuard>} />
              <Route path="/automations" element={<PermissionGuard pageKey="automations"><Automations /></PermissionGuard>} />
              <Route path="/inbox" element={<PermissionGuard pageKey="inbox"><InboxPage /></PermissionGuard>} />
              <Route path="/funnels" element={<PermissionGuard pageKey="funnels"><FunnelsPage /></PermissionGuard>} />
              <Route path="/occurrences" element={<PermissionGuard pageKey="occurrences"><OccurrencesPage /></PermissionGuard>} />
              <Route path="/attendants" element={<RoleGuard requiredRole="admin_or_supervisor"><AttendantsPage /></RoleGuard>} />
              <Route path="/queue" element={<PermissionGuard pageKey="queue"><QueuePage /></PermissionGuard>} />
              <Route path="/templates" element={<PermissionGuard pageKey="templates"><Templates /></PermissionGuard>} />
              <Route path="/reports" element={<PermissionGuard pageKey="reports"><Reports /></PermissionGuard>} />
              <Route path="/settings" element={<PermissionGuard pageKey="settings"><SettingsPage /></PermissionGuard>} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
