/**
 * A5 切片代理 —— /slice/* → ark-api (127.0.0.1:3724)
 * ============================================================
 * 为什么不让浏览器直连 3724（与 routes/ruimeiyun.js 头注释同款理由）：
 * 经 3721 则 origin 门 / token 门 / 敏感写 CSRF 门全部复用（/slice/ 已进
 * isSensitivePath），本模块自身零鉴权逻辑，只做字节转发。
 *
 * 边界：请求体上限 512KB（切片端点都是小 JSON）；上游超时 10s；
 * 上游不可达 → 502 slice_unavailable（前端三态据此降级种子，绝不假成功）。
 * ark-api 端口默认 3724，可用 ARK_SLICE_PORT 覆盖（测试注入假上游）。
 */
import http from 'node:http'
import { jsonResponse } from '../utils.js'

const MAX_BODY_BYTES = 512 * 1024
const UPSTREAM_TIMEOUT_MS = 10_000

function upstreamPort() {
  const p = Number(process.env.ARK_SLICE_PORT)
  return Number.isInteger(p) && p > 0 ? p : 3724
}

/**
 * 有界读body：超限 pause + 413，**不 destroy 连接**（readRawBody 超限会
 * req.destroy() → 客户端 ECONNRESET 收不到 413 —— 代理必须先把响应发出去）。
 * content-length 预检命中时根本不读 body，直接 413。
 */
function readBodyLimited(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0)
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      const err = new Error('body too large')
      err.statusCode = 413
      reject(err)
      return
    }
    const chunks = []
    let size = 0
    let done = false
    const fail = (err) => { if (!done) { done = true; reject(err) } }
    req.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.pause()
        const err = new Error('body too large')
        err.statusCode = 413
        fail(err)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)) } })
    req.on('error', fail)
  })
}

function forward(req, url, body) {
  return new Promise((resolve, reject) => {
    const headers = { accept: 'application/json' }
    const contentType = req.headers['content-type']
    if (contentType) headers['content-type'] = contentType
    if (body && body.length) headers['content-length'] = String(body.length)

    const proxyReq = http.request({
      host: '127.0.0.1',
      port: upstreamPort(),
      method: req.method,
      path: url.pathname + (url.search || ''),
      headers,
    }, (proxyRes) => {
      const chunks = []
      proxyRes.on('data', (c) => chunks.push(c))
      proxyRes.on('end', () => resolve({
        status: proxyRes.statusCode || 502,
        contentType: proxyRes.headers['content-type'] || 'application/json; charset=utf-8',
        body: Buffer.concat(chunks),
      }))
      proxyRes.on('error', reject)
    })
    proxyReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => proxyReq.destroy(Object.assign(
      new Error('ark-api 超时'), { code: 'ETIMEDOUT' })))
    proxyReq.on('error', reject)
    if (body && body.length) proxyReq.write(body)
    proxyReq.end()
  })
}

export async function handleSliceRoutes(req, res, url) {
  const { pathname } = url
  if (!pathname.startsWith('/slice/') && pathname !== '/slice') return false

  let body = null
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await readBodyLimited(req)
    } catch (err) {
      if (err.statusCode === 413) {
        jsonResponse(res, 413, { ok: false, error: 'body_too_large' })
        return true
      }
      jsonResponse(res, 400, { ok: false, error: 'bad_body' })
      return true
    }
  }

  try {
    const upstream = await forward(req, url, body)
    res.writeHead(upstream.status, { 'Content-Type': upstream.contentType })
    res.end(upstream.body)
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.code === 'ENOTFOUND') {
      jsonResponse(res, 502, { ok: false, error: 'slice_unavailable' })
    } else if (err.code === 'ETIMEDOUT') {
      jsonResponse(res, 504, { ok: false, error: 'slice_timeout' })
    } else {
      jsonResponse(res, 502, { ok: false, error: 'slice_upstream_error' })
    }
  }
  return true
}
