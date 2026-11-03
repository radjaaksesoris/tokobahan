export function CurrentDate({
  className = '',
  snapshotGeneratedAt,
}: {
  className?: string
  snapshotGeneratedAt?: string | null
}) {
  const snapshotDate = snapshotGeneratedAt
    ? new Date(snapshotGeneratedAt)
    : null
  const snapshotLabel = snapshotDate && Number.isFinite(snapshotDate.getTime())
    ? `Snapshot lokal dibuat ${snapshotDate.toLocaleString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : null

  return (
    <div className={`flex min-w-0 items-center justify-between gap-1.5 ${className}`}>
      <p className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
        {new Date().toLocaleDateString('id-ID', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </p>
      {snapshotLabel && (
        <span
          className="shrink-0 text-[9px] font-medium text-emerald-300"
          role="status"
          title={snapshotLabel}
          aria-label={snapshotLabel}
        >
          Snapshot lokal
        </span>
      )}
    </div>
  )
}
