/**
 * 睿美云 RM-Bridge · HTTP 路由
 * ============================================================
 * 把 bridge/ 模块的能力暴露到本地 3721，让前端只跟 3721 说话。
 *
 * 为什么不直接让前端调 RM-Bridge：
 *   侦察脚本里的 bridge 开了 Access-Control-Allow-Origin: *，
 *   意味着用户浏览任意网站时，那个页面都能直连 127.0.0.1 拉走睿美云数据。
 *   走 3721 则复用既有的 origin 门控 + token 校验，没有这个洞。
 *
 * 鉴权：这些路径不在 isPublicPath 里 → LAN 请求必须带 token（与 /memories 等同级）。
 */

import { jsonResponse, readJsonBody } from '../utils.js'
import { fetchCockpit, probe } from '../../../bridge/cockpit.js'
import {
  describeRoles, isConfigured, sessionInfo, whoami, call, dropSession,
} from '../../../bridge/ruimeiyun-client.js'

// 驾驶舱冷启动要打 ~7 个接口、受 1.5s 限流串行约束（约 10s）。
// 加 TTL 缓存，避免每次开面板都等满 10 秒。
const CACHE_TTL_MS = 60_000
const cache = new Map()   // cacheKey → { at, data }

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > (hit.ttl ?? CACHE_TTL_MS)) { cache.delete(key); return null }
  return hit.data
}
function cacheSet(key, data, ttl = CACHE_TTL_MS) { cache.set(key, { at: Date.now(), data, ttl }) }

/**
 * 通用代理的路径守卫：只放行睿美云的业务路径，避免变成任意转发器。
 * v1/v2 + report 精确前缀（与错误文案一致），并拒绝 `..` 与 `//`，
 * 防止规范化差异把 /rm/call 变成开放代理。hostname 由 client 固定，此处是纵深防御。
 */
const ALLOWED_PROXY_PATH = /^\/(?:v[12]\/|report\/)/
export function isAllowedProxyPath(p) {
  return typeof p === 'string' && !p.includes('..') && !p.includes('//') && ALLOWED_PROXY_PATH.test(p)
}

export async function handleRuimeiyunRoutes(req, res, url) {
  const { pathname } = url
  if (!pathname.startsWith('/rm/') && pathname !== '/rm') return false

  // ---------------------------------------------------------- 状态（不含凭据）
  if (req.method === 'GET' && pathname === '/rm/status') {
    const roles = describeRoles()
    jsonResponse(res, 200, {
      ok: true,
      configured: isConfigured(),
      host: roles.host,
      accountsFilePresent: roles.configured,
      roles: roles.roles,
      sessions: sessionInfo(),
    })
    return true
  }

  // ---------------------------------------------------------- 连通性探针
  if (req.method === 'GET' && pathname === '/rm/probe') {
    if (!isConfigured()) {
      jsonResponse(res, 200, { ok: false, reason: 'not_configured', hint: '请先创建 bridge/accounts.json 并填入凭据' })
      return true
    }
    try {
      jsonResponse(res, 200, await probe(url.searchParams.get('role') || 'admin'))
    } catch (err) {
      jsonResponse(res, 502, { ok: false, error: err.message })
    }
    return true
  }

  // ---------------------------------------------------------- 身份自检
  if (req.method === 'GET' && pathname === '/rm/whoami') {
    if (!isConfigured()) {
      jsonResponse(res, 200, { ok: false, reason: 'not_configured' })
      return true
    }
    try {
      jsonResponse(res, 200, { ok: true, ...(await whoami(url.searchParams.get('role') || 'admin')) })
    } catch (err) {
      jsonResponse(res, 502, { ok: false, error: err.message })
    }
    return true
  }

  // ---------------------------------------------------------- 驾驶舱聚合
  if (req.method === 'GET' && pathname === '/rm/cockpit') {
    const role = url.searchParams.get('role') || 'admin'
    const year = url.searchParams.get('year') || String(new Date().getFullYear())
    const refresh = /^(1|true|yes)$/i.test(url.searchParams.get('refresh') || '')

    if (!isConfigured()) {
      // 未配置不是错误 —— 前端据此降级到 seed 数据
      jsonResponse(res, 200, { ok: false, reason: 'not_configured', hint: '请先创建 bridge/accounts.json 并填入凭据' })
      return true
    }

    const key = `${role}:${year}`
    if (!refresh) {
      const hit = cacheGet(key)
      if (hit) { jsonResponse(res, 200, { ok: true, cached: true, ...hit }); return true }
    }

    try {
      const data = await fetchCockpit(role, { year })
      // 失败/残缺结果短缓存：上游瞬时抖动不放大成 60s 陈旧失败，也不至于每次切换都打满上游
      const degraded = data?.meta?.source === 'unavailable' || data?.meta?.partial === true
      cacheSet(key, data, degraded ? 10_000 : CACHE_TTL_MS)
      jsonResponse(res, 200, { ok: true, cached: false, ...data })
    } catch (err) {
      jsonResponse(res, 502, { ok: false, error: err.message })
    }
    return true
  }

  // ---------------------------------------------------------- 通用代理（Agent 用）
  if (pathname === '/rm/call') {
    let payload = {}
    if (req.method === 'POST') {
      try { payload = await readJsonBody(req, { maxBytes: 64 * 1024 }) } catch { payload = {} }
    } else if (req.method !== 'GET') {
      jsonResponse(res, 405, { ok: false, error: 'method not allowed' })
      return true
    }
    for (const [k, v] of url.searchParams) if (!(k in payload)) payload[k] = v

    const { role = 'admin', path: target, method = 'GET', body, query } = payload
    if (!target) { jsonResponse(res, 400, { ok: false, error: '需要 path 参数' }); return true }
    if (!isAllowedProxyPath(target)) {
      jsonResponse(res, 400, { ok: false, error: 'path 必须以 /v1/、/v2/ 或 /report/ 开头' })
      return true
    }
    if (!isConfigured()) {
      jsonResponse(res, 200, { ok: false, reason: 'not_configured' })
      return true
    }
    try {
      const r = await call(role, target, { method, body, query })
      jsonResponse(res, 200, { ok: true, code: r.code, data: r.data, ms: r.ms })
    } catch (err) {
      jsonResponse(res, 502, { ok: false, error: err.message, code: err.code ?? null })
    }
    return true
  }

  // ---------------------------------------------------------- 会话管理
  if (req.method === 'POST' && pathname === '/rm/session/drop') {
    try {
      const body = await readJsonBody(req, { maxBytes: 8 * 1024 })
      dropSession(body.role || null)
      jsonResponse(res, 200, { ok: true, sessions: sessionInfo() })
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message })
    }
    return true
  }

  return false
}
