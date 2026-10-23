import type { EventRecord } from './types.ts'
import { externalHref, pbDate } from './types.ts'

// "2026-07-15 19:00:00.000Z" -> "20260715T190000Z"
function calStamp(value: string): string {
  return pbDate(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function endOrDefault(event: EventRecord): string {
  if (event.end) return calStamp(event.end)
  const end = new Date(pbDate(event.start).getTime() + 2 * 3600e3)
  return end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function googleCalendarUrl(
  event: EventRecord,
  productionTitle: string,
  locationLine?: string,
): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${event.title} — ${productionTitle}`,
    dates: `${calStamp(event.start)}/${endOrDefault(event)}`,
  })
  const loc = locationLine || event.location || event.videoUrl
  if (loc) params.set('location', loc)
  const details = eventDetails(event)
  if (details) params.set('details', details)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// Calendar description: the video link first so it's one tap from the alert.
function eventDetails(event: EventRecord): string {
  const join = event.videoUrl ? `Join the video call: ${externalHref(event.videoUrl)}` : ''
  return [join, event.calledNote, event.notes].filter(Boolean).join('\n')
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

// Download a single-event .ics — iPhones open it straight into Calendar,
// desktops hand it to the default calendar app.
export function downloadEventIcs(
  event: EventRecord,
  productionTitle: string,
  locationLine?: string,
): void {
  const details = eventDetails(event)
  const loc = locationLine || event.location || event.videoUrl
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Glow Tape//Event//EN',
    'BEGIN:VEVENT',
    `UID:evt-${event.id}@glowtape`,
    `DTSTAMP:${calStamp(new Date().toISOString().replace('T', ' '))}`,
    `DTSTART:${calStamp(event.start)}`,
    `DTEND:${endOrDefault(event)}`,
    `SUMMARY:${icsEscape(`${event.title} — ${productionTitle}`)}`,
    ...(loc ? [`LOCATION:${icsEscape(loc)}`] : []),
    ...(details ? [`DESCRIPTION:${icsEscape(details)}`] : []),
    ...(event.videoUrl ? [`URL:${externalHref(event.videoUrl)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${event.title.replace(/[^\w -]/g, '')}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// One .ics with several events — used for "add all the audition times".
export function downloadMultiIcs(
  events: { start: string; end: string; location: string; title: string }[],
  productionTitle: string,
  filename: string,
): void {
  const stamp = calStamp(new Date().toISOString().replace('T', ' '))
  const blocks = events.map((ev, i) =>
    [
      'BEGIN:VEVENT',
      `UID:gt-${stamp}-${i}@glowtape`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${calStamp(ev.start)}`,
      ev.end
        ? `DTEND:${calStamp(ev.end)}`
        : `DTEND:${new Date(pbDate(ev.start).getTime() + 2 * 3600e3)
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\.\d{3}/, '')}`,
      `SUMMARY:${icsEscape(`${ev.title || 'Auditions'} — ${productionTitle}`)}`,
      ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
      'END:VEVENT',
    ].join('\r\n'),
  )
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Glow Tape//Auditions//EN', ...blocks, 'END:VCALENDAR']
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename.replace(/[^\w -]/g, '')}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
