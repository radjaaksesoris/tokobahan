import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  History,
  LogOut,
  Menu,
  Settings,
} from 'lucide-react'
import { useState } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { CurrentDate } from '@/components/layout/CurrentDate'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'cashier', 'monitor'], className: '' },
  { to: '/pos', icon: ShoppingCart, label: 'Kasir', roles: ['admin', 'cashier'], className: 'hidden lg:flex' },
  { to: '/products', icon: Package, label: 'Produk', roles: ['admin', 'cashier'], className: '' },
  { to: '/reports', icon: BarChart3, label: 'Laporan', roles: ['admin', 'monitor'], className: '' },
  { to: '/transactions', icon: History, label: 'Riwayat Transaksi', roles: ['admin', 'monitor'], className: '' },
  { to: '/settings', icon: Settings, label: 'Pengaturan', roles: ['admin'], className: '' },
]

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
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
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-ink text-white transition-all duration-300 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0 lg:w-64' : '-translate-x-full lg:w-0 lg:overflow-hidden',
          'w-64'
        )}
      >
        <div className="flex h-[4.5rem] items-center gap-3 border-b border-white/10 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-ink shadow-[0_0_0_4px_rgba(228,168,83,0.14)]">
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="Radja Aksesoris" className="h-9 w-9 rounded-xl object-cover" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate whitespace-nowrap text-[0.82rem] font-semibold tracking-tight">RADJA AKSESORIS</h1>
            <p className="mt-0.5 whitespace-nowrap text-[0.56rem] font-medium uppercase tracking-[0.12em] text-accent">Aksesoris konveksi</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1.5 p-3">
          {filteredNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center rounded-xl py-3 text-sm font-medium transition-all duration-200',
                  item.className,
                  'gap-3 px-3',
                  isActive
                    ? 'bg-white text-ink shadow-[0_8px_20px_rgba(0,0,0,0.12)]'
                    : 'text-stone-300 hover:bg-white/10 hover:text-white'
                )
              }
            >
              <item.icon className="h-[1.15rem] w-[1.15rem] shrink-0 transition-transform duration-200 group-hover:scale-105" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-4 rounded-xl bg-white/5 px-3 py-2.5">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Hari & tanggal</p>
            <CurrentDate className="text-left text-stone-300" />
          </div>
          <div className="mb-3 text-sm">
            <p className="font-medium">{profile?.full_name || 'User'}</p>
            <p className="text-xs capitalize text-accent">{profile?.role}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'border-white/20 bg-transparent text-stone-300 transition-colors hover:bg-white/10 hover:text-white',
              'w-full'
            )}
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            <span>Keluar</span>
          </Button>
          <button
            className="mt-2 flex w-full items-center justify-center rounded-lg border border-white/20 p-2 text-stone-300 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => setSidebarOpen(false)}
            aria-label="Sembunyikan navbar"
            title="Sembunyikan navbar"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        <main id="main-content" className="flex-1 overflow-auto p-4 sm:p-5 lg:p-8">
          <Outlet />
        </main>
      </div>
      {!sidebarOpen && (
        <button
          className="fixed bottom-4 left-4 z-50 rounded-xl border border-stone-300 bg-surface p-2 text-slate-600 shadow-sm transition-all hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 active:scale-95"
          onClick={() => setSidebarOpen(true)}
          aria-label="Tampilkan navbar"
          title="Tampilkan navbar"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}
