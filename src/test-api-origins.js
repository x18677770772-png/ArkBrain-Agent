// HTTP 门禁矩阵测试：ARKBRAIN_EXTRA_ALLOWED_ORIGINS 白名单 × 敏感面口令 × CSRF
// 与 test-websocket-security.js 的 WS 用例互补 —— HTTP 三条路径
// （isAllowedOrigin / requireLocalOrToken / isForbiddenSensitiveWrite）此前零覆盖。
import assert from 'assert/strict'

const TEST_TOKEN = 'api-origins-test-secret'
process.env.ARKBRAIN_API_TOKEN = TEST_TOKEN
process.env.ARKBRAIN_EXTRA_ALLOWED_ORIGINS = '*.trycloudflare.com'

const { startAPI } = await import('./api.js')

const TUNNEL = 'https://foo-123.trycloudflare.com'
const EVIL = 'https://evil.example'
const LOCAL = 'http://127.0.0.1:3721'
let passed = 0

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  PASS ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`)
    throw err
  }
}

const server = startAPI(0)
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve))
const base = `http://127.0.0.1:${server.address().port}`

async function req(path, { origin, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return {
    status: res.status,
    acao: res.headers.get('access-control-allow-origin'),
    text: await res.text(),
  }
}

try {
  await test('whitelist origin: non-sensitive GET passes and reflects ACAO', async () => {
    const r = await req('/status', { origin: TUNNEL })
    assert.equal(r.status, 200)
    assert.equal(r.acao, TUNNEL)
  })

  await test('whitelist origin: sensitive GET without token is rejected', async () => {
    assert.equal((await req('/settings', { origin: TUNNEL })).status, 403)
    assert.equal((await req('/settings/tts', { origin: TUNNEL })).status, 403)
    assert.equal((await req('/settings/security', { origin: TUNNEL })).status, 403)
    assert.equal((await req('/conversations', { origin: TUNNEL })).status, 403)
  })

  await test('whitelist origin: sensitive GET with Bearer token passes', async () => {
    const r = await req('/settings', { origin: TUNNEL, headers: { Authorization: `Bearer ${TEST_TOKEN}` } })
    assert.equal(r.status, 200)
    const q = await req('/settings/tts?token=' + encodeURIComponent(TEST_TOKEN), { origin: TUNNEL })
    assert.equal(q.status, 200)
  })

  await test('evil origin is rejected even with token (CSRF)', async () => {
    const r = await req('/status', { origin: EVIL })
    assert.equal(r.status, 403)
    assert.equal(r.acao, null)
    const s = await req('/settings', { origin: EVIL, headers: { Authorization: `Bearer ${TEST_TOKEN}` } })
    assert.equal(s.status, 403)
  })

  await test('loopback origin and originless local client keep full access', async () => {
    assert.equal((await req('/settings', { origin: LOCAL })).status, 200)
    assert.equal((await req('/settings')).status, 200)
  })

  await test('cross-site write on sensitive path is rejected even with token', async () => {
    const r = await req('/settings/temperature', {
      origin: TUNNEL,
      method: 'POST',
      body: { temperature: 0.5 },
      headers: {
        'Sec-Fetch-Site': 'cross-site',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
    })
    assert.equal(r.status, 403)
    // 同源浏览器写 + 口令（带口令链接的正常保存路径）放行
    const ok = await req('/settings/temperature', {
      origin: TUNNEL,
      method: 'POST',
      body: { temperature: 0.5 },
      headers: {
        'Sec-Fetch-Site': 'same-origin',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
    })
    assert.equal(ok.status, 200)
    // 同源但无口令的敏感写仍拒（敏感面永远要口令）
    const noTok = await req('/settings/temperature', {
      origin: TUNNEL,
      method: 'POST',
      body: { temperature: 0.5 },
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    })
    assert.equal(noTok.status, 403)
  })

  await test('without env allowlist the tunnel origin loses non-sensitive access too', async () => {
    const prev = process.env.ARKBRAIN_EXTRA_ALLOWED_ORIGINS
    try {
      delete process.env.ARKBRAIN_EXTRA_ALLOWED_ORIGINS
      assert.equal((await req('/status', { origin: TUNNEL })).status, 403)
    } finally {
      process.env.ARKBRAIN_EXTRA_ALLOWED_ORIGINS = prev
    }
  })

  console.log(`HTTP origin/token gates: ${passed} passed, 0 failed`)
} finally {
  for (const ws of server.clients || []) ws.terminate?.()
  await new Promise((resolve) => server.close(resolve))
}
