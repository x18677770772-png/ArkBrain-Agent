/**
 * A5 纵切片硬验收（Playwright）：
 *   录入落库 → 回读 → 签发 → 看板四数字相对 +1 → 刷新仍在
 *
 * 前置：PG(5433) + ark-api(3724) + 后端(3721) 均在跑，切片状态已重置
 *   （TRUNCATE preference_pairs/lab_results; plans PL-8841 → pending_review）
 *
 * 坑位（NOTES）：本机 playwright 缺 chromium → channel:'chrome'；
 *   脚本需 NODE_PATH=<repo>/node_modules；拦 /message 免烧配额；
 *   「0 页面错误」滤 ERR_FAILED；locale zh-CN 防无头 Chrome 自动翻译改 DOM。
 *
 * Run: NODE_PATH=<repo>/node_modules node scripts/slice-smoke.cjs
 */
const { chromium } = require('playwright');

const num = (s) => Number(String(s).replace(/[^\d.-]/g, '')) || 0;

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--disable-features=Translate,TranslateUI', '--lang=zh-CN'],
  });
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => { if (!/ERR_FAILED/.test(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|m[12]345/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('**/message', (r) => r.abort());

  const checks = [];
  const check = (label, ok) => { checks.push([label, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`); };

  await page.goto('http://127.0.0.1:3721/brain-ui', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // ---- 开面板 → bootstrap（PG 实时）----
  await page.click('#biz-btn');
  await page.waitForSelector('#biz-dash-source', { timeout: 5000 });
  await page.waitForFunction(
    () => document.getElementById('biz-dash-source')?.textContent.includes('PG · 实时'),
    { timeout: 15000 },
  );
  check('看板数据源 chip = PG · 实时', true);

  const readMetrics = () => page.evaluate(() => ({
    hero: document.getElementById('biz-hero-pref')?.textContent,
    today: document.getElementById('biz-hero-today')?.textContent,
    signed: document.getElementById('biz-m-signed')?.textContent,
    chip: document.getElementById('biz-pref-chip')?.textContent,
    rail: document.getElementById('biz-rail-pref-n')?.textContent,
  }));
  const before = await readMetrics();
  console.log('签发前:', JSON.stringify(before));
  check(`空库基线 hero=0（实际 ${before.hero}）`, num(before.hero) === 0);

  // ---- 检测台 · 手工录入落库 ----
  await page.click('.biz-tab[data-view="lab"]');
  await page.click('#biz-lab-entry-toggle');
  check('录入表单展开', await page.isVisible('#biz-lf-name'));
  await page.fill('#biz-lf-name', '烟测指标');
  await page.fill('#biz-lf-code', 'SMOKE1');
  await page.fill('#biz-lf-value', '9.9');      // 超上限 → 服务端应判 high
  await page.fill('#biz-lf-unit', 'mmol/L');
  await page.fill('#biz-lf-lo', '3.9');
  await page.fill('#biz-lf-hi', '6.1');
  await page.click('#biz-lf-add');
  // 等服务端响应回填（status-high 必须来自落库后的权威 doc 覆盖）
  await page.waitForFunction(
    () => [...document.querySelectorAll('#biz-lab-grid .biz-lab-item')]
      .some((el) => el.textContent.includes('烟测指标') && el.classList.contains('status-high')),
    { timeout: 8000 },
  );
  const smokeItem = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#biz-lab-grid .biz-lab-item')]
      .find((x) => x.textContent.includes('烟测指标'));
    return el ? el.className : '';
  });
  check(`录入项上屏且服务端重算 status=high（${smokeItem}）`, smokeItem.includes('status-high'));

  // ---- 方案签发 → PG +1 ----
  await page.click('.biz-tab[data-view="plan"]');
  await page.waitForFunction(
    () => document.getElementById('biz-sign-btn')?.textContent.includes('签发并落库'),
    { timeout: 5000 },
  );
  await page.click('#biz-sign-btn');
  await page.waitForFunction(
    () => document.getElementById('biz-sign-btn')?.textContent.includes('已签发'),
    { timeout: 15000 },
  );
  check('签发按钮 → ✓ 已签发', true);

  const after = await readMetrics();
  console.log('签发后:', JSON.stringify(after));
  check(`hero 相对 +1（${before.hero} → ${after.hero}）`, num(after.hero) === num(before.hero) + 1);
  check(`今日 +1（${before.today} → ${after.today}）`, num(after.today.split('+')[1]) === num(before.today.split('+')[1]) + 1);
  check(`方案已签 +1（${before.signed} → ${after.signed}）`, num(after.signed) === num(before.signed) + 1);
  check(`顶栏 chip +1（${before.chip} → ${after.chip}）`, num(after.chip) === num(before.chip) + 1);
  check(`左栏 rail +1（${before.rail} → ${after.rail}）`, num(after.rail) === num(before.rail) + 1);

  // 服务端逐字 diff 渲染（gutter 应有服务端分类的修订 chip）
  const gutter = await page.evaluate(() =>
    [...document.querySelectorAll('#biz-diff-grid .biz-diff-gutter-cell .biz-chip')].map((c) => c.textContent));
  check(`diff gutter 有修订类型 chip（${JSON.stringify(gutter)}）`, gutter.length > 0);

  // ---- 刷新持久化 ----
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('#biz-btn');
  await page.waitForFunction(
    () => document.getElementById('biz-dash-source')?.textContent.includes('PG · 实时'),
    { timeout: 15000 },
  );
  const afterReload = await readMetrics();
  console.log('刷新后:', JSON.stringify(afterReload));
  check(`刷新后计数仍在（hero=${afterReload.hero}）`, num(afterReload.hero) === num(after.hero));
  await page.evaluate(() => document.querySelector('.biz-tab[data-view="plan"]')?.click());
  await page.waitForTimeout(300);
  const btnState = await page.evaluate(() => ({
    disabled: document.getElementById('biz-sign-btn')?.disabled,
    text: document.getElementById('biz-sign-btn')?.textContent,
  }));
  check(`刷新后方案保持已签发（${btnState.text?.trim()}）`, Boolean(btnState.disabled));

  check('0 页面错误', errors.length === 0);
  if (errors.length) console.log('错误:', errors);

  await page.screenshot({ path: '/tmp/shot-a5-dashboard.png', fullPage: false });
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed === 0 ? `\n全部通过（${checks.length} 项）` : `\n${failed}/${checks.length} 项失败`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
