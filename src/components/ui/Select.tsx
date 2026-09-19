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
  'aria-label'?: string
}

export function Select({
  value,
  options,
  onChange,
  className,
  menuClassName,
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

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm text-slate-700 transition-colors hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            setOpen(false)
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen((current) => !current)
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
            optionRefs.current[selectedIndex]?.focus()
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            optionRefs.current[selectedIndex]?.focus()
          }
        }}
      >
        <span className="truncate">{selected?.label || 'Pilih...'}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            'absolute left-0 z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg',
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
                'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-teal-50 hover:text-teal-700',
                option.value === value && 'bg-teal-50 font-medium text-teal-700',
              )}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const direction = event.key === 'ArrowDown' ? 1 : -1
                  const nextIndex = Math.min(
                    options.length - 1,
                    Math.max(0, index + direction),
                  )
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
