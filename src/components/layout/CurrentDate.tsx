export function CurrentDate() {
  return (
    <p className="shrink-0 text-right text-xs font-medium text-slate-500">
      {new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}
    </p>
  )
}
