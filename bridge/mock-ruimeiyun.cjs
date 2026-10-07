#!/usr/bin/env node
/**
 * 睿美云 API 模拟服务器（联调用）
 * ============================================================
 * 用途：在没有真实凭据时验证 RM-Bridge 全链路 —— 登录 RSA 三步 → token → 聚合 → 字段规范化。
 * 行为刻意对齐侦察文档记录的协议细节（type:1、裸 JWT、/api 前缀、字符串化空值）。
 *
 * 启动：node bridge/mock-ruimeiyun.cjs [port]        默认 8899
 * 账号：test-admin / secret-123
 */
const http = require('http')
const crypto = require('crypto')

const PORT = Number(process.argv[2] || 8899)
const ACCOUNT = 'test-admin'
const PASSWORD = 'secret-123'

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PUB_B64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

const issued = new Set()
let loginCount = 0

function makeToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    userNo: 'U001', tenant_id: '1', id: 42,
    sole: 'sole-' + (++loginCount),                 // 每次登录轮换 sole（对齐真实行为）
    exp: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
  })
  const sig = crypto.createHmac('sha256', 'mock-secret').update(`${header}.${payload}`).digest('base64url')
  const token = `${header}.${payload}.${sig}`
  issued.add(token)
  return token
}

const ok = (data) => ({ code: 10000, msg: 'success', data })

function readBody(req) {
  return new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')) } catch { r({}) } }) })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const p = url.pathname
  const send = (obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }
  const authed = () => issued.has(req.headers.authorization || '')

  // ---- 登录三步 ----
  if (req.method === 'GET' && p === '/api/v1/getPublicKey') return send(ok(PUB_B64))

  if (req.method === 'POST' && p === '/api/v1/login') {
    const body = await readBody(req)
    // ★ 对齐真实行为：缺 type:1 直接报 20009「密码错误」（误导性错误码）
    if (body.type !== 1) return send({ code: 20009, msg: '账号或密码错误' })
    if (body.account !== ACCOUNT) return send({ code: 20009, msg: '账号或密码错误' })
    let plain = ''
    try {
      plain = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(body.password, 'base64')).toString('utf8')
    } catch { return send({ code: 20009, msg: '账号或密码错误' }) }
    if (plain !== PASSWORD) return send({ code: 20009, msg: '账号或密码错误' })
    return send(ok({ user: { token: makeToken(), userNo: 'U001' }, api_url: `http://127.0.0.1:${PORT}` }))
  }

  // ---- 其余接口都要 token ----
  if (!authed()) return send({ code: 401, msg: '身份信息已经过期，请重新登陆！' })

  if (p === '/api/v1/afterLoginLoadData') {
    return send(ok({ menuList: new Array(38).fill({}), permList: new Array(1018).fill({}), globalConfig: [{}] }))
  }
  if (p === '/api/v1/channel/getCustomerNumber') {
    return send(ok({ totalCustomers: 3428, personalPoolCount: 2321, nonPersonalPoolCount: 1125 }))
  }
  if (p === '/api/v1/msg/todayTotal') return send(ok({ msgNum: 12, tskNum: 0 }))
  if (p === '/api/v1/customerPool/customerPools') {
    return send(ok([
      { poolName: '个人池', poolType: 'personal', customerNum: 2321 },
      { poolName: '非个人池', poolType: 'nonPersonal', customerNum: 1125 },
      { poolName: '待分配', poolType: 'pending', customerNum: 486 },
    ]))
  }
  if (p === '/api/v1/channel/getAllChannel') {
    // 故意混入字符串数字与 "null" 空值 —— 验证 deepNorm 在真实管线里生效
    return send(ok([
      { channelName: '自然到店', channelType: 'offline', customerNum: '986' },
      { channelName: '老客转介', channelType: 'referral', customerNum: 742 },
      { channelName: '小红书', channelType: 'platform', customerNum: 'null' },
    ]))
  }
  if (p === '/api/report/v1/wym/celebrateCustomer/getCustomerActiveRate') {
    const b = await readBody(req)
    if (!b.year) return send({ code: 20002, msg: '参数缺失' })
    return send(ok({ average: 2041.2, customerAmount: 20412, customerNum: 10, waistRate: '10.00%' }))
  }
  if (p === '/api/report/v1/wym/celebrateCustomer/getCustomerRepurchaseRate') {
    return send(ok({ repurchaseRate: '32.40%', customerNum: 1110 }))
  }
  if (p === '/api/report/v1/wym/celebrateCustomer/getCustomerWaistRate') {
    return send(ok({ waistRate: '10.00%' }))
  }

  send({ code: 404, msg: 'no such route: ' + p }, 404)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock 睿美云已启动 http://127.0.0.1:${PORT}`)
  console.log(`账号 ${ACCOUNT} / ${PASSWORD}`)
})
