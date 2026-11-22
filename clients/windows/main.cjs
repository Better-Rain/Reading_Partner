const { app, BrowserWindow, session, dialog, safeStorage } = require('electron')
const { X509Certificate } = require('node:crypto')
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')
const { address, port, sshHost } = require('./connection.json')
const origin = `https://${address}:${port}`
app.setName('Reading Partner Cloud')
app.setPath('userData', join(app.getPath('appData'), 'Reading Partner Cloud'))
async function openLibrary() {
  const ses = session.defaultSession
  await ses.setProxy({ mode: 'direct' })
  const ca = new X509Certificate(readFileSync(join(__dirname, 'ca.pem')))
  ses.setCertificateVerifyProc(({ hostname, certificate }, reply) => {
    try {
      const leaf = new X509Certificate(certificate.data)
      const valid =
        hostname === address &&
        leaf.checkIP(address) &&
        leaf.verify(ca.publicKey) &&
        Date.parse(leaf.validFrom) <= Date.now() &&
        Date.now() < Date.parse(leaf.validTo)
      reply(valid ? 0 : -2)
    } catch {
      reply(-2)
    }
  })
  const keyPath = join(app.getPath('userData'), 'device.bin')
  const token = existsSync(keyPath)
    ? safeStorage.decryptString(readFileSync(keyPath))
    : execFileSync(
        'ssh.exe',
        [
          '-o',
          'BatchMode=yes',
          '-o',
          'ConnectTimeout=6',
          sshHost,
          'cat ~/ReadingPartner/data/windows.pair',
        ],
        { encoding: 'utf8', windowsHide: true },
      ).trim()
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('此设备尚未配对')
  if (!existsSync(keyPath))
    writeFileSync(keyPath, safeStorage.encryptString(token))
  await ses.cookies.set({
    url: origin,
    name: '__Host-rp',
    value: token,
    secure: true,
    httpOnly: true,
    path: '/',
    sameSite: 'strict',
  })
  const win = new BrowserWindow({
    title: 'Reading Partner · 私人书库',
    icon: join(__dirname, 'icon.ico'),
    width: 1440,
    height: 960,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault()
  })
  for (;;) {
    try {
      await win.loadURL(origin)
      return
    } catch {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        message: '无法连接 Mac 书库，请检查私人网络连接。',
        buttons: ['重试', '关闭'],
      })
      if (response) {
        win.close()
        return
      }
    }
  }
}
app
  .whenReady()
  .then(openLibrary)
  .catch((e) => {
    dialog.showErrorBox('Reading Partner', e.message)
    app.quit()
  })
app.on('window-all-closed', () => app.quit())
