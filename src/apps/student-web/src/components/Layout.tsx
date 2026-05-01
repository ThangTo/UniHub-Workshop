import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/workshops" className="text-lg font-semibold text-brand-700">
            UniHub Workshop
          </Link>
          <nav className="flex items-center gap-1">
            <NavItem to="/workshops">Workshop</NavItem>
            <NavItem to="/me/registrations">Đăng ký của tôi</NavItem>
            <div className="ml-3 flex items-center gap-2 border-l border-slate-200 pl-3">
              <span className="hidden text-sm text-slate-600 sm:inline">
                {user?.fullName}
                {user?.studentCode ? ` · ${user.studentCode}` : ''}
              </span>
              <button className="btn-ghost" onClick={logout}>
                Đăng xuất
              </button>
            </div>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        © UniHub Workshop · TKPM HCMUS
      </footer>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'rounded-md px-3 py-1.5 text-sm font-medium transition',
          isActive
            ? 'bg-brand-50 text-brand-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )
      }
    >
      {children}
    </NavLink>
  );
}
