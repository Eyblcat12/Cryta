// Real API/worker/browser coverage for the approved T18 flow; no intercepted HTTP.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function verifyAssetLineage({ test, call, expectStatus, createRequest, account, approver, admin, policy, newPage, uiLogin, origin, output }) {
  let fixture;
  async function complete(request) {
    expectStatus(await call('POST', `/requests/${request.id}/decision`, { decision: 'APPROVED', version: String(request.version) }, approver.accessToken), 201);
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      const current = expectStatus(await call('GET', `/requests/${request.id}`, undefined, account.accessToken), 200);
      if (current.status === 'COMPLETED') return current;
      assert.notEqual(current.status, 'RECONCILIATION_REQUIRED');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('T18_WORKER_COMPLETION_TIMEOUT');
  }
  async function prepare() {
    if (fixture) return fixture;
    const issued = await complete(await createRequest(account, 'T18 lineage'));
    const renewed = await complete(expectStatus(await call('POST', '/requests', {
      type: 'RENEW', targetAssetId: issued.resultAssetId, policyVersionId: policy.id,
      reason: 'T18 renewal lineage verification', parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 90 },
    }, account.accessToken), 201));
    const revoked = await complete(expectStatus(await call('POST', '/requests', {
      type: 'REVOKE', targetAssetId: renewed.resultAssetId, policyVersionId: policy.id,
      reason: 'T18 revocation lineage verification', parameters: {},
    }, account.accessToken), 201));
    const previous = expectStatus(await call('GET', '/assets/' + issued.resultAssetId, undefined, admin.accessToken), 200);
    const next = expectStatus(await call('GET', '/assets/' + renewed.resultAssetId, undefined, admin.accessToken), 200);
    assert.equal(previous.status, 'SUPERSEDED'); assert.equal(next.status, 'REVOKED');
    fixture = { previous, next, revoked }; return fixture;
  }
  for (const mobile of [false, true]) await test(`T18 real UI: scoped Approver traces renewal and provider history at ${mobile ? 390 : 1440}px`, async () => {
    const { previous, next } = await prepare();
    const { page, calls, errors } = await newPage();
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('crypta-theme', theme), mobile ? 'dark' : 'light');
    const catalog = '/assets?q=' + encodeURIComponent(previous.code);
    await page.goto(new URL(catalog, origin).href); await uiLogin(page, 'it.manager@congty.com');
    await page.getByRole('heading', { name: 'Tài sản trong phạm vi phê duyệt', exact: true }).waitFor();
    await page.getByRole('button', { name: previous.code, exact: true }).click();
    await page.locator('.history-timeline[aria-busy="false"]').waitFor();
    await page.getByRole('link', { name: next.code, exact: true }).click();
    await page.waitForURL(url => url.pathname === '/assets/' + next.id);
    const history = page.locator('.history-timeline'); await history.locator('ol').waitFor();
    await history.getByText('Bắt đầu gửi đến provider', { exact: true }).first().waitFor();
    await history.getByRole('link', { name: previous.code, exact: true }).waitFor();
    const gaps=await history.locator('.timeline-items ol li').evaluateAll(items=>items.slice(0,-1).map((item,index)=>
      items[index+1].querySelector('strong').getBoundingClientRect().top-item.querySelector('small').getBoundingClientRect().bottom));
    assert(gaps.length>0&&Math.min(...gaps)>=12,'History events need separation when request labels wrap');
    await page.screenshot({ path: path.join(output, `t18-scoped-detail-${mobile ? 'mobile-dark' : 'desktop-light'}.png`), fullPage: true, animations: 'disabled' });
    assert.equal(await page.getByRole('button', { name: 'Yêu cầu gia hạn', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Thu hồi', exact: true }).count(), 0);
    await history.getByRole('link', { name: /^Yêu cầu / }).first().focus(); await page.keyboard.press('Enter');
    await page.waitForURL(url => /^\/requests\/[0-9a-f-]{36}$/.test(url.pathname));
    await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();
    await page.getByRole('button', { name: 'Về danh sách', exact: true }).last().click();
    await page.waitForURL(url => url.pathname + url.search === catalog);
    await page.getByRole('heading', { name: 'Tài sản trong phạm vi phê duyệt', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `t18-scoped-catalog-${mobile ? 'mobile-dark' : 'desktop-light'}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), mobile ? 390 : 1440);
    assert(!calls.some(value => /^(POST|PUT|PATCH|DELETE) \/(?:requests|assets)/.test(value))); assert.deepEqual(errors, []);
    return { width: mobile ? 390 : 1440, theme: mobile ? 'dark' : 'light', lineageLink: true, keyboardRequestLink: true, returnFiltersPreserved: true, businessWrites: 0, minimumHistoryGap:Math.min(...gaps) };
  });
  await test('T18 real UI: Admin sees lineage without unavailable request links', async () => {
    const { next } = await prepare(); const { page, errors } = await newPage();
    await page.goto(new URL('/assets/' + next.id, origin).href); await uiLogin(page, 'admin@congty.com');
    const history = page.locator('.history-timeline'); await history.locator('ol').waitFor();
    assert.equal(await history.locator('a[href^="/requests/"]').count(), 0);
    assert.equal(await history.locator('a[href^="/assets/"]').count(), 1); assert.deepEqual(errors, []);
    return { role: 'ADMIN', requestLinks: 0, lineageLinks: 1 };
  });
  await test('T18 real UI: out-of-scope Approver asset hides metadata and history', async () => {
    const foreignId = 'a2222223-2222-2222-2222-222222222223';
    expectStatus(await call('GET', '/assets/' + foreignId, undefined, approver.accessToken), 403, 'ASSET_SCOPE_DENIED');
    const { page, calls } = await newPage();
    await page.goto(new URL('/assets/' + foreignId, origin).href); await uiLogin(page, 'it.manager@congty.com');
    await page.getByRole('alert').filter({ hasText: /quyền|phạm vi/ }).first().waitFor();
    assert.equal(await page.locator('.history-timeline').count(), 0);
    assert(!calls.some(value => value.includes('/assets/' + foreignId + '/history')));
    return { status: 403, metadataHidden: true, historyReads: 0 };
  });
};
