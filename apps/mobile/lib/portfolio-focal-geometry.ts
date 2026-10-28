type Size = { width: number; height: number }

export function containedImageRect(box: Size, image: Size) {
  if (box.width <= 0 || box.height <= 0 || image.width <= 0 || image.height <= 0) return null
  const scale = Math.min(box.width / image.width, box.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height }
}

export function focalPointInRect(x: number, y: number, rect: NonNullable<ReturnType<typeof containedImageRect>>) {
  return {
    focalX: Math.max(0, Math.min(1, (x - rect.left) / rect.width)),
    focalY: Math.max(0, Math.min(1, (y - rect.top) / rect.height)),
  }
}
