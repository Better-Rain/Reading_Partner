import { build } from 'esbuild'
import { resolve } from 'node:path'
import { cp, readFile, writeFile } from 'node:fs/promises'
const out = 'out/cloud'
let port = 8443
try {
  const path = process.env.RP_CONNECTION_FILE || 'private-deploy/connection.json'
  port = JSON.parse(await readFile(path, 'utf8')).port
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid HTTPS port')
} catch (error) {
  if (process.env.RP_CONNECTION_FILE || error.code !== 'ENOENT') throw error
}
await build({
  entryPoints: ['server/service.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  loader: { '.css': 'text' },
  define: { RP_BUILD_PORT: String(port) },
  alias: { electron: resolve('server/runtime.mjs') },
  outfile: out + '/service.mjs',
})
await cp('out/renderer', out + '/web', { recursive: true })
await build({
  entryPoints: ['src/preload/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome100',
  alias: { electron: resolve('server/browser-transport.mjs') },
  outfile: out + '/web/bridge.js',
})
const p = out + '/web/index.html'
await writeFile(
  p,
  (await readFile(p, 'utf8')).replace(
    '<head>',
    '<head><script src="./compat.js"></script><script src="./bridge.js"></script>',
  ),
)
await cp('server/compat.js', out + '/web/compat.js')
