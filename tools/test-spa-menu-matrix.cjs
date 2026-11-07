// Menu-only production-build navigation with isolated HTTP fixtures.
// No real API writes. This is functional coverage, not a performance measurement.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const MENU_ROUTES = {
  USER: [
    { path: '/dashboard', heading: 'Tổng quan tài sản mã hóa', title: 'Tổng quan' },
    { path: '/assets', heading: 'Tài sản của tôi', title: 'Tài sản' },
    { path: '/requests', heading: 'Yêu cầu của tôi', title: 'Yêu cầu' },
    { path: '/notifications', heading: 'Thông báo', title: 'Thông báo' },
    // Last: the modal intentionally owns initial focus and blocks the menu.
    { path: '/requests/new', heading: 'Tạo yêu cầu mới', title: 'Tạo yêu cầu', dialog: true },
  ],
  APPROVER: [
    { path: '/dashboard', heading: 'Tổng quan phê duyệt', title: 'Tổng quan' },
    { path: '/assets', heading: 'Tài sản trong phạm vi phê duyệt', title: 'Tài sản' },
    { path: '/approvals', heading: 'Hàng chờ cần quyết định', title: 'Hàng chờ phê duyệt' },
    { path: '/approvals/history', heading: 'Lịch sử quyết định', title: 'Lịch sử quyết định' },
    { path: '/notifications', heading: 'Thông báo', title: 'Thông báo' },
  ],
  ADMIN: [
    { path: '/dashboard', heading: 'Sức khỏe tài sản mật mã', title: 'Tổng quan' },
    { path: '/assets', heading: 'Tài sản mật mã', title: 'Tài sản' },
    { path: '/policies', heading: 'Chính sách mật mã', title: 'Chính sách' },
    { path: '/users', heading: 'Người dùng và vai trò', title: 'Người dùng & vai trò' },
    { path: '/audit', heading: 'Audit Log', title: 'Audit Log' },
    { path: '/operations/email', heading: 'Email cần xử lý', title: 'Vận hành email' },
    { path: '/operations/provider', heading: 'Đối soát provider', title: 'Đối soát provider' },
    { path: '/notifications', heading: 'Thông báo', title: 'Thông báo' },
  ],
};
const THEMES = ['light', 'dark'];
const WIDTHS = [1440, 390];
const MODES = ['on', 'off'];
const HEIGHT = 800;

function matrixGroups() {
  return Object.keys(MENU_ROUTES).flatMap(role => THEMES.flatMap(theme => WIDTHS.flatMap(width => MODES.map(mode => ({
    role, theme, width, mode, name: `${role} ${theme} ${width}px ${mode.toUpperCase()}`,
  })))));
}

async function nextFrames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function ready(page, route) {
  await page.waitForFunction(expected => location.pathname === expected.path
    && document.querySelector('#page-title')?.textContent === expected.heading
    && document.title === `${expected.title} · Crypta`, route);
  await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'));
  await nextFrames(page);
}

async function capture(page) {
  return page.evaluate(() => {
    const saved = window.__menuShell;
    const selectors = { appShell: '.app-shell', sidebar: '.sidebar', topbar: '.topbar', main: '#main-content' };
    const identity = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [name, !!saved && saved[name] === document.querySelector(selector)]));
    const active = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    const shellAnimations = Object.entries(selectors).filter(([name]) => name !== 'main').flatMap(([owner, selector]) =>
      document.querySelector(selector).getAnimations().map(animation => ({
        owner, type: animation.constructor.name, property: animation.transitionProperty ?? null,
      })));
    return {
      documentToken: window.__menuDocumentToken,
      sameDocument: !!saved && saved.document === document,
      identity,
      pathname: location.pathname,
      search: location.search,
      heading: document.querySelector('#page-title')?.textContent,
      title: document.title,
      theme: document.documentElement.dataset.theme,
      currentLinks: Array.from(document.querySelectorAll('a.nav-item[aria-current="page"]'), link => new URL(link.href).pathname),
      activeLinks: Array.from(document.querySelectorAll('a.nav-item.nav-item-active'), link => new URL(link.href).pathname),
      scrollY,
      focus: {
        heading: active === document.querySelector('#page-title'),
        inDialog: !!dialog && dialog.contains(active),
        tag: active?.tagName, id: active?.id, disabled: active?.disabled ?? false,
      },
      dialogCount: document.querySelectorAll('[role="dialog"]').length,
      sidebarOpen: !!document.querySelector('.sidebar-open'),
      mainAnimations: window.__menuMotion.main,
      nativeShellAnimations: window.__menuMotion.shell,
      shellAnimations,
    };
  });
}

function assertShell(snapshot, token, group) {
  assert.equal(snapshot.documentToken, token, 'A menu click must preserve the loaded document');
  assert.equal(snapshot.sameDocument, true);
  for (const [name, same] of Object.entries(snapshot.identity)) assert.equal(same, true, `Preserve ${name} DOM identity`);
  assert.deepEqual(snapshot.nativeShellAnimations, [], 'Page navigation must not call Element.animate on the shell, sidebar or topbar');
  for (const animation of snapshot.shellAnimations) {
    assert(group.width === 390 && animation.owner === 'sidebar' && animation.type === 'CSSTransition' && animation.property === 'transform',
      `Only the mobile drawer transform may animate a shell element: ${JSON.stringify(animation)}`);
  }
}

async function navigateMenu(page, route, group, token, purpose) {
  const before = await capture(page);
  assert.notEqual(before.pathname, route.path, 'Every checked click must commit a different workspace page');
  if (group.width === 390) {
    await page.getByRole('button', { name: 'Mở điều hướng', exact: true }).click();
    await page.locator('.sidebar-open').waitFor();
  }
  const beforeClickScroll = await page.evaluate(() => scrollY);
  if (purpose === 'target') assert(beforeClickScroll > 40, 'The target click must start from a real positive document scroll offset');
  await page.locator(`a.nav-item[href="${route.path}"]`).click();
  await ready(page, route);
  if (group.mode === 'on') await page.waitForFunction(count => window.__menuMotion.main.length === count, before.mainAnimations.length + 1);
  if (route.dialog) {
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
  } else {
    await page.waitForFunction(() => document.activeElement === document.querySelector('#page-title'));
  }
  await page.waitForFunction(() => Math.abs(scrollY) <= 1);
  const after = await capture(page);
  assertShell(after, token, group);
  assert.equal(after.pathname, route.path);
  assert.equal(after.search, '');
  assert.equal(after.heading, route.heading);
  assert.equal(after.title, `${route.title} · Crypta`);
  assert.equal(after.theme, group.theme);
  assert.deepEqual(after.currentLinks, [route.path], 'Exactly the current menu link must expose aria-current=page');
  assert.deepEqual(after.activeLinks, [route.path], 'Exactly the current menu link must have the active style');
  assert.equal(after.sidebarOpen, false);
  assert.equal(after.dialogCount, route.dialog ? 1 : 0);
  assert.equal(after.focus.disabled, false);
  assert.equal(route.dialog ? after.focus.inDialog : after.focus.heading, true);
  assert(Math.abs(after.scrollY) <= 1, 'Menu navigation resets document scroll');
  if (group.mode === 'off') {
    assert.equal(after.mainAnimations.length, 0, 'The OFF build never starts a main-content entrance');
  } else {
    assert.equal(after.mainAnimations.length, before.mainAnimations.length + 1, 'One entrance per changed workspace page');
    const animation = after.mainAnimations.at(-1);
    assert(Number.isFinite(animation.duration) && animation.duration > 0 && animation.duration <= 200, 'Entrance remains short');
    assert(animation.opacities.length >= 2 && animation.opacities[0] < animation.opacities.at(-1) && animation.opacities.at(-1) === 1, 'The committed page has an opacity entrance');
    assert.deepEqual(animation.properties, ['opacity'], 'Page entrance leaves layout geometry unchanged');
  }
  return { purpose, path: route.path, beforeClickScroll, afterScroll: after.scrollY, heading: after.heading, title: after.title, currentLinks: after.currentLinks,
    focus: after.focus, identity: after.identity, mainAnimationCount: after.mainAnimations.length, shellAnimations: after.shellAnimations };
}

async function runGroup(browser, fixture, group, origin, output, index) {
  const f = await fixture(browser, group.role, { notificationItems: true, auditItems: true, emailItems: true });
  const item = { ...group, origin, status: 'passed', steps: [] };
  try {
    await f.page.setViewportSize({ width: group.width, height: HEIGHT });
    await f.page.addInitScript(theme => {
      localStorage.setItem('crypta-theme', theme);
      window.__menuDocumentToken = crypto.randomUUID();
      window.__menuMotion = { main: [], shell: [] };
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.id === 'main-content') {
          const frames = animation.effect.getKeyframes();
          const metadata = ['offset', 'computedOffset', 'easing', 'composite'];
          window.__menuMotion.main.push({ duration: animation.effect.getComputedTiming().duration,
            properties: [...new Set(frames.flatMap(frame => Object.keys(frame).filter(key => !metadata.includes(key))))].sort(),
            opacities: frames.filter(frame => frame.opacity !== undefined).map(frame => Number(frame.opacity)) });
        } else if (this.matches('.app-shell, .sidebar, .topbar')) window.__menuMotion.shell.push(this.className);
        return animation;
      };
    }, group.theme);
    // The only full document navigation in this group.
    await f.page.goto(origin + '/dashboard');
    await ready(f.page, MENU_ROUTES[group.role][0]);
    await f.page.waitForFunction(() => document.activeElement === document.querySelector('#page-title'));
    const inventory = await f.page.locator('a.nav-item').evaluateAll(links => links.map(link => new URL(link.href).pathname));
    assert.deepEqual([...inventory].sort(), MENU_ROUTES[group.role].map(route => route.path).sort(), 'The menu contains exactly the routes allowed for this role');
    const token = await f.page.evaluate(() => {
      window.__menuShell = { document, appShell: document.querySelector('.app-shell'), sidebar: document.querySelector('.sidebar'), topbar: document.querySelector('.topbar'), main: document.querySelector('#main-content') };
      return window.__menuDocumentToken;
    });
    const initial = await capture(f.page);
    assertShell(initial, token, group);
    assert.equal(initial.mainAnimations.length, 0, 'Initial document load has no page entrance');
    assert.equal(initial.theme, group.theme);
    const primaryPrimer = group.role === 'APPROVER' ? '/approvals' : '/assets';
    for (const route of MENU_ROUTES[group.role]) {
      // Real populated menu pages supply scroll range even when the target is short.
      const primerPath = route.path === primaryPrimer ? '/notifications' : primaryPrimer;
      const primer = MENU_ROUTES[group.role].find(item => item.path === primerPath);
      if (new URL(f.page.url()).pathname !== primer.path) item.steps.push(await navigateMenu(f.page, primer, group, token, 'scroll-source'));
      const scrollTarget = await f.page.evaluate(() => {
        const maximum = document.documentElement.scrollHeight - innerHeight;
        if (maximum <= 40) return maximum;
        const target = Math.min(320, maximum);
        window.scrollTo({ top: target, behavior: 'instant' });
        return target;
      });
      assert(scrollTarget > 40, `${primer.path} must supply real scroll range for ${route.path}`);
      await f.page.waitForFunction(target => Math.abs(scrollY - target) <= 1, scrollTarget);
      await nextFrames(f.page); // Let scroll events update the app's saved offset.
      item.steps.push(await navigateMenu(f.page, route, group, token, 'target'));
    }
    assert.equal(item.steps.filter(step => step.purpose === 'target').length, MENU_ROUTES[group.role].length);
    assert.deepEqual(f.errors, []);
    assert.equal(f.mutations.length, 0, 'Menu coverage must perform no API mutations');
    item.mainAnimations = (await capture(f.page)).mainAnimations.length;
  } catch (error) {
    item.status = 'failed';
    item.error = error.stack;
    item.lastSnapshot = await capture(f.page).catch(() => null);
    item.calls = f.calls;
    item.fixtureErrors = f.errors;
    process.exitCode = 1;
    await f.page.screenshot({ path: path.join(output, `${index + 1}-failed.png`), fullPage: true }).catch(() => {});
  } finally {
    item.checkedMenuLinks = item.steps.filter(step => step.purpose === 'target').length;
    item.apiMutationCount = f.mutations.length;
    item.buildAssets = await f.page.locator('script[src],link[rel=stylesheet]').evaluateAll(elements => elements.map(element => element.getAttribute('src') || element.getAttribute('href'))).catch(() => []);
    await f.context.tracing.stop(item.status === 'failed' ? { path: path.join(output, `${index + 1}-failed.zip`) } : undefined);
    await f.context.close();
  }
  console.log(`${item.status === 'passed' ? 'PASS' : 'FAIL'} ${group.name} (${item.checkedMenuLinks ?? item.steps.filter(step => step.purpose === 'target').length}/${MENU_ROUTES[group.role].length} menu links)${item.error ? '\n' + item.error : ''}`);
  return item;
}

async function main() {
  const playwrightDir = process.argv[2];
  const playwright = playwrightDir ? require(path.join(playwrightDir, 'playwright')) : require('playwright');
  const { fixture } = require('./test-spa-workspace.cjs');
  const browserChannel = process.env.CRYPTA_TEST_BROWSER || 'msedge';
  const origins = { on: process.env.CRYPTA_UI_TEST_URL || 'http://127.0.0.1:4173', off: process.env.CRYPTA_UI_BASELINE_URL || 'http://127.0.0.1:4174' };
  const output = path.resolve(process.env.CRYPTA_MENU_OUTPUT || path.join(__dirname, 'test-artifacts', 'spa', `menu-matrix-${browserChannel}-${Date.now()}`));
  const testFilter = process.env.CRYPTA_MENU_FILTER || '';
  const groups = matrixGroups().filter(group => group.name.includes(testFilter));
  assert(groups.length, 'CRYPTA_MENU_FILTER did not match any group');
  await fs.mkdir(output, { recursive: true });
  const browser = browserChannel === 'firefox'
    ? await playwright.firefox.launch({ headless: true })
    : await playwright.chromium.launch({ headless: true, channel: browserChannel });
  const browserVersion = browser.version(), results = [];
  try {
    for (const group of groups) results.push(await runGroup(browser, fixture, group, origins[group.mode], output, results.length));
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ browserChannel, browserVersion, origins, height: HEIGHT, fixtureOnly: true,
      testFilter, expectedFullGroups: 24, expectedFullMenuLinks: 128,
      scope: 'Every role-visible navigation link via real menu clicks, both themes, widths 1440/390 and ON/OFF builds. One initial dashboard document load per group; populated menu pages provide a positive scroll precondition for every target. Preserves document/shell/sidebar/topbar/main DOM identity; checks heading, title, unique current link, focus, scroll reset and native page entrance. Mobile drawer CSS transform is allowed; page navigation must not animate the shell. No API mutations. Functional coverage only, not a performance measurement.', results }, null, 2));
  }
  console.log(`${results.filter(item => item.status === 'passed').length}/${results.length} menu-matrix groups passed; ${results.reduce((sum, item) => sum + (item.checkedMenuLinks || 0), 0)} target links passed`);
}

module.exports = { MENU_ROUTES, matrixGroups };
if (require.main === module) {
  if (process.argv[2] === '--list') console.log(JSON.stringify({ groups: matrixGroups(), menuLinks: Object.fromEntries(Object.entries(MENU_ROUTES).map(([role, routes]) => [role, routes.map(route => route.path)])) }, null, 2));
  else main().catch(error => { console.error(error); process.exitCode = 1; });
}
