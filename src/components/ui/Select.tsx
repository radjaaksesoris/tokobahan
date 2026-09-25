import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
  menuClassName?: string
  native?: boolean
  disabled?: boolean
  'aria-label'?: string
}

export function Select({
  value,
  options,
  onChange,
  className,
  menuClassName,
  native = false,
  disabled = false,
  'aria-label': ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = options.find((option) => option.value === value)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

  function openMenu() {
    setOpen(true)
    window.requestAnimationFrame(() => {
      optionRefs.current[selectedIndex]?.focus()
    })
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  if (native) {
    return (
      <div className={cn('relative min-w-28 shrink-0', className)}>
        <select
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full appearance-none rounded-xl border border-border bg-surface px-3 pr-9 text-sm text-ink outline-none transition-[border-color,box-shadow] hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 text-left text-sm text-ink transition-[border-color,box-shadow] hover:border-primary/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={(event) => {
          if (event.detail === 0) return
          setOpen((current) => !current)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            setOpen(false)
          }
          if ((event.key === 'Enter' || event.key === ' ') && !open) {
            event.preventDefault()
            openMenu()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            openMenu()
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu()
          }
        }}
      >
        <span className="truncate">{selected?.label || 'Pilih...'}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            'absolute left-0 z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-[0_12px_28px_rgba(32,42,46,0.12)]',
            menuClassName,
          )}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={option.value === value}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                option.value === value && 'bg-primary/10 font-medium text-primary',
              )}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const direction = event.key === 'ArrowDown' ? 1 : -1
                  const nextIndex = (index + direction + options.length) % options.length
                  optionRefs.current[nextIndex]?.focus()
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChange(option.value)
                  setOpen(false)
                  rootRef.current?.querySelector('button')?.focus()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setOpen(false)
                  rootRef.current?.querySelector('button')?.focus()
                }
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
