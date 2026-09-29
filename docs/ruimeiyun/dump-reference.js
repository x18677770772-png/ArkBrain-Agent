// 导出参考数据：74 个客户数据集定义 + 公海池明细 + 字典 + 科室树
const https = require('https');
const fs = require('fs');
const HOST = 'bksw.hospital.realmerit.com.cn';
const H = { Authorization: process.argv[2], tenant: '1', lang: 'zh-CN', 'X-No-Wrap': 'true' };
const get = p => new Promise((res, rej) => https.get({ hostname: HOST, path: p, headers: H }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)) } catch { res({ _raw: b.slice(0, 200) }) } }) }).on('error', rej));

(async () => {
  const out = { generatedAt: new Date().toISOString(), host: HOST, tenant: '1' };

  // 1) 74 个客户数据集定义
  const cube = await get('/api/v2/customer/cube/template/get-user-all-cube-config');
  if (cube.code === 10000 || cube.code === 10001) {
    out.cubeDatasets = (cube.data || []).map(c => ({
      systemConfigEnum: c.systemConfigEnum, title: c.title, type: c.type, permType: c.permType,
      remark: c.remark, id: c.id, conditionLabel: c.conditionLabel || undefined,
      jsonObject: c.jsonObject || undefined
    }));
    console.log('数据集:', out.cubeDatasets.length, '个');
    out.cubeDatasets.forEach(c => console.log('  ', (c.systemConfigEnum || '-').padEnd(34), c.title));
  }

  // 2) 公海池明细
  const pool = await get('/api/v1/customerPool/customerPools');
  if (pool.code === 10001) {
    out.customerPools = {
      personalPoolCount: pool.data.personalPoolCount,
      nonPersonalPoolCount: pool.data.nonPersonalPoolCount,
      list: (pool.data.customerPoolVoList || []).map(p => ({ id: p.id, name: p.name, currentCount: p.currentCount, type: p.type, specialType: p.specialType, activePeriod: p.activePeriod, activePeriodRemind: p.activePeriodRemind, ruleCount: p.ruleCount }))
    };
    console.log('\n公海池:', out.customerPools.list.length, '个 | 个人池', out.customerPools.personalPoolCount, '| 非个人池', out.customerPools.nonPersonalPoolCount);
    out.customerPools.list.forEach(p => console.log('  ', String(p.currentCount).padStart(5), p.name, '(' + p.specialType + ')'));
  }

  // 3) 字典
  const dict = await get('/api/v1/dict?codes=channelLevel');
  if (dict.code === 10001) { out.dictSample = dict.data; console.log('\n字典 channelLevel:', JSON.stringify(dict.data).slice(0, 300)); }

  // 4) 科室树（只存结构）
  const dept = await get('/api/v1/dept/tree');
  if (dept.code === 10001) {
    const strip = a => (Array.isArray(a) ? a.map(x => ({ title: x.title || x.name || x.label, value: x.value || x.id, children: x.children ? strip(x.children) : undefined })) : a);
    out.deptTree = strip(dept.data);
    console.log('\n科室树节点:', JSON.stringify(out.deptTree).length, 'B');
  }

  fs.writeFileSync('C:/Users/Public/ruimeiyun-analysis/reference-data.json', JSON.stringify(out, null, 2));
  console.log('\n已写入 reference-data.json');
})();
