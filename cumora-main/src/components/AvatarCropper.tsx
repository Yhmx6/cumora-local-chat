import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { avatarCrop } from '@/lib/avatar-crop'

interface Props {
  file: File
  onCancel: () => void
  onConfirm: (file: File) => void
}

export function AvatarCropper({ file, onCancel, onConfirm }: Props) {
  const t = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    dialog.current?.showModal()
    return () => { active.current = false }
  }, [])

  useEffect(() => {
    let disposed = false
    let image: ImageBitmap | undefined
    void createImageBitmap(file).then(result => {
      if (disposed) { result.close(); return }
      image = result
      setBitmap(result)
      setView({ x: result.width / 2, y: result.height / 2, zoom: 1 })
    }).catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true; image?.close() }
  }, [file])

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!bitmap || !context) return
    const crop = avatarCrop(bitmap.width, bitmap.height, view.zoom, view.x, view.y)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 640, 640)
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, 640, 640)
  }, [bitmap, view])

  const move = (dx: number, dy: number) => {
    if (!bitmap) return
    setView(previous => {
      const crop = avatarCrop(bitmap.width, bitmap.height, previous.zoom, previous.x, previous.y)
      const next = avatarCrop(bitmap.width, bitmap.height, previous.zoom, crop.cx + dx * crop.size, crop.cy + dy * crop.size)
      return { ...previous, x: next.cx, y: next.cy }
    })
  }

  const confirm = async () => {
    if (!canvas.current || !bitmap || saving) return
    setSaving(true)
    setError(false)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.current!.toBlob(
        value => value ? resolve(value) : reject(new Error('Photo export failed')), 'image/jpeg', 0.88,
      ))
      if (active.current) onConfirm(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
    } catch { if (active.current) setError(true) }
    finally { if (active.current) setSaving(false) }
  }

  return (
    <dialog ref={dialog} aria-labelledby="avatar-crop-title"
      className="m-auto w-[min(420px,calc(100vw-32px))] max-h-[90vh] overflow-auto rounded-[18px] bg-cloud p-6 text-ink-900 shadow-pop backdrop:bg-black/60"
      onClick={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); if (!saving) onCancel() }}>
      <h2 id="avatar-crop-title" className="text-lg font-semibold">{t('agent.cropTitle')}</h2>
      <p className="mt-2 mb-4 text-sm text-ink-500">{t('agent.cropHint')}</p>
      <div className="relative mx-auto w-full max-w-[320px] aspect-square overflow-hidden rounded-lg bg-ink-100">
        <canvas ref={canvas} width={640} height={640} tabIndex={0} role="img"
          aria-label={t('agent.cropKeyboardHint')}
          className="block w-full h-full cursor-grab active:cursor-grabbing touch-none focus:outline-2 focus:outline-skype focus:outline-offset-[-2px]"
          onPointerDown={event => {
            if (!bitmap || saving || (event.pointerType === 'mouse' && event.button !== 0) || drag.current) return
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          }}
          onPointerMove={event => {
            const start = drag.current
            if (!start || start.id !== event.pointerId || saving) return
            const width = event.currentTarget.getBoundingClientRect().width
            move((start.x - event.clientX) / width, (start.y - event.clientY) / width)
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          }}
          onPointerUp={() => { drag.current = null }}
          onPointerCancel={() => { drag.current = null }}
          onLostPointerCapture={() => { drag.current = null }}
          onKeyDown={event => {
            const directions: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
            const direction = directions[event.key]
            if (!direction || saving) return
            event.preventDefault()
            move(direction[0] * 0.025, direction[1] * 0.025)
          }} />
        <div className="pointer-events-none absolute inset-0 rounded-[6px] border-2 border-white/90"
          style={{ boxShadow: '0 0 0 100px rgba(0,0,0,0.5)' }} />
      </div>
      {!bitmap && !error && <p className="mt-3 text-sm">{t('agent.preparingPhoto')}</p>}
      <label className="mt-5 flex items-center gap-3 text-sm">
        <span>{t('agent.cropZoom')}</span>
        <input type="range" min="1" max="4" step="0.01" value={view.zoom}
          disabled={!bitmap || saving} className="min-w-0 flex-1" aria-label={t('agent.cropZoom')}
          onChange={event => {
            const zoom = Number(event.target.value)
            if (!bitmap) return
            setView(previous => {
              const crop = avatarCrop(bitmap.width, bitmap.height, zoom, previous.x, previous.y)
              return { zoom, x: crop.cx, y: crop.cy }
            })
          }} />
        <span className="w-10 tabular-nums">{view.zoom.toFixed(1)}×</span>
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-coral-deep">{t('agent.photoReadError')}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm font-semibold">
        <button type="button" disabled={!bitmap || saving} className="rounded-lg bg-ink-100 px-3 py-2 disabled:opacity-50"
          onClick={() => bitmap && setView({ x: bitmap.width / 2, y: bitmap.height / 2, zoom: 1 })}>{t('agent.cropReset')}</button>
        <div className="flex-1" />
        <button type="button" disabled={saving} className="rounded-lg px-3 py-2" onClick={onCancel}>{t('agent.cancelBtn')}</button>
        <button type="button" disabled={!bitmap || saving} className="rounded-lg bg-skype px-3 py-2 text-white disabled:opacity-50"
          onClick={() => void confirm()}>{saving ? t('agent.preparingPhoto') : t('agent.cropConfirm')}</button>
      </div>
    </dialog>
  )
}
