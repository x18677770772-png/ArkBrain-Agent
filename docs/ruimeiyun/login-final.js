// 用与网页版完全一致的载荷重试登录（关键：type: 1）
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const HOST = 'bksw.hospital.realmerit.com.cn';
const ACCOUNT = process.argv[2], PASSWORD = process.argv[3];

function req(p, { method = 'GET', body, extraHeaders = {} } = {}) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    // 严格对齐客户端：只有 X-No-Wrap 和 lang，不加 Content-Type
    const h = { 'X-No-Wrap': 'true', lang: 'zh-CN', ...extraHeaders };
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = https.request({ hostname: HOST, path: p, method, headers: h, timeout: 20000 }, rs => {
      let b = ''; rs.on('data', c => b += c);
      rs.on('end', () => { try { res(JSON.parse(b)) } catch { res({ _raw: b.slice(0, 150) }) } });
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', rej);
    if (data) r.write(data); r.end();
  });
}

(async () => {
  const pk = await req('/api/v1/getPublicKey');
  const pem = crypto.createPublicKey({ key: Buffer.from(pk.data, 'base64'), format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' }).toString();
  const enc = p => crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(p, 'utf8')).toString('base64');

  const attempts = [
    ['★ 网页版完整载荷 (type:1, 无 Content-Type)', { account: ACCOUNT, password: enc(PASSWORD), hospitalKey: 'bksw9854', tenantId: '1', type: 1, mac: '', loginType: 'PC_WEB' }],
    ['  type:1 + Content-Type 头', { account: ACCOUNT, password: enc(PASSWORD), hospitalKey: 'bksw9854', tenantId: '1', type: 1, mac: '', loginType: 'PC_WEB' }, { 'Content-Type': 'application/json' }],
    ['  type:"1" 字符串', { account: ACCOUNT, password: enc(PASSWORD), hospitalKey: 'bksw9854', tenantId: '1', type: '1', mac: '', loginType: 'PC_WEB' }],
  ];

  for (const [label, body, eh] of attempts) {
    const r = await req('/api/v1/login', { method: 'POST', body, extraHeaders: eh || {} });
    const ok = r.code === 10000;
    console.log(label.padEnd(46), 'code=' + r.code, '|', r.msg, ok ? '  ✅✅✅ 登录成功！' : '');
    if (ok) {
      const d = r.data, t = d.user.token;
      fs.writeFileSync('C:/Users/Public/ruimeiyun-analysis/token.txt', t);
      console.log('\n  JWT 载荷:', Buffer.from(t.split('.')[1], 'base64').toString());
      console.log('  有效期至:', new Date(JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).exp * 1000).toLocaleString('zh-CN'));
      console.log('  用户信息:', JSON.stringify(d.user).slice(0, 500));
      console.log('  运行时配置: api_url=' + d.api_url, '| websocket=' + d.websocket_url, '| file=' + d.file_url);
      console.log('\n  → token 已写入 token.txt');
      break;
    }
  }
})();
