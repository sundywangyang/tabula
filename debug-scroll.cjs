// 调试脚本：检查 FileList 相关 DOM 元素高度
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const appPath = path.join(__dirname, 'release', 'win-unpacked', 'Tabula.exe');
  const userDataDir = path.join(__dirname, 'test-user-data');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 监听 console 消息
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('[CONSOLE ERROR]', msg.text());
    }
  });

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(3000);

    // 注入调试脚本
    const results = await page.evaluate(() => {
      const selectors = [
        '.file-list',
        '.file-list-body',
        '.file-list-body-virtual',
        '.pane-content',
        '.pane-view',
        '.app-main',
        '.app-body',
        '.app-root',
      ];
      return selectors.map(sel => {
        const el = document.querySelector(sel);
        if (!el) return { selector: sel, found: false };
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          selector: sel,
          found: true,
          clientHeight: el.clientHeight,
          offsetHeight: el.offsetHeight,
          scrollHeight: el.scrollHeight,
          rect: { top: rect.top, height: rect.height, bottom: rect.bottom },
          overflow: style.overflow,
          overflowY: style.overflowY,
          display: style.display,
          flex: style.flex,
          position: style.position,
          contain: style.contain,
        };
      });
    });

    console.log('=== DOM 高度调试 ===');
    for (const r of results) {
      if (r.found) {
        console.log(`${r.selector}:`);
        console.log(`  clientHeight=${r.clientHeight} offsetHeight=${r.offsetHeight} scrollHeight=${r.scrollHeight}`);
        console.log(`  rect.height=${r.rect.height} overflow=${r.overflow} overflowY=${r.overflowY}`);
        console.log(`  display=${r.display} flex="${r.flex}" contain=${r.contain}`);
      } else {
        console.log(`${r.selector}: NOT FOUND`);
      }
    }

    // 检查虚拟滚动器的实际输出
    const virtualInfo = await page.evaluate(() => {
      const body = document.querySelector('.file-list-body');
      const virtual = document.querySelector('.file-list-body-virtual');
      if (!body) return 'body NOT FOUND';
      if (!virtual) return 'virtual NOT FOUND';
      return {
        bodyScrollHeight: body.scrollHeight,
        bodyScrollTop: body.scrollTop,
        virtualChildCount: virtual.children.length,
        virtualFirstChildHeight: virtual.firstElementChild ? virtual.firstElementChild.scrollHeight : 0,
        totalVisible: Array.from(document.querySelectorAll('.file-list-row')).length,
      };
    });
    console.log('\n=== 虚拟滚动状态 ===');
    console.log(JSON.stringify(virtualInfo, null, 2));

  } finally {
    await browser.close();
  }
})();
