import assert from 'node:assert/strict'
import test from 'node:test'
import { avatarCrop } from '../src/lib/avatar-crop'

test('landscape and portrait can reach both ends without exposing blank space', () => {
  for (const [width, height] of [[1600, 900], [900, 1600], [800, 800]]) {
    for (const zoom of [1, 1.5, 4]) {
      const start = avatarCrop(width, height, zoom, -10000, -10000)
      const end = avatarCrop(width, height, zoom, 10000, 10000)
      assert.equal(start.x, 0)
      assert.equal(start.y, 0)
      assert.equal(end.x + end.size, width)
      assert.equal(end.y + end.size, height)
    }
  }
})

test('zoom preserves the selected subject and zooming out clamps at the edge', () => {
  const zoomed = avatarCrop(1600, 900, 4, 1300, 450)
  assert.equal(zoomed.cx, 1300)
  assert.equal(zoomed.size, 225)
  const out = avatarCrop(1600, 900, 1, zoomed.cx, zoomed.cy)
  assert.equal(out.cx, 1150)
  assert.equal(out.y, 0)
  assert.equal(out.x + out.size, 1600)
})
