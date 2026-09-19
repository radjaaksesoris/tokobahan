import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  LogOut,
  Menu,
  X,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
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
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
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
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-teal-900 text-white transition-all duration-200 lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'w-64',
          collapsed ? 'lg:w-20' : 'lg:w-64'
        )}
      >
        <div className={cn('flex h-[4.5rem] items-center border-b border-teal-800/80', collapsed ? 'justify-center px-2' : 'gap-3 px-4')}>
          <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="Radja Aksesoris" className="h-9 w-9 rounded-lg" />
          <div className={cn('min-w-0', collapsed && 'hidden')}>
            <h1 className="truncate text-[0.95rem] font-semibold tracking-tight">RADJA AKSESORIS</h1>
            <p className="mt-0.5 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-teal-300">Aksesoris Konveksi</p>
          </div>
          <button className="ml-auto rounded-lg p-1.5 text-teal-200 transition-colors hover:bg-teal-800 hover:text-white lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Tutup navbar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1.5 p-3">
          {filteredNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center rounded-xl py-3 text-sm font-medium transition-all duration-200',
                  collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                  isActive
                    ? 'bg-teal-700 text-white shadow-[0_8px_20px_rgba(13,148,136,0.18)]'
                    : 'text-teal-100/80 hover:bg-teal-800/80 hover:text-white'
                )
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-[1.15rem] w-[1.15rem] shrink-0 transition-transform duration-200 group-hover:scale-105" />
              <span className={cn(collapsed && 'hidden')}>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={cn('border-t border-teal-800/80', collapsed ? 'p-2' : 'p-4')}>
          <div className={cn('mb-3 text-sm', collapsed && 'hidden')}>
            <p className="font-medium">{profile?.full_name || 'User'}</p>
            <p className="text-xs capitalize text-teal-300">{profile?.role}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'border-teal-600/80 bg-transparent text-teal-100 transition-colors hover:bg-teal-800 hover:text-white',
              collapsed ? 'w-full px-0' : 'w-full'
            )}
            onClick={handleLogout}
            title={collapsed ? 'Keluar' : undefined}
          >
            <LogOut className="h-4 w-4" />
            <span className={cn(collapsed && 'hidden')}>Keluar</span>
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
          <button
            className="rounded-xl border border-slate-200 p-2 text-slate-600 shadow-sm transition-all hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 active:scale-95 lg:hidden"
            onClick={() => setMobileOpen((current) => !current)}
            aria-label="Tampilkan navbar"
            title="Tampilkan navbar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            className="hidden rounded-xl border border-slate-200 p-2 text-slate-600 shadow-sm transition-all hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 active:scale-95 lg:block"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? 'Tampilkan navbar' : 'Sembunyikan navbar'}
            title={collapsed ? 'Tampilkan navbar' : 'Sembunyikan navbar'}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
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
