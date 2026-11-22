const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const port = Number(process.env.READING_PARTNER_ELECTRON_CDP_PORT ?? 9227)
const profilePath = path.join(os.tmpdir(), `reading-partner-electron-probe-${process.pid}`)
const appDataPath = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'reading-partner')
  : path.join(os.homedir(), 'AppData', 'Roaming', 'reading-partner')
const sourceDatabasePath = path.join(appDataPath, 'reading-partner.sqlite')
const targetDatabasePath = path.join(profilePath, 'reading-partner.sqlite')
const electronBinary = require('electron')

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const waitForCdp = async () => {
  const deadline = Date.now() + 20000

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok && (await response.json()).some((item) => item.type === 'page')) {
        return
      }
    } catch {
      // Electron is still starting.
    }

    await sleep(250)
  }

  throw new Error(`Electron CDP did not become ready on port ${port}.`)
}

const stopProcess = (child) => {
  if (!child || child.exitCode !== null) return

  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

const main = async () => {
  fs.mkdirSync(profilePath, { recursive: true })
  if (fs.existsSync(sourceDatabasePath)) {
    fs.copyFileSync(sourceDatabasePath, targetDatabasePath)
  }

  const electron = spawn(
    electronBinary,
    [projectRoot, `--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`],
    { cwd: projectRoot, stdio: 'ignore', windowsHide: true }
  )

  try {
    await waitForCdp()
    const probe = spawn(process.execPath, [path.join(__dirname, 'electron-harness-probe.cjs')], {
      cwd: projectRoot,
      env: { ...process.env, READING_PARTNER_ELECTRON_CDP_PORT: String(port) },
      stdio: 'inherit'
    })
    const exitCode = await new Promise((resolve, reject) => {
      probe.on('error', reject)
      probe.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    })

    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
  } finally {
    stopProcess(electron)
    await sleep(300)
    fs.rmSync(profilePath, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
