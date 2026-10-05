import type { Look } from './studio-state'
export function mountSketchImport(api: {
  read: () => Look
  commit: (change: (look: Look) => void) => void
  status: (text: string) => void
}) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  get('uploadSketch').onclick = () => get<HTMLInputElement>('sketchFile').click()
  get<HTMLInputElement>('sketchFile').onchange = async () => {
    const input = get<HTMLInputElement>('sketchFile'),
      file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15000000)
        throw Error('Choose a JPEG, PNG or WebP under 15 MB.')
      const bitmap = await createImageBitmap(file)
      try {
        const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height)),
          c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(bitmap.width * scale))
        c.height = Math.max(1, Math.round(bitmap.height * scale))
        const ctx = c.getContext('2d')
        if (!ctx) throw Error('This sketch could not open.')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, c.width, c.height)
        ctx.drawImage(bitmap, 0, 0, c.width, c.height)
        const image = [0.85, 0.65, 0.45]
          .map((q) => c.toDataURL('image/jpeg', q))
          .find((s) => s.length <= 300000)
        if (!image) throw Error('Try a smaller copy of this sketch.')
        api.commit((s) => {
          s.sketchUnderlay = { image, opacity: 0.4, visible: true, contrast: 1, framing: 'fit' }
          s.canvasMode = 'paper'
        })
        api.status(
          'Sketch added. Turn on Draw detail to trace above it. Undo restores the previous page.'
        )
        document.getElementById('canvas')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } finally {
        bitmap.close()
      }
    } catch (error) {
      api.status(error instanceof Error ? error.message : 'Sketch could not open.')
    }
  }
  get<HTMLInputElement>('sketchOpacity').onchange = () =>
    api.commit((s) => {
      if (s.sketchUnderlay)
        s.sketchUnderlay.opacity = Number(get<HTMLInputElement>('sketchOpacity').value) / 100
    })
  get<HTMLInputElement>('sketchContrast').oninput = () =>
    api.commit((s) => {
      if (s.sketchUnderlay)
        s.sketchUnderlay.contrast = Number(get<HTMLInputElement>('sketchContrast').value) / 100
    })
  get<HTMLSelectElement>('sketchFraming').onchange = () =>
    api.commit((s) => {
      if (s.sketchUnderlay)
        s.sketchUnderlay.framing = get<HTMLSelectElement>('sketchFraming').value as 'fit' | 'fill'
    })
  get('toggleSketchSource').onclick = () =>
    api.commit((s) => {
      if (s.sketchUnderlay) s.sketchUnderlay.visible = !s.sketchUnderlay.visible
    })
  get('removeSketchSource').onclick = () => api.commit((s) => (s.sketchUnderlay = null))
  return {
    sync() {
      const source = api.read().sketchUnderlay
      get('sketchSourceControls').hidden = !source
      get<HTMLInputElement>('sketchOpacity').value = String((source?.opacity ?? 0.4) * 100)
      get<HTMLInputElement>('sketchContrast').value = String((source?.contrast ?? 1) * 100)
      get<HTMLSelectElement>('sketchFraming').value = source?.framing ?? 'fit'
      get('toggleSketchSource').setAttribute('aria-pressed', String(source?.visible ?? false))
      get('toggleSketchSource').textContent = source?.visible ? 'Hide original sketch' : 'Show original sketch'
    },
  }
}
