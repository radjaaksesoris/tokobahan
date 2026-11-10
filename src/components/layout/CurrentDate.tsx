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
    <div
      className={`flex min-w-0 items-center justify-center gap-1.5 text-center ${className}`}
      title={snapshotLabel || undefined}
    >
      <p className="min-w-0 truncate text-[11px] font-medium">
        {new Date().toLocaleDateString('id-ID', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </p>
    </div>
  )
}
