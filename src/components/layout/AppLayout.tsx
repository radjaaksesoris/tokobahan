import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  History,
  LogOut,
  Menu,
  Settings,
  WalletCards,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { CurrentDate } from '@/components/layout/CurrentDate'
import type { UserRole } from '@/types'

const navItems: { to: string; icon: typeof LayoutDashboard; label: string; roles: UserRole[]; className: string }[] = [
  { to: '/pos', icon: ShoppingCart, label: 'Kasir', roles: ['admin', 'cashier'], className: '' },
  { to: '/', icon: LayoutDashboard, label: 'Transaksi Hari Ini', roles: ['admin', 'cashier', 'monitor'], className: '' },
  { to: '/transactions', icon: History, label: 'Riwayat Transaksi', roles: ['admin', 'monitor'], className: '' },
  { to: '/products', icon: Package, label: 'Produk', roles: ['admin', 'cashier'], className: '' },
  { to: '/settlements', icon: WalletCards, label: 'Pelunasan Hutang', roles: ['admin', 'cashier'], className: '' },
  { to: '/reports', icon: BarChart3, label: 'Laporan', roles: ['admin', 'monitor'], className: '' },
  { to: '/settings', icon: Settings, label: 'Pengaturan', roles: ['admin'], className: '' },
]

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches)
  const { signOut, isRole } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const isPosRoute = location.pathname.endsWith('/pos')

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsMobile(mediaQuery.matches)
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [])

  const handleLogout = async () => {
    await signOut()
    navigate('/login')
  }

  const filteredNav = navItems.filter((item) => {
    if (!isRole(...item.roles)) return false
    if (isMobile) return item.to === '/' || item.to === '/transactions' || item.to === '/settlements' || item.to === '/reports'
    return true
  })

  return (
    <div className="mobile-page-background flex h-full min-h-screen bg-canvas">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink">
        Lewati ke konten utama
      </a>
      {/* Sidebar */}
      <aside
        className={cn(
          'pos-mobile-nav fixed inset-x-0 bottom-0 z-50 flex h-auto flex-col border-t border-white/10 bg-ink text-white transition-all duration-300 lg:static lg:inset-y-0 lg:left-0 lg:right-auto lg:h-auto lg:w-64 lg:translate-x-0 lg:border-t-0',
          isPosRoute && 'is-pos-route',
          sidebarOpen ? 'translate-x-0' : 'translate-x-0 lg:-translate-x-full lg:w-0 lg:overflow-hidden'
        )}
      >
        <div className="hidden h-[4.5rem] items-center gap-3 border-b border-white/10 px-4 lg:flex">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-ink shadow-[0_0_0_4px_rgba(228,168,83,0.14)]">
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="Radja Aksesoris" className="h-9 w-9 rounded-xl object-cover" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate whitespace-nowrap text-[0.82rem] font-semibold tracking-tight">RADJA AKSESORIS</h1>
            <p className="mt-0.5 whitespace-nowrap text-[0.56rem] font-medium uppercase tracking-[0.12em] text-accent">Aksesoris konveksi</p>
          </div>
        </div>

        <nav className="relative z-10 flex w-full flex-1 overflow-hidden p-2 lg:block lg:space-y-1.5 lg:overflow-visible lg:p-3">
          {filteredNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                cn(
                  'group relative flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-2 text-[0.62rem] font-medium transition-all duration-200 lg:flex-row lg:justify-start lg:gap-3 lg:py-3 lg:text-sm',
                  item.className,
                  item.to === '/pos' && 'hidden lg:flex',
                  'lg:px-3',
                  isActive
                    ? 'bg-surface text-ink shadow-[0_8px_20px_rgba(32,42,46,0.12)]'
                    : 'text-stone-300 hover:bg-white/10 hover:text-white'
                )
              }
            >
              <item.icon className="h-[1.15rem] w-[1.15rem] shrink-0 transition-transform duration-200 group-hover:scale-105" />
              <span className={item.label === 'Riwayat Transaksi' ? 'text-center leading-tight lg:hidden' : 'text-center leading-tight'}>
                {item.label === 'Riwayat Transaksi' ? 'Riwayat' : item.label}
              </span>
              {item.label === 'Riwayat Transaksi' && <span className="hidden lg:inline">Riwayat Transaksi</span>}
            </NavLink>
          ))}
        </nav>

        <div className="hidden border-t border-white/10 p-4 lg:block">
          <div className="mb-4 rounded-xl bg-white/5 px-3 py-2.5">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Hari & tanggal</p>
            <CurrentDate className="text-left text-stone-300" />
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
        <main id="main-content" className="flex-1 overflow-auto px-4 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:p-8">
          <Outlet />
        </main>
      </div>
      {!sidebarOpen && (
        <button
          className="fixed bottom-4 left-4 z-50 hidden rounded-xl border border-border bg-surface p-2 text-muted-foreground shadow-sm transition-all hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 active:scale-95 lg:block"
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
