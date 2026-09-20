export function CurrentDate({ className = '' }: { className?: string }) {
  return (
    <p className={`shrink-0 text-xs font-medium text-muted-foreground ${className}`}>
      {new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}
    </p>
  )
}
