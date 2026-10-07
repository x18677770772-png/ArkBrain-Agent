// /slice/* 代理测试：透传（path/query/method/body/content-type）· 413 上限 · 502 降级 · 前缀隔离。
// 用假上游注入（ARK_SLICE_PORT），不依赖 ark-api 存活 —— 3721 与 3724 两侧可独立回归。
//
// Run: node src/test-api-slice.js
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

let failed = 0
function check(cond, label) {
  if (cond) console.log(`PASS: ${label}`)
  else { console.error(`FAIL: ${label}`); failed++; process.exitCode = 1 }
}

// ---- 假上游：echo 回收到的请求形态 ----
const upstream = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      ok: true,
      echo: true,
      path: req.url,
      method: req.method,
      contentType: req.headers['content-type'] || null,
      body: Buffer.concat(chunks).toString('utf8'),
    }))
  })
})
upstream.listen(3999, '127.0.0.1')
await once(upstream, 'listening')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-api-slice-'))
process.env.ARKBRAIN_USER_DIR = tmp
process.env.ARKBRAIN_RESOURCES_DIR = process.cwd()
process.env.ARKBRAIN_HOST = '127.0.0.1'
process.env.ARK_SLICE_PORT = '3999'

let server = null
try {
  const { startAPI } = await import('./api.js')
  server = startAPI(0)
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`

  // 1) GET 透传：path + query 原样到达上游
  let r = await fetch(`${base}/slice/bootstrap?memberId=MB-2041`)
  let j = await r.json()
  check(r.status === 200 && j.ok && j.echo, 'GET 经 3721 到达上游并回传')
  check(j.path === '/slice/bootstrap?memberId=MB-2041', `query 保留（${j.path}）`)
  check(j.method === 'GET', 'method 保留')

  // 2) POST 透传：body 逐字节 + content-type 保留
  const signBody = JSON.stringify({ planId: 'PL-8841', final: ['第一行', '第二行 ✓'] })
  r = await fetch(`${base}/slice/plans/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: signBody,
  })
  j = await r.json()
  check(r.status === 200 && j.body === signBody, 'POST body 逐字节透传（含中文/符号）')
  check(j.contentType === 'application/json; charset=utf-8', 'content-type 透传')
  check(j.path === '/slice/plans/sign', 'POST path 保留')

  // 3) 请求体上限 512KB → 413
  r = await fetch(`${base}/slice/lab/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: 'MB-2041', pad: 'x'.repeat(600 * 1024) }),
  })
  j = await r.json()
  check(r.status === 413 && j.error === 'body_too_large', '超限请求体 → 413 body_too_large')

  // 4) 上游不可达 → 502 slice_unavailable（前端三态降级的触发口）
  process.env.ARK_SLICE_PORT = '3998'  // 无监听
  r = await fetch(`${base}/slice/bootstrap?memberId=MB-2041`)
  j = await r.json()
  check(r.status === 502 && j.error === 'slice_unavailable', '上游挂 → 502 slice_unavailable')
  process.env.ARK_SLICE_PORT = '3999'

  // 5) 前缀隔离：非 /slice 路径不被代理接管（404 而非 slice 响应）
  r = await fetch(`${base}/definitely-not-a-slice-route`)
  const text = await r.text()
  check(r.status === 404 && !text.includes('slice_'), '非 /slice 路径不进代理（404）')

  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
} catch (err) {
  console.error('FAIL: 异常 —', err)
  process.exitCode = 1
} finally {
  if (server) { server.close(); await once(server, 'close') }
  upstream.close()
}
