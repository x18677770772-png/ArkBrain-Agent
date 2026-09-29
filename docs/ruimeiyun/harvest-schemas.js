// 结构采样器 v2：抓取已验证端点的完整响应结构（自动脱敏 + 大对象保护 + 客户ID自动发现）
const https = require('https');
const fs = require('fs');
const HOST = 'bksw.hospital.realmerit.com.cn';
const TOKEN = process.argv[2];
const CID_ARG = process.argv[3] || '';
const PROBE_PHONE = process.argv[4] || '';
const H = { Authorization: TOKEN, tenant: '1', lang: 'zh-CN', 'Content-Type': 'application/json', 'X-No-Wrap': 'true' };

function call(method, path, body, timeout = 20000) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { ...H };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = https.request({ hostname: HOST, path, method, headers, timeout }, rs => {
      let b = ''; rs.on('data', c => b += c);
      rs.on('end', () => { try { res({ http: rs.statusCode, json: JSON.parse(b) }) } catch { res({ http: rs.statusCode, json: { _raw: b.slice(0, 200) } }) } });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

// ---------- 脱敏 ----------
const PII_KEY = /(phone|mobile|tel|email|address|name|customerName|userName|idCard|document|certificate|wx|wechat|birthday|idNum|contact|account)/i;
const ID_KEY = /^(customerId|userId|tenantId|id|userNo|documentId|.*Id)$/;
function maskValue(v) {
  if (typeof v !== 'string' || !v) return v;
  if (/^\d{11}$/.test(v)) return v.slice(0, 3) + '****' + v.slice(-4);          // 手机号
  if (/^[\w.+-]+@[\w.-]+$/.test(v)) return '<EMAIL>';                          // 邮箱
  if (/^\d{15,}$/.test(v)) return '<NUM:' + v.length + '>';                    // 长数字ID
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v)) return '<JWT>';                   // 别把 token 写进文档
  return v.length > 80 ? v.slice(0, 77) + '…' : v;
}
function mask(k, v) {
  if (typeof v === 'string' && v) {
    if (ID_KEY.test(k) && /^\d{10,}$/.test(v)) return '<ID>';
    if (PII_KEY.test(k)) {
      if (/^\d{11}$/.test(v)) return v.slice(0, 3) + '****' + v.slice(-4);
      if (/^[\w.+-]+@[\w.-]+$/.test(v)) return '<EMAIL>';
      if (/^\d+$/.test(v)) return '<NUM>';
      return v.length > 20 ? '<STR:' + v.length + '>' : '<MASKED>';
    }
    return maskValue(v);
  }
  return v;
}
// ---------- schema ----------
const MAX_ARRAY_SAMPLE = 2;
function schema(o, depth = 0, key = '') {
  if (o === null) return 'null';
  if (Array.isArray(o)) {
    if (!o.length) return '[]';
    const items = o.slice(0, MAX_ARRAY_SAMPLE).map(x => schema(x, depth + 1, key));
    return items.length === 1 ? [items[0]] : items;
  }
  if (typeof o === 'object') {
    if (depth > 7) return '<object:深度截断>';
    const r = {};
    for (const [k, v] of Object.entries(o)) r[k] = schema(v, depth + 1, k);
    return r;
  }
  return mask(key, o);
}

const TARGETS = [
  ['GET', '/api/v1/channel/getCustomerNumber', null, '客户总数'],
  ['GET', '/api/v1/channel/getAllChannel?flag=true', null, '渠道列表'],
  ['GET', '/api/v1/customerPool/customerPools', null, '公海池统计'],
  ['GET', '/api/v1/customerPool/customerPoolConfigs', null, '公海池配置'],
  ['GET', '/api/v1/msg/todayTotal', null, '今日消息'],
  ['GET', '/api/v1/user/userAll', null, '员工列表'],
  ['GET', '/api/v1/user/userAllEnable', null, '在职员工'],
  ['GET', '/api/v1/user/getAllDoctors', null, '医生列表'],
  ['GET', '/api/v1/user/dataRange', null, '数据范围'],
  ['GET', '/api/v1/dept/tree', null, '科室树'],
  ['GET', '/api/v1/role/tree/', null, '角色树'],
  ['GET', '/api/v1/dict?codes=channelLevel', null, '数据字典'],
  ['GET', '/api/v1/menu/allCollect', null, '收藏菜单'],
  ['GET', '/api/v1/visitPlan/init', null, '回访计划初始化'],
  ['GET', '/api/v1/customer/initListV2', null, '客户列表配置'],
  ['GET', '/api/v1/customer/oldNew', null, '新老客统计'],
  ['GET', '/api/v2/customer/cube/template/get-user-all-cube-config', null, '预置客户数据集'],
  ['GET', '/api/v2/customer/cube/template/get-user-cube-config', null, '用户自建数据集'],
  ['POST', '/api/v1/scrm/customer/scrmCustomerList', { current: 1, size: 3 }, 'SCRM客户列表'],
  ['POST', '/api/v2/reception/receptionList', { page: 1, limit: 3 }, '接诊列表'],
  ['POST', '/api/v2/bespeak/bespeakList', { page: 1, limit: 3 }, '预约列表'],
];
const CID_TARGETS = [
  ['/api/v1/customer/detail?customerId={CID}', '客户完整档案'],
  ['/api/v1/customer/getCustomerPhoneNumbers?customerId={CID}', '客户电话列表'],
  ['/api/v1/customer/getCustomerPhoneJson?customerId={CID}', '客户电话(JSON)'],
  ['/api/v1/customerOverView/consumeStatistical?customerId={CID}', '消费统计'],
  ['/api/v1/customerOverView/getRfmScore?customerId={CID}&isGroup=false', 'RFM评分'],
  ['/api/v1/customerOverView/cusRelations?id={CID}', '客户关系图谱'],
  ['/api/v1/customerOverView/arriveDetail?customerId={CID}', '到店明细'],
  ['/api/v1/customerOverView/recentAppointment?customerId={CID}', '近期预约'],
  ['/api/v1/customerOverView/consumptionBehaviorTrack?customerId={CID}&startTime=2025-01-01', '消费行为轨迹'],
  ['/api/v1/customer/getCoordinate?customerId={CID}', '客户坐标'],
  ['/api/v1/member/level/getHCustomerMemberLevel?customerId={CID}', '会员等级'],
];

(async () => {
  const out = { meta: { generatedAt: new Date().toISOString(), host: HOST, apiBase: 'https://' + HOST + '/api', captureMethod: '实时调用捕获（token 有效期内）', piiNote: 'PII 已脱敏：<MASKED>/<ID>/<EMAIL>/<NUM>/<STR:n>；手机号前3后4', envelope: '{ code: 10000|10001|10002(成功) | 20002(参数错误) | 401, msg, data }', headers: { Authorization: '<JWT 裸值>', tenant: '1', lang: 'zh-CN', 'X-No-Wrap': 'true' } }, endpoints: [] };

  const tryCall = async (method, path, body, label) => {
    try {
      const r = await call(method, path, body);
      const j = r.json;
      const ok = [10000, 10001, 10002].includes(j.code);
      const rec = { label, method, path: path.replace(/\?.*$/, ''), query: (path.match(/\?(.*)$/) || [, ''])[1] || undefined, http: r.http, code: j.code, msg: j.msg, success: ok };
      if (ok && j.data !== undefined) {
        const raw = JSON.stringify(j.data);
        rec.dataSize = raw.length;
        rec.schema = raw.length > 400000 ? '<超大响应 ' + Math.round(raw.length / 1024) + 'KB，仅记录顶层键：' + (Array.isArray(j.data) ? 'Array(' + j.data.length + ')' : Object.keys(j.data).join(',')) + '>' : schema(j.data);
        rec.dataCount = Array.isArray(j.data) ? j.data.length : undefined;
      } else if (!ok) { rec.error = j.msg; }
      out.endpoints.push(rec);
      console.log((ok ? '✓' : '✗'), label.padEnd(20), 'code=' + j.code, rec.dataSize ? (Math.round(rec.dataSize / 1024) + 'KB') : '', (j.msg || '').slice(0, 20));
      return ok ? j.data : null;
    } catch (e) {
      out.endpoints.push({ label, method, path, error: e.message });
      console.log('✗', label.padEnd(20), 'ERR', e.message);
      return null;
    }
  };

  // 0) 客户ID 自动发现：argv[3] 若不是 19 位雪花ID，就当成手机号去搜客户
  let CID = /^\d{15,}$/.test(CID_ARG) ? CID_ARG : '';
  const PHONE = PROBE_PHONE || (!CID ? CID_ARG : '');
  if (PHONE) {
    const d = await tryCall('GET', '/api/v1/customer/getCustomerByPhone?phone=' + encodeURIComponent(PHONE), null, '客户搜索(手机号)');
    if (Array.isArray(d) && d.length) {
      // 优先挑一个有消费/到院记录的客户，让示例更有代表性
      CID = d[0].customerId;
      console.log('   → 自动发现 customerId =', CID, '（候选', d.length, '位）');
    }
  }
  if (!CID && CID_ARG) console.log('使用指定 customerId =', CID);

  for (const [m, p, b, l] of TARGETS) await tryCall(m, p, b, l);
  if (CID) for (const [p, l] of CID_TARGETS) await tryCall('GET', p.replace(/\{CID\}/g, CID), null, l);
  else console.log('(无 customerId，跳过客户 360 系列)');

  out.meta.customerIdUsed = CID || null;
  out.meta.endpointCount = out.endpoints.length;
  out.meta.successCount = out.endpoints.filter(e => e.success).length;
  fs.writeFileSync('C:/Users/Public/ruimeiyun-analysis/api-schemas.json', JSON.stringify(out, null, 2));
  console.log('\n已写入 api-schemas.json | 成功', out.meta.successCount, '/', out.meta.endpointCount);
})();
