const https = require('https');
const fs = require('fs');
const HOST = 'bksw.hospital.realmerit.com.cn';
const TOKEN = fs.readFileSync('C:/Users/Public/ruimeiyun-analysis/token.txt', 'utf8').trim();
function req(p, { method = 'GET', body, token } = {}) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const h = { lang: 'zh-CN', 'X-No-Wrap': 'true' };
    if (token) h.Authorization = token;
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = https.request({ hostname: HOST, path: p, method, headers: h, timeout: 20000 }, rs => {
      let b = ''; rs.on('data', c => b += c);
      rs.on('end', () => { try { res(JSON.parse(b)) } catch { res({ _raw: b.slice(0, 150) }) } });
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', rej);
    if (data) r.write(data); r.end();
  });
}
(async () => {
  console.log('=== 新 Token 验证 ===');
  const tests = [
    ['客户总数', '/api/v1/channel/getCustomerNumber'],
    ['员工列表', '/api/v1/user/userAll'],
    ['公海池', '/api/v1/customerPool/customerPools'],
    ['登录后聚合', '/api/v1/afterLoginLoadData?tenantId=1'],
    ['角色树', '/api/v1/role/tree/'],
  ];
  for (const [l, p] of tests) {
    const r = await req(p, { token: TOKEN });
    const ok = [10000, 10001, 10002].includes(r.code);
    const d = r.data;
    let extra = Array.isArray(d) ? d.length + ' 条' : (d && typeof d === 'object' ? Object.keys(d).slice(0, 5).join(',') : String(d).slice(0, 30));
    console.log(' ', ok ? '✓' : '✗', l.padEnd(12), 'code=' + r.code, '|', extra);
    if (l === '登录后聚合' && r.data) {
      const a = r.data;
      console.log('     → 菜单', (a.menuList || []).length, '| 权限点', (a.permList || []).length, '| 全局配置', (a.globalConfig || []).length, '| 字段', (a.fieldList || []).length);
    }
  }

  console.log('\n=== 登录响应的真实结构（用于修正文档）===');
  const crypto = require('crypto');
  const pk = await req('/api/v1/getPublicKey');
  const pem = crypto.createPublicKey({ key: Buffer.from(pk.data, 'base64'), format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' }).toString();
  const enc = p => crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(p, 'utf8')).toString('base64');
  const r = await req('/api/v1/login', { method: 'POST', body: { account: process.argv[2], password: enc(process.argv[3]), hospitalKey: 'bksw9854', tenantId: '1', type: 1, mac: '', loginType: 'PC_WEB' } });
  if (r.code === 10000) {
    console.log('  顶层字段:', Object.keys(r).join(', '));
    console.log('  data 字段:', Object.keys(r.data).join(', '));
    for (const k of Object.keys(r.data)) {
      const v = r.data[k];
      if (v && typeof v === 'object') console.log('    ' + k.padEnd(18), Array.isArray(v) ? 'Array(' + v.length + ')' : 'Object{' + Object.keys(v).slice(0, 8).join(',') + '}');
      else console.log('    ' + k.padEnd(18), JSON.stringify(v).slice(0, 60));
    }
    fs.writeFileSync('C:/Users/Public/ruimeiyun-analysis/token.txt', r.data.user.token);
  }
})();
