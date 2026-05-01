import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';
import type { RoleName } from '../lib/types';

interface NavEntry {
  to: string;
  label: string;
  requireRole?: RoleName;
}

const NAV: NavEntry[] = [
  { to: '/workshops', label: 'Workshops' },
  { to: '/registrations', label: 'Đăng ký' },
  { to: '/staff-assignments', label: 'Phân công' },
  { to: '/import-jobs', label: 'CSV import', requireRole: 'SYS_ADMIN' },
];

export function Layout() {
  const { user, hasRole, logout } = useAuth();
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link to="/workshops" className="flex items-center gap-2">
            <span className="text-lg font-semibold text-brand-700">UniHub Admin</span>
            <span className="badge bg-brand-50 text-brand-700">Quản trị</span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.filter((n) => !n.requireRole || hasRole(n.requireRole)).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  clsx(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
            <div className="ml-3 flex items-center gap-2 border-l border-slate-200 pl-3">
              <span className="hidden text-sm text-slate-600 sm:inline">
                {user?.fullName} <span className="text-slate-400">({user?.roles.join(', ')})</span>
              </span>
              <button className="btn-ghost" onClick={logout}>
                Đăng xuất
              </button>
            </div>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
