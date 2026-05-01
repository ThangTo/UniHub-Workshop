import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { RoleName } from '../lib/types';

export function ProtectedRoute({
  children,
  requireRole,
}: {
  children: ReactNode;
  requireRole?: RoleName;
}) {
  const { user, loading, hasRole } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">Đang tải…</div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (requireRole && !hasRole(requireRole)) {
    return (
      <div className="card mx-auto mt-12 max-w-md p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900">403 — Không đủ quyền</h2>
        <p className="mt-2 text-sm text-slate-500">Tính năng này yêu cầu role {requireRole}.</p>
      </div>
    );
  }
  return <>{children}</>;
}
