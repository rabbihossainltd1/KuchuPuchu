import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { getStoredSessionToken } from "./lib/api";
import { AppLayout } from "./components/Layout";
import { Spinner } from "./components/ui";
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from "./pages/public";
import {
  DiscoverPage,
  HelpPage,
  InventoryPage,
  OnboardingPage,
  PaymentReturnPage,
  PlayerPage,
  ReferralsPage,
  SandboxPayPage,
  SettingsPage,
  StorePage,
  WalletPage,
} from "./pages/appPages";
import { HomePage } from "./pages/home";
import { ConversationPage, MessagesPage } from "./pages/chat";
import { RequestsPage } from "./pages/requests";
import { FriendsPage } from "./pages/friends";
import { NotificationsPage } from "./pages/notifications";
import { ProfileEditPage, ProfilePage } from "./pages/profile";
import { AdminPage } from "./pages/admin";

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading || (!user && getStoredSessionToken())) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Navigate to="/home" replace />;
  return children;
}

function hideSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  el.classList.add("gone");
  window.setTimeout(() => el.remove(), 400);
}

export function App() {
  const { loading } = useAuth();
  useEffect(() => {
    if (!loading) hideSplash();
  }, [loading]);

  return (
    <Routes>
      <Route
        path="/"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <RegisterPage />
          </PublicOnly>
        }
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/sandbox-pay/:id" element={<SandboxPayPage />} />
      <Route
        element={
          <Guard>
            <AppLayout />
          </Guard>
        }
      >
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/players/:id" element={<PlayerPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:id" element={<ConversationPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/edit" element={<ProfileEditPage />} />
        <Route path="/store" element={<StorePage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/wallet/payment/:id" element={<PaymentReturnPage />} />
        <Route path="/referrals" element={<ReferralsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
