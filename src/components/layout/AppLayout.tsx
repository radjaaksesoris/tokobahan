import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  History,
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
  { to: '/transactions', icon: History, label: 'Riwayat Transaksi', roles: ['admin', 'monitor'] },
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
    <div className="flex h-full min-h-screen bg-canvas/80">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink">
        Lewati ke konten utama
      </a>
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
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-ink text-white transition-all duration-300 lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'w-64',
          collapsed ? 'lg:w-20' : 'lg:w-64'
        )}
      >
        <div className={cn('flex h-[4.5rem] items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'gap-3 px-4')}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-ink shadow-[0_0_0_4px_rgba(228,168,83,0.14)]">
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="Radja Aksesoris" className="h-9 w-9 rounded-xl object-cover" />
          </div>
          <div className={cn('min-w-0', collapsed && 'hidden')}>
            <h1 className="truncate text-[0.95rem] font-semibold tracking-tight">RADJA AKSESORIS</h1>
            <p className="mt-0.5 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-accent">Aksesoris konveksi</p>
          </div>
          <button className="ml-auto rounded-lg p-1.5 text-stone-300 transition-colors hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Tutup navbar">
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
                    ? 'bg-white text-ink shadow-[0_8px_20px_rgba(0,0,0,0.12)]'
                    : 'text-stone-300 hover:bg-white/10 hover:text-white'
                )
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-[1.15rem] w-[1.15rem] shrink-0 transition-transform duration-200 group-hover:scale-105" />
              <span className={cn(collapsed && 'hidden')}>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={cn('border-t border-white/10', collapsed ? 'p-2' : 'p-4')}>
          <div className={cn('mb-3 text-sm', collapsed && 'hidden')}>
            <p className="font-medium">{profile?.full_name || 'User'}</p>
            <p className="text-xs capitalize text-accent">{profile?.role}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'border-white/20 bg-transparent text-stone-300 transition-colors hover:bg-white/10 hover:text-white',
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-stone-200/80 bg-canvas/90 px-4 backdrop-blur lg:px-8">
          <button
            className="rounded-xl border border-stone-300 bg-surface p-2 text-slate-600 transition-all hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 active:scale-95 lg:hidden"
            onClick={() => setMobileOpen((current) => !current)}
            aria-label="Tampilkan navbar"
            title="Tampilkan navbar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            className="hidden rounded-xl border border-stone-300 bg-surface p-2 text-slate-600 transition-all hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 active:scale-95 lg:block"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? 'Tampilkan navbar' : 'Sembunyikan navbar'}
            title={collapsed ? 'Tampilkan navbar' : 'Sembunyikan navbar'}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
          <div className="flex-1" />
          <span className="hidden rounded-full border border-stone-300 bg-surface px-3 py-1.5 text-xs font-medium text-slate-600 sm:inline">
            {new Date().toLocaleDateString('id-ID', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        </header>

        <main id="main-content" className="flex-1 overflow-auto p-4 sm:p-5 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
