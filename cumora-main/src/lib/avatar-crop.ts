export function avatarCrop(width: number, height: number, zoom: number, x: number, y: number) {
  const size = Math.min(width, height) / Math.max(1, zoom)
  const cx = Math.max(size / 2, Math.min(width - size / 2, x))
  const cy = Math.max(size / 2, Math.min(height - size / 2, y))
  return { x: cx - size / 2, y: cy - size / 2, size, cx, cy }
}
