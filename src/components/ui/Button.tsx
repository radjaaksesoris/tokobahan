import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg' | 'icon'
}

const variants = {
  primary: 'bg-primary text-primary-foreground hover:bg-teal-800 active:bg-teal-900 shadow-[0_7px_18px_rgba(15,118,110,0.16)]',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-slate-700 active:bg-slate-800',
  outline: 'border border-border bg-surface hover:border-primary/40 hover:bg-primary/5 text-ink',
  ghost: 'hover:bg-muted text-ink',
  destructive: 'bg-destructive text-white hover:bg-red-600',
}

const sizes = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
  icon: 'h-10 w-10',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
      'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
      variants[variant],
      sizes[size],
      className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
)
Button.displayName = 'Button'
