/**
 * 系统性只读探测：验证每个业务域的关键接口是否可用、需要什么参数、返回什么结构
 * 严格只读：仅 GET 与「列表类 POST」，且已排除 add/update/delete/export 等
 */
const https = require('https');
const fs = require('fs');
const HOST = 'bksw.hospital.realmerit.com.cn';
const TOKEN = fs.readFileSync('C:/Users/Public/ruimeiyun-analysis/token.txt', 'utf8').trim();

const cands = JSON.parse(fs.readFileSync('C:/Users/Public/ruimeiyun-analysis/probe-candidates.json', 'utf8'));
// 每模块限流：报表类最多 8，其余最多 4
const perMod = {};
const list = [];
for (const c of cands) {
  const cap = c.module === '报表统计' ? 8 : 4;
  perMod[c.module] = perMod[c.module] || 0;
  if (perMod[c.module] >= cap) continue;
  perMod[c.module]++; list.push(c);
}
console.log('探测目标:', list.length, '个接口\n');

function raw(p, { method = 'GET', body } = {}) {
  return new Promise((res) => {
    const data = body ? JSON.stringify(body) : null;
    const h = { 'X-No-Wrap': 'true', lang: 'zh-CN', Authorization: TOKEN, tenant: '1' };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = https.request({ hostname: HOST, path: '/api' + p, method, headers: h, timeout: 15000 }, rs => {
      let b = ''; rs.on('data', c => b += c);
      rs.on('end', () => { try { res(JSON.parse(b)) } catch { res({ code: -1, msg: 'non-JSON' }) } });
    });
    r.on('timeout', () => { r.destroy(); res({ code: -2, msg: 'timeout' }) });
    r.on('error', e => res({ code: -3, msg: e.message }));
    if (data) r.write(data);
    r.end();
  });
}
const mask = s => String(s).replace(/\b1[3-9]\d{9}\b/g, m => m.slice(0, 3) + '****' + m.slice(-4))
  .replace(/\b\d{15,19}\b/g, '<NUM>').replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '<JWT>');

function shape(d, depth = 0) {
  if (d === null) return 'null';
  if (Array.isArray(d)) return d.length ? `Array(${d.length}) of ${typeof d[0] === 'object' && d[0] ? '{' + Object.keys(d[0]).slice(0, 6).join(',') + '}' : typeof d[0]}` : 'Array(0)';
  if (typeof d === 'object') { const k = Object.keys(d); return `Object{${k.slice(0, 8).join(',')}${k.length > 8 ? ',…+' + (k.length - 8) : ''}}`; }
  return typeof d + (typeof d === 'string' ? `(${d.slice(0, 24)})` : `(${d})`);
}

(async () => {
  const out = [];
  let i = 0;
  for (const c of list) {
    i++;
    const isPost = (c.methods || []).includes('POST') && !(c.methods || []).includes('GET');
    let r, usedBody = null;
    if (isPost) {
      r = await raw(c.path, { method: 'POST', body: { page: 1, limit: 3 } });
      usedBody = '{page,limit}';
      if (r.code === 20002 || (r.msg || '').includes('系统开小差')) {
        const r2 = await raw(c.path, { method: 'POST', body: { current: 1, size: 3 } });
        if ([10000, 10001, 10002].includes(r2.code)) { r = r2; usedBody = '{current,size}'; }
      }
    } else {
      r = await raw(c.path, { method: 'GET' });
      usedBody = 'none';
    }
    const ok = [10000, 10001, 10002].includes(r.code);
    out.push({
      path: c.path, method: isPost ? 'POST' : 'GET', module: c.module,
      ok, code: r.code, msg: r.msg, params: ok ? usedBody : usedBody,
      shape: ok ? shape(r.data) : null,
      sample: ok && r.data != null ? mask(JSON.stringify(r.data).slice(0, 320)) : null,
    });
    process.stdout.write(ok ? '.' : 'x');
    if (i % 60 === 0) process.stdout.write(' ' + i + '\n');
    await new Promise(r => setTimeout(r, 120));   // 节流
  }
  console.log('\n\n探测完成:', out.filter(o => o.ok).length, '/', out.length, '可用');
  fs.writeFileSync('C:/Users/Public/ruimeiyun-analysis/probe-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), host: HOST, total: out.length, ok: out.filter(o => o.ok).length, results: out }, null, 1));
  console.log('已写入 probe-results.json');
})();
