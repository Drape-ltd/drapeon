/** Group only adjacent automated inactivity reminders, retaining every event. */
export function groupOrderTimeline(entries) {
  const groups = []
  for (const entry of entries) {
    const reminder = entry.source === 'stage' && /^Drapeon reminded the tailor after \d+ days without a production update\.$/.test(entry.summary ?? '')
    const previous = groups.at(-1)
    if (reminder && previous?.reminder && previous.entries[0].type === entry.type && previous.entries[0].actor === entry.actor) {
      previous.entries.push(entry)
    } else {
      groups.push({ reminder, entries: [entry] })
    }
  }
  return groups
}
