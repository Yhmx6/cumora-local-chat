import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { loadAll } from 'js-yaml'

test('boot backfill does not run before listen, and shutdown closes sockets', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  const main = source.slice(source.indexOf('async function main()'))
  const listen = main.indexOf('server.listen(')
  assert.ok(listen > 0)
  assert.ok(main.indexOf('await seedIfEmpty()') === -1)
  assert.ok(main.indexOf('runBootBackfill()') > listen)
  assert.match(main, /socket\.close\(1001/)
  assert.match(main, /server\.close\(/)
  assert.match(main, /stopEmailGcWorker\(\)/)
})

test('both server manifests sleep before SIGTERM and allow 60s to finish', async () => {
  for (const path of ['../../k8s/cumora-server.gke.yaml', '../../k8s/cumora-server.orbstack.yaml']) {
    const docs = loadAll(await readFile(new URL(path, import.meta.url), 'utf8')) as Array<Record<string, unknown>>
    const deployment = docs.find((doc) => doc.kind === 'Deployment')
    const spec = (((deployment?.spec as { template?: { spec?: Record<string, unknown> } } | undefined)?.template?.spec) ?? {})
    assert.equal(spec.terminationGracePeriodSeconds, 60, path)
    const containers = spec.containers as Array<Record<string, unknown>>
    const server = containers.find((container) => container.name === 'server')
    const command = (((server?.lifecycle as { preStop?: { exec?: { command?: string[] } } } | undefined)?.preStop?.exec?.command))
    assert.deepEqual(command, ['sleep', '15'], path)
  }
})
