export function isoNow(): string {
  return new Date().toISOString()
}

export function createVersionId(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    'v',
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}
