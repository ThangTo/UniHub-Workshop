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
      <header className="sticky top-0 z-50 border-b border-white/20 bg-white/70 backdrop-blur-lg shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/workshops" className="flex items-center gap-3 transition-transform hover:scale-105">
            <span className="text-xl font-bold bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">UniHub Admin</span>
            <span className="badge bg-brand-100/80 text-brand-700 ring-1 ring-brand-200">Quản trị</span>
          </Link>
          <nav className="flex items-center gap-2">
            {NAV.filter((n) => !n.requireRole || hasRole(n.requireRole)).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  clsx(
                    'rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300',
                    isActive
                      ? 'bg-brand-50/80 text-brand-700 shadow-sm ring-1 ring-brand-100'
                      : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-900',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
            <div className="ml-4 flex items-center gap-3 border-l border-slate-200/60 pl-4">
              <span className="hidden text-sm font-medium text-slate-600 sm:inline">
                {user?.fullName} <span className="text-slate-400">({user?.roles.join(', ')})</span>
              </span>
              <button className="btn-ghost" onClick={logout}>
                Đăng xuất
              </button>
            </div>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200/50 bg-white/30 backdrop-blur-sm py-6 text-center text-sm font-medium text-slate-400">
        © UniHub Admin · TKPM HCMUS
      </footer>
    </div>
  );
}
