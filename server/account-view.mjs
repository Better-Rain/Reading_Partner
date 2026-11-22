import styles from './account.css'
import { annotationScopes } from '../src/shared/types.ts'

const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])
const bookTitle = title => escape(title.replace(/\.pdf$/i, '') || title)
const readerLink = params => '/?' + escape(new URLSearchParams(params).toString())
const arrow = '<span class="arrow" aria-hidden="true">→</span>'
const brand = '<span class="brand"><span class="brand-mark" aria-hidden="true">RP</span>Reading Partner</span>'

function page(res, title, content) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Reading Partner</title><style>${styles}</style></head><body>${content}</body></html>`)
}

const notice = (message, success = false) => message ? `<p class="notice ${success ? 'success' : ''}" role="${success ? 'status' : 'alert'}">${escape(message)}</p>` : ''
const passwordInput = (label, name, isNew) => `<label>${label}<input name="${name}" type="password" autocomplete="${isNew ? 'new' : 'current'}-password" ${isNew ? 'minlength="8"' : ''} maxlength="128" required></label>`

export function showLogin(res, register, message) {
  const title = register ? '创建阅读账号' : '登录阅读账号'
  page(res, title, `<main class="login card">${brand}<h1>${title}</h1><p class="muted">书库共享，阅读记录仅自己可见。</p>
    ${notice(message)}<form method="post" action="/auth/${register ? 'register' : 'login'}">
    <label>用户名<input name="name" autocomplete="username" maxlength="48" required></label>
    ${passwordInput('密码', 'password', register)}<button class="primary">${register ? '创建账号' : '登录'}</button></form>
    <a href="${register ? '/account' : '/auth/register'}">${register ? '已有账号，去登录' : '创建新账号'}</a></main>`)
}

function readingRow(book, i) {
  const page = Number(book.page), total = Number(book.total)
  const coverId = encodeURIComponent(book.id).replace(/'/g, '%27')
  const initial = escape(Array.from(book.title.trim())[0] || '书')
  return `<li><a class="book-row" href="${readerLink({ book: book.id })}">
    <span class="cover" aria-hidden="true">${initial}<span class="cover-art" style="background-image:url('/cover/${coverId}')"></span></span>
    <span class="book-copy">${i === 0 ? '<small class="latest">上次读到</small>' : ''}<strong>${bookTitle(book.title)}</strong>
    <small>第 ${page} 页${total > 0 ? ` / 共 ${total} 页` : ''}</small>
    ${total > 0 ? `<progress aria-label="阅读位置" value="${Math.min(page, total)}" max="${total}"></progress>` : ''}</span>${arrow}</a></li>`
}

const kinds = { ...annotationScopes, highlight: '高亮', bookmark: '书签' }
function noteRow(note) {
  const kind = Object.hasOwn(kinds, note.kind) ? kinds[note.kind] : '批注'
  return `<li><a class="record" href="${readerLink({ book: note.book, page: note.page, note: note.id })}">
    <span class="record-meta"><span class="kind">${kind}</span><small>第 ${Number(note.page)} 页</small></span>
    <strong>${escape(note.excerpt || kind)}</strong><small class="source">${bookTitle(note.title)}</small></a></li>`
}
function chatRow(chat) {
  const link = readerLink(chat.book ? { book: chat.book, chat: chat.id } : { board: chat.scope, chat: chat.id })
  return `<li><a class="record" href="${link}"><strong>${escape(chat.title)}</strong>
    <small class="source">${chat.book ? '书内伴读' : '书库伴读'} · ${chat.book ? bookTitle(chat.source) : escape(chat.source)}</small></a></li>`
}
function section(title, rows, render, empty, className) {
  return `<section class="card ${className}"><h2>${title}</h2>${rows.length ? `<ul>${rows.map(render).join('')}</ul>` : `<p class="empty">${empty}</p>`}</section>`
}
export function showAccount(res, name, { stats, books, notes, chats }, message, passwordOpen) {
  page(res, '个人主页', `<div class="wrap"><header class="top">${brand}<a class="back" href="/"><span aria-hidden="true">←</span> 返回书库</a></header><main>
    <section class="hero"><div class="identity"><span aria-hidden="true" class="avatar">${escape(Array.from(name)[0].toUpperCase())}</span>
      <div><p>个人主页</p><h1>${escape(name)}</h1></div></div>
      <dl>${[['读过的书', stats.books], ['书内批注', stats.notes], ['共读对话', stats.chats]].map(([label, value]) => `<div><dt>${label}</dt><dd>${Number(value)}</dd></div>`).join('')}</dl></section>
    <div class="dashboard">${section('继续阅读', books, readingRow, '打开书库读一本书，下次就能从这里接着读。', 'reading')}
      <div class="activity">${section('最近批注', notes, noteRow, '阅读时留下的高亮、笔记和书签会出现在这里。', 'notes')}
      ${section('最近共读', chats, chatRow, '在书中或线索板开始共读后，可以从这里回到对话。', 'chats')}</div></div>
    <section class="settings card"><h2>账号设置</h2>${passwordOpen ? '' : notice(message)}
      <details${passwordOpen ? ' open' : ''}><summary>修改密码</summary>${passwordOpen ? notice(message, message === '密码已更新') : ''}
      <form method="post" action="/auth/password">${passwordInput('当前密码', 'old', false)}${passwordInput('新密码（至少 8 个字符）', 'password', true)}<button class="primary">保存新密码</button></form></details>
      <form class="logout" method="post" action="/auth/logout"><button>退出并切换账号</button></form></section>
    </main></div>`)
}