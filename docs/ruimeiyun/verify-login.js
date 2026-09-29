// 睿美云 API 登录验证（凭据从命令行参数传入，不写入任何文件）
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const HOST = 'bksw.hospital.realmerit.com.cn';
const ACCOUNT = process.argv[2];
const PASSWORD = process.argv[3];
const HOSPITAL_KEY = process.argv[4] || 'bksw9854';
const TENANT_ID = process.argv[5] || '1';

function req(p, { method = 'GET', body, headers = {}, token } = {}) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const h = { lang: 'zh-CN', 'X-No-Wrap': 'true', ...headers };
    if (token) h.Authorization = token;
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = https.request({ hostname: HOST, path: p, method, headers: h, timeout: 20000 }, rs => {
      let b = ''; rs.on('data', c => b += c);
      rs.on('end', () => { try { res({ status: rs.statusCode, json: JSON.parse(b) }) } catch { res({ status: rs.statusCode, json: { _raw: b.slice(0, 200) } }) } });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}
const mask = t => typeof t === 'string' && t.length > 40 ? t.slice(0, 24) + '…' + t.slice(-8) + ` (${t.length}字符)` : t;

(async () => {
  console.log('=== 睿美云 API 登录验证 ===');
  console.log('机构:', HOSPITAL_KEY, '| 租户:', TENANT_ID, '| 账号:', ACCOUNT, '| 密码:', '*'.repeat(String(PASSWORD).length), '\n');

  // ① 公钥
  const pk = await req('/api/v1/getPublicKey');
  console.log('[1/3] 获取 RSA 公钥 →', 'code=' + pk.json.code, pk.json.code === 10000 ? '✓' : '✗');
  if (pk.json.code !== 10000) return console.log('公钥获取失败:', JSON.stringify(pk.json));

  // ② 加密
  const pem = '-----BEGIN PUBLIC KEY-----\n' + pk.json.data.match(/.{1,64}/g).join('\n') + '\n-----END PUBLIC KEY-----';
  const enc = crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(PASSWORD, 'utf8')).toString('base64');
  console.log('[2/3] RSA/PKCS1v15 加密密码 →', enc.length, '字符密文 ✓');

  // ③ 登录
  const body = { account: ACCOUNT, phone: ACCOUNT, password: enc, hospitalKey: HOSPITAL_KEY, tenantId: TENANT_ID, mac: '', loginType: 'PC_WEB' };
  const r = await req('/api/v1/login', { method: 'POST', body });
  console.log('[3/3] POST /api/v1/login →', 'HTTP', r.status, '| code=' + r.json.code, '|', r.json.msg);
  if (r.json.code !== 10000) {
    console.log('\n❌ 登录失败，完整响应：');
    console.log(JSON.stringify(r.json, null, 2).slice(0, 800));
    return;
  }

  const d = r.json.data || {};
  const token = d.user && d.user.token;
  console.log('\n✅ 登录成功！');
  console.log('  Token      :', mask(token));
  const jwt = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  console.log('  JWT 载荷    :', JSON.stringify(jwt));
  console.log('  有效期至    :', new Date(jwt.exp * 1000).toLocaleString('zh-CN'), `(${((jwt.exp * 1000 - Date.now()) / 3600e3).toFixed(1)} 小时)`);
  console.log('\n  运行时配置  :');
  ['api_url', 'websocket_url', 'file_url', 'updater_url', 'cdn_url', 'hospital_key'].forEach(k => d[k] !== undefined && console.log('    ' + k.padEnd(15), d[k]));
  if (d.user) {
    console.log('\n  当前用户    :');
    Object.entries(d.user).forEach(([k, v]) => {
      if (k === 'token') return;
      console.log('    ' + k.padEnd(15), typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 80));
    });
  }

  fs.writeFileSync('C:/Users/Public/ruimeiyun-analysis/token.txt', token);

  // ④ 用新 token 验证几个接口
  console.log('\n=== 用新 Token 验证接口 ===');
  const t = async (label, path, opt = {}) => {
    try {
      const x = await req(path, { token, ...opt });
      const ok = [10000, 10001, 10002].includes(x.json.code);
      let extra = '';
      const dd = x.json.data;
      if (ok) {
        if (Array.isArray(dd)) extra = `${dd.length} 条`;
        else if (dd && typeof dd === 'object') extra = Object.keys(dd).slice(0, 6).join(',');
        else extra = String(dd).slice(0, 40);
      } else extra = x.json.msg;
      console.log(' ', (ok ? '✓' : '✗'), label.padEnd(22), 'code=' + x.json.code, '|', extra);
      return x.json;
    } catch (e) { console.log(' ', '✗', label.padEnd(22), 'ERR', e.message); return null; }
  };

  const after = await t('登录后聚合数据', '/api/v1/afterLoginLoadData?tenantId=' + TENANT_ID);
  if (after && after.data) {
    const a = after.data;
    console.log('     → 菜单', Array.isArray(a.menuList) ? a.menuList.length : '-',
      '| 权限点', Array.isArray(a.permList) ? a.permList.length : '-',
      '| 全局配置', Array.isArray(a.globalConfig) ? a.globalConfig.length : '-');
  }
  await t('客户总数', '/api/v1/channel/getCustomerNumber');
  const users = await t('员工列表', '/api/v1/user/userAll');
  if (users && Array.isArray(users.data)) {
    const me = users.data.filter(u => String(u.phone || '').includes(ACCOUNT) || String(u.userNo || '') === ACCOUNT);
    if (me.length) console.log('     → 本账号在员工表中的记录:', JSON.stringify(me[0]));
  }
  await t('角色树', '/api/v1/role/tree/');
  await t('科室树', '/api/v1/dept/tree');
  await t('公海池', '/api/v1/customerPool/customerPools');
  await t('登录日志', '/api/v1/sysloginlog/getpage?page=1&limit=5');

  console.log('\nToken 已保存到 token.txt（未打印完整值）');
})();
