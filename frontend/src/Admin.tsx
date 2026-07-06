import { useEffect } from "react";
import { useAdminAuth } from "./hooks/useAdminAuth";
import AdminLogin from "./components/admin/AdminLogin";
import AdminDashboard from "./components/admin/AdminDashboard";

function LoadingScreen() {
  return (
    <div className="admin-loading-screen">
      <p className="font-display crt-glow">LOADING…</p>
    </div>
  );
}

export default function Admin() {
  const { isAdmin, isLoading, login, logout } = useAdminAuth();

  useEffect(() => {
    document.title = "Admin — CME.exe";
  }, []);

  if (isLoading) return <LoadingScreen />;
  if (!isAdmin) return <AdminLogin onLogin={login} />;
  return <AdminDashboard onLogout={logout} />;
}
