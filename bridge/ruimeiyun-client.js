/**
 * 睿美云 RM-Bridge · 客户端模块
 * ============================================================
 * 职责：封装睿美云 SaaS 的认证与调用，向上暴露「角色 + 路径 → 规范化数据」。
 * 蓝图定位：A2 决策 #11「服务层独立 Bridge」——token 池 / 脱敏 / 审计 / 字段规范化。
 *
 * 协议要点（均来自 docs/ruimeiyun/ 实测侦察，勿凭直觉改）：
 *   1. 登录三步：GET /api/v1/getPublicKey → RSA/PKCS1v15 加密密码 → POST /api/v1/login
 *   2. ★ 登录体必须带 type: 1。缺失 → 返回 20009「密码错误」（误导性错误码）
 *   3. 请求头只发 X-No-Wrap: true + lang: zh-CN；GET 不带 Content-Type
 *   4. token 是裸 JWT，Authorization 头不带 Bearer 前缀
 *   5. 一账号一会话：每次登录轮换 JWT 里的 sole，旧 token 立即失效
 *   6. 路径要加 /api 前缀：/api/v1/... 与 /api/report/v1/...
 *   7. 报表接口严格限流（>1req/2s）；限流伪装成 401「没有找到您要的资源」
 *   8. 响应大量字段被字符串化："null" / "[]" → 必须经 norm() 还原
 *
 * 凭据来源：bridge/accounts.json（gitignore）+ 环境变量，见 accounts.example.json。
 * 本模块不监听端口、不发 CORS 头，只做数据获取；对外暴露由 src/api/routes/ruimeiyun.js 负责。
 */

import http from 'http'
import https from 'https'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 账户文件可用 RM_ACCOUNTS_FILE 覆盖（多环境部署 / 联调测试用）
const ACCOUNTS_FILE = process.env.RM_ACCOUNTS_FILE || path.join(__dirname, 'accounts.json')
const AUDIT_FILE = process.env.RM_AUDIT_FILE || path.join(__dirname, 'bridge-audit.log')

// 不内置任何真实租户域名 —— host 必须来自 accounts.json（模板见 accounts.example.json）。
// 上游教训：真实标识一旦进公开仓库就收不回来（本仓库曾清除上游提交的失效 TTS key）。
const DEFAULT_HOST = ''
const SUCCESS_CODES = new Set([10000, 10001, 10002])
const REPORT_MIN_INTERVAL_MS = 1500   // 报表接口最小调用间隔
const REPORT_BACKOFF_MS = 4000        // 识别为限流后的退避
const TOKEN_REFRESH_MARGIN_MS = 6 * 3600e3  // 到期前 6 小时主动续期

// ---------------------------------------------------------------- 配置

let _accounts = null

/** 读取 accounts.json + 环境变量。密码优先取环境变量，其次取内联字段。 */
export function loadAccounts({ reload = false } = {}) {
  if (_accounts && !reload) return _accounts
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    _accounts = { host: DEFAULT_HOST, roles: {}, _missing: true }
    return _accounts
  }
  let cfg
  try {
    cfg = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'))
  } catch (e) {
    throw new Error(`accounts.json 解析失败: ${e.message}`)
  }
  const host = cfg.host || DEFAULT_HOST
  const roles = {}
  for (const [role, r] of Object.entries(cfg.roles || {})) {
    const fromEnv = r.passwordEnv ? process.env[r.passwordEnv] : undefined
    const password = fromEnv || r.password || ''
    const roleHost = r.host || host
    const protocol = String(r.protocol || 'https').toLowerCase()
    // 硬规则：http 只允许本机（自建部署/联调）。远端一律 https —— 不把凭据明文发出去。
    if (protocol === 'http' && !/^(127\.0\.0\.1|localhost|::1)$/.test(roleHost)) {
      throw new Error(`角色 ${role} 配了 protocol=http 但 host 非本机（${roleHost}）—— 拒绝明文发送凭据`)
    }
    roles[role] = {
      role,
      name: r.name || role,
      account: r.account || '',
      hospitalKey: r.hospitalKey || '',
      tenantId: String(r.tenantId || '1'),
      password,
      passwordSource: fromEnv ? `env:${r.passwordEnv}` : (r.password ? 'inline' : 'none'),
      host: roleHost,
      protocol,
      port: Number(r.port) || (protocol === 'http' ? 80 : 443),
      available: !!(r.account && password && r.hospitalKey),
    }
  }
  _accounts = { host, roles, _missing: false }
  return _accounts
}

/** 对外安全视图：绝不返回密码。 */
export function describeRoles() {
  const cfg = loadAccounts()
  return {
    configured: !cfg._missing,
    host: cfg.host,
    roles: Object.values(cfg.roles).map(r => ({
      role: r.role, name: r.name,
      account: r.account ? maskPII(r.account) : '',
      // hospitalKey（租户标识）不进状态视图 —— /rm/status 的消费方（UI/Agent）都不需要它
      tenantId: r.tenantId,
      available: r.available,
      passwordSource: r.passwordSource,
    })),
  }
}

// ---------------------------------------------------------------- 工具

/** 还原被字符串化的空值/结构。实测：空值是 "null"/"[]" 字符串，不是真 null/[]。 */
export function norm(v) {
  if (v === 'null') return null
  if (v === '[]') return []
  if (v === '{}') return {}
  if (v === 'true') return true
  if (v === 'false') return false
  if (typeof v === 'string' && /^[\[{]/.test(v)) {
    try { return JSON.parse(v) } catch { return v }
  }
  return v
}

/** 递归规范化整棵响应树。 */
export function deepNorm(v) {
  if (Array.isArray(v)) return v.map(deepNorm)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepNorm(x)]))
  }
  return norm(v)
}

/** 数字兜底：睿美云金额/计数常出现 null 或 "null" 字符串。 */
export function num(v, fallback = 0) {
  const n = Number(norm(v))
  return Number.isFinite(n) ? n : fallback
}

/** PII 打码：手机号 / 身份证 / JWT，用于审计日志。 */
export function maskPII(s) {
  return String(s)
    .replace(/\b1[3-9]\d{9}\b/g, m => m.slice(0, 3) + '****' + m.slice(-4))
    .replace(/\b\d{17}[\dXx]\b/g, '<ID_CARD>')
    .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '<JWT>')
}

function audit(role, target, ok, ms, note = '') {
  const line = `${new Date().toISOString()}\t${role}\t${ok ? 'OK' : 'FAIL'}\t${ms}ms\t${target}\t${maskPII(note)}`
  // 异步落盘：审计绝阻断业务，也绝不为它同步阻塞事件循环
  fs.promises.appendFile(AUDIT_FILE, line + '\n').catch(() => {})
}

// ---------------------------------------------------------------- HTTP

function raw(host, pathname, { method = 'GET', body, token, timeout = 25000, protocol = 'https', port } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const headers = { 'X-No-Wrap': 'true', lang: 'zh-CN' }
    if (token) headers.Authorization = token            // 裸 JWT，无 Bearer
    if (data) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(data)
    }
    const mod = protocol === 'http' ? http : https
    const req = mod.request({
      hostname: host,
      port: port || (protocol === 'http' ? 80 : 443),
      path: pathname,
      method,
      headers,
      timeout,
    }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) }
        catch { resolve({ code: -1, msg: 'non-JSON: ' + buf.slice(0, 160) }) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// ---------------------------------------------------------------- 登录 / Token 池

const pool = new Map()        // role → { token, exp, host, user, sole, name }
const inflight = new Map()    // role → Promise，防并发重复登录
const lastCallAt = new Map()  // role → 上次调用时间戳
const callQueue = new Map()   // role → Promise 链，保证同角色调用严格串行

/**
 * 同角色调用串行化。
 * 必要性：限流逻辑是「读时间戳 → sleep → 写时间戳」。若并发进入，
 * 多个调用会读到同一个旧时间戳、算出同样的延迟、然后一起发出 —— 限流失效。
 * 睿美云报表接口对此敏感（限流伪装成 401）。用 promise 链保证严格串行。
 */
function enqueue(role, fn) {
  const prev = callQueue.get(role) || Promise.resolve()
  const next = prev.then(fn, fn)          // 前一个无论成败都继续
  callQueue.set(role, next.then(() => {}, () => {}))
  return next
}

async function login(role) {
  const cfg = loadAccounts()
  const r = cfg.roles[role]
  if (!r) throw new Error(`未配置的角色: ${role}`)
  if (!r.available) {
    throw new Error(`角色 ${role} 凭据不完整（account/hospitalKey/password 需齐全，密码来源: ${r.passwordSource}）`)
  }
  const t0 = Date.now()

  const pk = await raw(r.host, '/api/v1/getPublicKey', { protocol: r.protocol, port: r.port })
  if (pk.code !== 10000 || !pk.data) {
    throw new Error('获取公钥失败: ' + JSON.stringify(pk).slice(0, 160))
  }
  const pem = crypto
    .createPublicKey({ key: Buffer.from(pk.data, 'base64'), format: 'der', type: 'spki' })
    .export({ type: 'spki', format: 'pem' })
    .toString()
  const encPwd = crypto
    .publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(r.password, 'utf8'))
    .toString('base64')

  const res = await raw(r.host, '/api/v1/login', {
    protocol: r.protocol,
    port: r.port,
    method: 'POST',
    body: {
      account: r.account,
      password: encPwd,
      hospitalKey: r.hospitalKey,
      tenantId: r.tenantId,
      type: 1,              // ★ 必需；缺失会返回误导性的 20009「密码错误」
      mac: '',
      loginType: 'PC_WEB',
    },
  })
  if (res.code !== 10000) throw new Error(`登录失败 code=${res.code} msg=${res.msg}`)

  const token = res.data.user.token
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
  const info = {
    token,
    host: r.host,
    protocol: r.protocol,
    port: r.port,
    exp: payload.exp * 1000,
    sole: payload.sole,
    user: { userNo: payload.userNo, tenantId: payload.tenant_id, id: payload.id },
    name: r.name,
  }
  pool.set(role, info)
  audit(role, 'LOGIN', true, Date.now() - t0, `sole=${payload.sole}`)
  return info
}

export async function getToken(role, { force = false } = {}) {
  const c = pool.get(role)
  if (!force && c && Date.now() < c.exp - TOKEN_REFRESH_MARGIN_MS) return c
  if (inflight.has(role)) return inflight.get(role)
  const p = login(role).finally(() => inflight.delete(role))
  inflight.set(role, p)
  return p
}

export function sessionInfo() {
  const out = {}
  for (const [role, c] of pool) {
    out[role] = { name: c.name, sole: c.sole, tokenExp: new Date(c.exp).toISOString() }
  }
  return out
}

/** 主动登出（清本地池）。睿美云无服务端登出接口。 */
export function dropSession(role) {
  if (role) pool.delete(role)
  else pool.clear()
}

// ---------------------------------------------------------------- 业务调用

/**
 * 调用睿美云接口。
 * @param {string} role   角色名
 * @param {string} pathName 路径，如 '/v1/channel/getCustomerNumber'（自动补 /api 前缀）
 * @param {{method?:string, body?:object, query?:object, normalize?:boolean}} opts
 */
export async function call(role, pathName, opts = {}) {
  return enqueue(role, () => callInner(role, pathName, opts))
}

async function callInner(role, pathName, { method = 'GET', body, query, normalize = true } = {}) {
  const t0 = Date.now()
  let url = pathName.startsWith('/api/') ? pathName : '/api' + pathName

  // 报表限流：距上次调用不足 1.5s 则退避（由 enqueue 保证此处无并发竞争）
  const last = lastCallAt.get(role)
  if (last) await new Promise(r => setTimeout(r, Math.max(0, REPORT_MIN_INTERVAL_MS - (Date.now() - last))))
  lastCallAt.set(role, Date.now())

  if (query && Object.keys(query).length) {
    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(query).toString()
  }

  const attempt = async (canRetry) => {
    const c = await getToken(role)
    const res = await raw(c.host, url, { method, body, token: c.token, protocol: c.protocol, port: c.port })

    if (res.code === 401 && canRetry) {
      const msg = res.msg || ''
      // 限流伪装成 401「没有找到您要的资源」——按报文识别，不能只靠 /report/ 路径
      // （非报表路径同样会被限流，漏判会导致无退避地重登/失败）。路径启发式保留作兜底。
      const expired = /过期|重新登/.test(msg)
      const rateLimited = /没有找到您要的资源/.test(msg) || url.includes('/report/')
      if (expired) {
        audit(role, url, false, Date.now() - t0, 'token 失效，自动重登')
        pool.delete(role)
        return attempt(false)
      }
      if (rateLimited) {
        // 报表限流伪装成 401，退避后重试一次
        audit(role, url, false, Date.now() - t0, '报表限流，退避重试')
        await new Promise(r => setTimeout(r, REPORT_BACKOFF_MS))
        return attempt(false)
      }
    }
    return res
  }

  const res = await attempt(true)
  const ok = SUCCESS_CODES.has(res.code)
  audit(role, url, ok, Date.now() - t0, ok ? '' : `code=${res.code} ${res.msg || ''}`)

  if (!ok) {
    const err = new Error(`睿美云调用失败 code=${res.code} msg=${res.msg}`)
    err.code = res.code
    err.msg = res.msg
    err.path = url
    throw err
  }
  return {
    ok: true,
    code: res.code,
    data: normalize ? deepNorm(res.data) : res.data,
    path: url,
    ms: Date.now() - t0,
  }
}

/** 调用但返回 null 而不是抛错——用于聚合场景（单个指标失败不拖垮整页）。 */
export async function tryCall(role, pathName, opts) {
  try { return await call(role, pathName, opts) }
  catch (e) { return { ok: false, error: e.message, code: e.code, path: pathName } }
}

// ---------------------------------------------------------------- 身份自检

/** 确认当前角色是谁、拿到多少权限。用于接入后的第一步验证。 */
export async function whoami(role) {
  const c = await getToken(role)
  const after = await call(role, '/v1/afterLoginLoadData', { query: { tenantId: c.user.tenantId } })
  const d = after.data || {}
  return {
    role,
    name: c.name,
    host: c.host,
    userNo: c.user.userNo,
    tenantId: c.user.tenantId,
    sole: c.sole,
    tokenExp: new Date(c.exp).toISOString(),
    perms: {
      menuList: (d.menuList || []).length,
      permList: (d.permList || []).length,
      globalConfig: (d.globalConfig || []).length,
    },
  }
}

export function isConfigured() {
  const cfg = loadAccounts()
  return Object.values(cfg.roles).some(r => r.available)
}

export function auditFilePath() { return AUDIT_FILE }
