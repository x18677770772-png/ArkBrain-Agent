/**
 * 睿美云 · 多角色登录 Bridge 服务
 * ------------------------------------------------------------
 * 作用：让 AI Agent 以「不同角色账号」调用睿美云 API，而无需接触密码/Token。
 *
 * 关键实现（均已实测验证）：
 *   1. 登录三步：GET /v1/getPublicKey → RSA/PKCS1v15 加密 → POST /v1/login
 *   2. ★ 登录请求必须带 type: 1（网页版表单字段，缺失会返回 20009 密码错误）
 *   3. 一账号一会话：每次登录会轮换 JWT 里的 sole，旧 token 立即失效
 *      → 每个角色独立账号 + 401 自动重登
 *   4. 响应字段「字符串化」：大量空值是字符串 "null" / "[]"，统一用 norm() 规范化
 *
 * 密码只从环境变量读取，不落盘。
 * 启动：node bridge/multi-role-server.js
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.BRIDGE_PORT || 8900);
const CONFIG = path.join(__dirname, 'accounts.json');
const AUDIT = path.join(__dirname, 'bridge-audit.log');
const DEFAULT_HOST = 'bksw.hospital.realmerit.com.cn';

// ---------- 配置 ----------
function loadRoles() {
  if (!fs.existsSync(CONFIG)) { console.error('缺少 accounts.json（可从 accounts.example.json 复制）'); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const roles = {};
  for (const [role, r] of Object.entries(cfg.roles || {})) {
    const pwd = process.env[r.passwordEnv];
    roles[role] = { ...r, password: pwd, host: r.host || DEFAULT_HOST };
    if (!pwd) console.warn(`⚠️  角色 ${role} 缺少环境变量 ${r.passwordEnv}，该角色将不可用`);
  }
  return roles;
}
const ROLES = loadRoles();

// ---------- 工具 ----------
const norm = v => v === 'null' ? null
  : v === '[]' ? []
  : (typeof v === 'string' && /^[\[{]/.test(v)) ? (() => { try { return JSON.parse(v) } catch { return v } })()
  : v;

const maskPII = s => String(s)
  .replace(/\b1[3-9]\d{9}\b/g, m => m.slice(0, 3) + '****' + m.slice(-4))
  .replace(/\b\d{17}[\dXx]\b/g, '<ID_CARD>')
  .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '<JWT>');

function audit(role, pathName, ok, ms, note = '') {
  const line = `${new Date().toISOString()}\t${role}\t${ok ? 'OK' : 'FAIL'}\t${ms}ms\t${pathName}\t${maskPII(note)}`;
  fs.appendFileSync(AUDIT, line + '\n');
  console.log(line);
}

// ---------- HTTP ----------
function raw(host, p, { method = 'GET', body, token, timeout = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    // 严格对齐客户端：只发 X-No-Wrap 与 lang（POST 时才带 Content-Type）
    const headers = { 'X-No-Wrap': 'true', lang: 'zh-CN' };
    if (token) headers.Authorization = token;          // 注意：裸 JWT，无 Bearer
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = https.request({ hostname: host, path: p, method, headers, timeout }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch { resolve({ code: -1, msg: 'non-JSON: ' + b.slice(0, 120) }) } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---------- 登录 & Token 池 ----------
const pool = new Map();   // role → { token, exp, host, user, sole }
const inflight = new Map();
const lastCallAt = new Map();   // 角色 → 上次调用时间（报表限流退避用）

async function login(role) {
  const r = ROLES[role];
  if (!r) throw new Error('未配置的角色: ' + role);
  if (!r.password) throw new Error(`角色 ${role} 缺少密码环境变量 ${r.passwordEnv}`);
  const t0 = Date.now();

  const pk = await raw(r.host, '/api/v1/getPublicKey');
  if (pk.code !== 10000 || !pk.data) throw new Error('获取公钥失败: ' + JSON.stringify(pk).slice(0, 120));

  const pem = crypto.createPublicKey({ key: Buffer.from(pk.data, 'base64'), format: 'der', type: 'spki' })
    .export({ type: 'spki', format: 'pem' }).toString();
  const encPwd = crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(r.password, 'utf8')).toString('base64');

  const res = await raw(r.host, '/api/v1/login', {
    method: 'POST',
    body: {
      account: r.account,
      password: encPwd,
      hospitalKey: r.hospitalKey,
      tenantId: String(r.tenantId || '1'),
      type: 1,                    // ★★★ 必需字段：缺失 → 20009 密码错误
      mac: '',
      loginType: 'PC_WEB',
    },
  });
  if (res.code !== 10000) throw new Error(`登录失败 code=${res.code} msg=${res.msg}`);

  const token = res.data.user.token;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  const info = {
    token, host: r.host, exp: payload.exp * 1000, sole: payload.sole,
    user: { userNo: payload.userNo, tenantId: payload.tenant_id, id: payload.id },
    name: r.name || role,
  };
  pool.set(role, info);
  audit(role, 'LOGIN', true, Date.now() - t0, `sole=${payload.sole}`);
  return info;
}

async function getToken(role) {
  const c = pool.get(role);
  if (c && Date.now() < c.exp - 6 * 3600e3) return c;      // 到期前 6 小时主动续期
  if (inflight.has(role)) return inflight.get(role);
  const p = login(role).finally(() => inflight.delete(role));
  inflight.set(role, p);
  return p;
}

/** 带 401 自动重登的调用 */
async function call(role, pathName, { method = 'GET', body, query } = {}) {
  const t0 = Date.now();
  // ★ 真实 API 路径必须带 /api 前缀（https://{host}/api/v1/... /api/report/v1/...）
  let url = pathName.startsWith('/api/') ? pathName : '/api' + pathName;
  // 报表服务限流严格：间隔不足时主动退避，并把「401 资源不存在」识别为限流信号重试一次
  await new Promise(r => setTimeout(r, lastCallAt.has(role) ? Math.max(0, 1500 - (Date.now() - lastCallAt.get(role))) : 0));
  lastCallAt.set(role, Date.now());
  if (query && Object.keys(query).length) {
    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(query).toString();
  }
  const doIt = async (retry) => {
    const c = await getToken(role);
    const res = await raw(c.host, url, { method, body, token: c.token });
    // 401 两种含义：token 失效（重登）或报表限流的伪装响应（仅重试，不重登）
    if (res.code === 401 && retry) {
      const isExpired = /过期|重新登/.test(res.msg || '');
      if (isExpired) { audit(role, url, false, Date.now() - t0, 'token 失效，自动重登'); pool.delete(role); return doIt(false); }
      if (url.includes('/report/')) {   // 报表限流：退避 4s 重试
        audit(role, url, false, Date.now() - t0, '报表限流，退避重试');
        await new Promise(r => setTimeout(r, 4000));
        return doIt(false);
      }
    }
    return res;
  };
  const res = await doIt(true);
  const ok = [10000, 10001, 10002].includes(res.code);
  audit(role, url, ok, Date.now() - t0, ok ? '' : `code=${res.code} ${res.msg || ''}`);
  return res;
}

// ---------- 限流（每角色 5 req/s）----------
const rl = new Map();
function rateLimit(role) {
  const now = Date.now();
  const arr = (rl.get(role) || []).filter(t => now - t < 1000);
  if (arr.length >= 5) return false;
  arr.push(now); rl.set(role, arr);
  return true;
}

// ---------- HTTP 服务 ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (code, obj) => {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end(JSON.stringify(obj, null, 2));
  };
  if (req.method === 'OPTIONS') return send(204, {});

  try {
    // 健康检查
    if (u.pathname === '/health') {
      return send(200, {
        ok: true,
        roles: Object.keys(ROLES).map(r => ({
          role: r, name: ROLES[r].name, account: ROLES[r].account,
          hasPassword: !!ROLES[r].password,
          session: pool.get(r) ? { exp: new Date(pool.get(r).exp).toISOString(), sole: pool.get(r).sole } : null,
        })),
      });
    }

    // 角色列表（不含任何凭据）
    if (u.pathname === '/roles') {
      return send(200, Object.entries(ROLES).map(([r, v]) => ({
        role: r, name: v.name, hospitalKey: v.hospitalKey, tenantId: v.tenantId, available: !!v.password,
      })));
    }

    // 身份自检：确认当前角色是谁、权限有多少
    if (u.pathname === '/whoami') {
      const role = u.searchParams.get('role');
      if (!role) return send(400, { error: '缺少 role 参数' });
      const c = await getToken(role);
      const after = await call(role, '/v1/afterLoginLoadData', { query: { tenantId: c.user.tenantId } });
      const d = after.data || {};
      return send(200, {
        role, name: c.name, host: c.host,
        userNo: c.user.userNo, tenantId: c.user.tenantId, sole: c.sole,
        tokenExp: new Date(c.exp).toISOString(),
        perms: { menuList: (d.menuList || []).length, permList: (d.permList || []).length, globalConfig: (d.globalConfig || []).length },
      });
    }

    // 通用代理调用
    if (u.pathname === '/api/call') {
      let payload = {};
      if (req.method === 'POST') {
        payload = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')) } catch { r({}) } }) });
      } else {
        for (const [k, v] of u.searchParams) payload[k] = v;
      }
      const { role, path: p, method = (payload.body ? 'POST' : 'GET'), body, query } = payload;
      if (!role || !p) return send(400, { error: '需要 role 与 path 参数' });
      if (!ROLES[role]) return send(403, { error: '未授权的角色: ' + role });
      if (!/^\/(v\d|report)\//.test(p)) return send(400, { error: 'path 必须以 /v1/、/v2/ 或 /report/ 开头' });
      if (!rateLimit(role)) return send(429, { error: '超出限流（5 req/s/角色）' });
      const r = await call(role, p, { method, body, query });
      return send(200, { ok: [10000, 10001, 10002].includes(r.code), code: r.code, msg: r.msg, data: r.data });
    }

    // 规范化辅助：把 "null"/"[]" 字符串转回真实类型（供 Agent 使用）
    if (u.pathname === '/api/normalize') {
      let payload = {};
      if (req.method === 'POST') payload = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')) } catch { r({}) } }) });
      const deep = v => Array.isArray(v) ? v.map(deep)
        : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]))
        : norm(v);
      return send(200, deep(payload));
    }

    return send(404, { error: '未知路径', endpoints: ['/health', '/roles', '/whoami?role=', '/api/call', '/api/normalize'] });
  } catch (e) {
    audit('?', req.url, false, 0, e.message);
    return send(500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`睿美云多角色 Bridge 已启动: http://127.0.0.1:${PORT}`);
  console.log('已配置角色:', Object.entries(ROLES).map(([r, v]) => `${r}(${v.name}${v.password ? '' : ' ⚠️无密码'})`).join(', '));
  console.log('\n端点: GET /health | GET /roles | GET /whoami?role=x | POST /api/call | POST /api/normalize');
});
