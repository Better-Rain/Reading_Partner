import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
  scrypt as derive,
} from 'node:crypto'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { showAccount, showLogin } from './account-view.mjs'
const scrypt = promisify(derive)
const hash = (value) => createHash('sha256').update(value).digest('hex')
const day = 86400000
const cookieName = '__Host-rp-user'
export async function accounts(sql, data, readOverview) {
  sql.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, device TEXT NOT NULL, uid TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);`)
  const keyFor = (pass, salt) =>
    scrypt(pass, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 ** 2 })
  async function add(id, name, password) {
    const salt = randomBytes(16).toString('hex')
    const digest = await keyFor(password, salt)
    sql
      .prepare('INSERT INTO users VALUES(?,?,?,?)')
      .run(id, name, salt, digest.toString('hex'))
  }
  if (!sql.prepare("SELECT 1 FROM users WHERE id='owner'").get()) {
    const file = join(data, 'owner-initial-password')
    let password
    try {
      password = (await readFile(file, 'utf8')).trim()
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      password = randomBytes(18).toString('base64url')
      await writeFile(file, password + '\n', { mode: 0o600, flag: 'wx' })
    }
    await add('owner', 'owner', password)
  }
  const attempts = new Map()
  function user(req, device) {
    const token = req.headers.cookie?.match(
      /(?:^|; )__Host-rp-user=([a-f0-9]{64})(?:;|$)/,
    )?.[1]
    return (
      token &&
      sql
        .prepare(
          'SELECT u.id,u.name,s.token FROM users u JOIN sessions s ON s.uid=u.id WHERE s.token=? AND s.device=? AND s.expires>?',
        )
        .get(hash(token), device, Date.now())
    )
  }
  async function form(res, route, current, message) {
    if (!current) return showLogin(res, route === '/auth/register', message)
    return showAccount(res, current.name, await readOverview(current.id), message, route === '/auth/password')
  }
  async function post(res, path, formData, device, current) {
    const redirect = () => {
      res.writeHead(303, { Location: '/' })
      res.end()
    }
    if (path === '/auth/logout') {
      if (current)
        sql.prepare('DELETE FROM sessions WHERE token=?').run(current.token)
      res.setHeader(
        'Set-Cookie',
        `${cookieName}=; Secure; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`,
      )
      return redirect()
    }
    const fail = (msg) => form(res, path, current, msg)
    const now = Date.now(),
      entry = attempts.get(device)
    const count =
      entry && entry.until > now ? entry : { n: 0, until: now + 60000 }
    attempts.set(device, count)
    if (++count.n > 15) return fail('尝试次数过多，请稍后重试')
    const name = (formData.get('name') || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase(),
      pass = formData.get('password') || ''
    if (!pass || pass.length > 128) return fail('请输入有效密码')
    if (path === '/auth/password' && current) {
      if (pass.length < 8) return fail('新密码至少需要 8 个字符')
      const u = sql.prepare('SELECT * FROM users WHERE id=?').get(current.id)
      const old = formData.get('old') || ''
      if (
        old.length > 128 ||
        !timingSafeEqual(
          await keyFor(old, u.salt),
          Buffer.from(u.digest, 'hex'),
        )
      )
        return fail('当前密码不正确')
      const salt = randomBytes(16).toString('hex'),
        digest = await keyFor(pass, salt)
      sql
        .prepare('UPDATE users SET salt=?,digest=? WHERE id=?')
        .run(salt, digest.toString('hex'), current.id)
      sql
        .prepare('DELETE FROM sessions WHERE uid=? AND token!=?')
        .run(current.id, current.token)
      return form(res, path, current, '密码已更新')
    }
    if (!['/auth/register', '/auth/login'].includes(path) || current)
      return fail('请先退出当前账号')
    if (!/^[\p{L}\p{N}_.-]{1,48}$/u.test(name))
      return fail('用户名可使用文字、数字、下划线、连字符和点')
    let u = sql.prepare('SELECT * FROM users WHERE name=?').get(name)
    if (path === '/auth/register') {
      if (pass.length < 8) return fail('密码至少需要 8 个字符')
      if (u) return fail('用户名已被使用')
      const id = randomUUID()
      try {
        await add(id, name, pass)
      } catch (e) {
        if (sql.prepare('SELECT 1 FROM users WHERE name=?').get(name))
          return fail('用户名已被使用')
        throw e
      }
      u = { id }
    } else {
      const derived = await keyFor(pass, u?.salt || 'unregistered-reader')
      if (!u || !timingSafeEqual(derived, Buffer.from(u.digest, 'hex')))
        return fail('用户名或密码不正确')
    }
    attempts.delete(device)
    const token = randomBytes(32).toString('hex')
    sql.prepare('DELETE FROM sessions WHERE expires<=?').run(now)
    sql
      .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
      .run(hash(token), device, u.id, now + 90 * day)
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${token}; Secure; HttpOnly; Path=/; SameSite=Strict; Max-Age=${90 * 86400}`,
    )
    redirect()
  }
  return { user, form, post }
}
