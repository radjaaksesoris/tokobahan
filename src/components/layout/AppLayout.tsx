import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  LogOut,
  Menu,
  X,
  Store,
  Settings,
} from 'lucide-react'
import { useState } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'cashier', 'monitor'] },
  { to: '/pos', icon: ShoppingCart, label: 'Kasir', roles: ['admin', 'cashier'] },
  { to: '/products', icon: Package, label: 'Produk', roles: ['admin', 'cashier'] },
  { to: '/reports', icon: BarChart3, label: 'Laporan', roles: ['admin', 'monitor'] },
  { to: '/settings', icon: Settings, label: 'Pengaturan', roles: ['admin'] },
]

export function AppLayout() {
  const [open, setOpen] = useState(false)
  const { profile, signOut, isRole } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await signOut()
    navigate('/login')
  }

  const filteredNav = navItems.filter((item) => isRole(...(item.roles as any)))

  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-teal-900 text-white transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-teal-800 px-4">
          <Store className="h-7 w-7 text-amber-400" />
          <div>
            <h1 className="text-lg font-bold leading-tight">KonveksiPOS</h1>
            <p className="text-xs text-teal-300">Grosir Alat Konveksi</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {filteredNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-teal-700 text-white'
                    : 'text-teal-100 hover:bg-teal-800 hover:text-white'
                )
              }
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-teal-800 p-4">
          <div className="mb-3 text-sm">
            <p className="font-medium">{profile?.full_name || 'User'}</p>
            <p className="text-xs capitalize text-teal-300">{profile?.role}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full border-teal-600 bg-transparent text-teal-100 hover:bg-teal-800 hover:text-white"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Keluar
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
          <button
            className="rounded-lg p-2 hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <span className="text-sm text-slate-500 hidden sm:inline">
            {new Date().toLocaleDateString('id-ID', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        </header>

        <main className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
