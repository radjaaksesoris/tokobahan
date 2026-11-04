import { useEffect, useMemo, useRef, useState, type KeyboardEventHandler, type RefObject } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
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
  searchable?: boolean
  compact?: boolean
  selectedLabel?: string
  disabled?: boolean
  id?: string
  focusRef?: RefObject<HTMLButtonElement | null>
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>
  'aria-label'?: string
}

export function Select({
  value,
  options,
  onChange,
  className,
  menuClassName,
  native = false,
  searchable = false,
  compact = false,
  selectedLabel,
  disabled = false,
  id,
  focusRef,
  onKeyDown,
  'aria-label': ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = options.find((option) => option.value === value)
  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return query
      ? options.filter((option) => option.label.toLocaleLowerCase().includes(query))
      : options
  }, [options, searchQuery])
  const selectedIndex = Math.max(0, filteredOptions.findIndex((option) => option.value === value))

  function openMenu() {
    setOpen(true)
    window.requestAnimationFrame(() => {
      if (searchable) searchInputRef.current?.focus()
      else optionRefs.current[selectedIndex]?.focus()
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

  useEffect(() => {
    if (!open) setSearchQuery('')
  }, [open])

  if (native) {
    return (
      <div className={cn('relative min-w-28 shrink-0', className)}>
        <select
          id={id}
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
        id={id}
        ref={(element) => {
          triggerRef.current = element
          if (focusRef) focusRef.current = element
        }}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 text-left text-sm text-ink transition-[border-color,box-shadow] hover:border-primary/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50',
          compact && 'px-2 text-xs',
        )}
        onClick={(event) => {
          if (event.detail === 0) return
          if (open) setOpen(false)
          else openMenu()
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
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
        <span className="truncate">{selected?.label || selectedLabel || 'Pilih...'}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          className={cn(
            'absolute left-0 z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface p-0.5 shadow-[0_12px_28px_rgba(32,42,46,0.12)]',
            menuClassName,
          )}
        >
          {searchable && (
            <label className="relative block border-b border-border p-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                aria-label={`Cari ${ariaLabel || 'pilihan'}`}
                placeholder="Cari nama barang..."
                className="h-8 w-full rounded-lg bg-surface pl-8 pr-2 text-xs text-ink outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20"
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setOpen(false)
                    triggerRef.current?.focus()
                  }
                  if (event.key === 'ArrowDown' && filteredOptions.length > 0) {
                    event.preventDefault()
                    optionRefs.current[0]?.focus()
                  }
                }}
              />
            </label>
          )}
          <div
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-52 overflow-y-auto"
          >
          {filteredOptions.map((option, index) => (
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
                'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                compact && 'px-2 py-1.5 text-xs',
                option.value === value && 'bg-primary/10 font-medium text-primary',
              )}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
                window.requestAnimationFrame(() => triggerRef.current?.focus())
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
              <span className="min-w-0 break-words">{option.label}</span>
              {option.value === value && <Check className="h-4 w-4" />}
            </button>
          ))}
          </div>
          {filteredOptions.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">Barang tidak ditemukan</p>
          )}
        </div>
      )}
    </div>
  )
}
