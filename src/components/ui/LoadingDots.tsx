type LoadingDotsProps = {
  className?: string
  dotClassName?: string
  label?: string
}

export function LoadingDots({
  className = 'text-teal-600',
  dotClassName = 'h-2 w-2',
  label = 'Memuat',
}: LoadingDotsProps) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} role="status" aria-label={label}>
      <span className={`rounded-full bg-current animate-pulse [animation-delay:-0.3s] ${dotClassName}`} />
      <span className={`rounded-full bg-current animate-pulse [animation-delay:-0.15s] ${dotClassName}`} />
      <span className={`rounded-full bg-current animate-pulse ${dotClassName}`} />
    </span>
  )
}
