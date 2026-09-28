import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { OnboardingFlow } from "../features/onboarding/OnboardingFlow";
import { LoginScreen } from "../features/auth/LoginScreen";
import { HomeScreen } from "../features/home/HomeScreen";
import { CompanionProfile } from "../features/companion/CompanionProfile";
import { BrainScreen } from "../features/companion/BrainScreen";
import { ChatScreen } from "../features/chat/ChatScreen";
import { SettingsScreen } from "../features/home/SettingsScreen";

function Guard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export function Splash() {
  return (
    <div className="screen center" style={{ justifyContent: "center" }}>
      <div className="spinner" />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/welcome" element={<OnboardingFlow />} />
      <Route path="/new" element={<Guard><OnboardingFlow /></Guard>} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/" element={<Guard><HomeScreen /></Guard>} />
      <Route path="/settings" element={<Guard><SettingsScreen /></Guard>} />
      <Route path="/c/:id" element={<Guard><ChatScreen /></Guard>} />
      <Route path="/c/:id/profile" element={<Guard><CompanionProfile /></Guard>} />
      <Route path="/c/:id/brain" element={<Guard><BrainScreen /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
