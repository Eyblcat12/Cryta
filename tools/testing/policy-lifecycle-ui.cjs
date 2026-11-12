const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function verifyPolicyLifecycle({ test, call, expectStatus, admin, dev, newPage, uiLogin, origin, output, stamp, sql }) {
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
    await test('T20 real UI: policy lifecycle and conflict recovery at ' + width + 'px', async () => {
      const { page, calls, errors } = await newPage({ width, height: 900 });
      const code = ('T20_' + stamp + '_' + width).toUpperCase();
      const name = 'Policy kiểm thử ' + width;
      await page.addInitScript(value => localStorage.setItem('crypta-theme', value), theme);
      await page.goto(new URL('/policies', origin).href);
      await uiLogin(page, 'admin@congty.com');
      const create = page.getByRole('button', { name: 'Tạo chính sách', exact: true });
      await create.focus();
      await page.keyboard.press('Enter');
      const editor = page.getByRole('dialog', { name: 'Tạo chính sách', exact: true });
      await editor.getByLabel('Mã chính sách').fill(code);
      await editor.getByLabel('Tên chính sách').fill(name);
      await editor.getByLabel('Loại cấu hình').selectOption('ECDSA');
      await editor.getByLabel('Độ dài khóa tối thiểu').selectOption('384');
      await editor.getByLabel('Thời hạn tối đa').fill('120');
      await editor.getByRole('checkbox').check();
      const fieldHeights = await editor.locator('.form-field :is(input, select)').evaluateAll(fields =>
        fields.map(field => field.offsetHeight));
      assert.ok(fieldHeights.length >= 5 && fieldHeights.every(height => height >= 40), 'Policy field heights: ' + fieldHeights.join(', '));
      await page.screenshot({ path: path.join(output, 't20-create-' + theme + '.png'), animations: 'disabled' });
      await editor.getByRole('button', { name: 'Phát hành phiên bản' }).click();
      const row = page.getByRole('row').filter({ hasText: code });
      await row.getByText('v1', { exact: true }).waitFor();
      const current = expectStatus(await call('GET', '/policies/admin', undefined, admin.accessToken), 200).find(item => item.code === code);
      assert.ok(current && /^[a-f0-9-]{36}$/.test(current.id));
      assert.equal(current.latest.configuration.minimum_key_size, 384);
      await row.getByRole('button', { name: 'Tạo phiên bản' }).click();
      const version = page.getByRole('dialog', { name: /Tạo phiên bản/ });
      await version.getByLabel('Thời hạn tối đa').fill('180');
      await version.getByRole('checkbox').check();
      const payload = { expectedVersion: 1, algorithm: 'ECDSA', minimumKeySize: 384, maximumValidityDays: 150, warningDays: [30, 7, 1] };
      const versionPath = '/policies/' + current.id + '/versions';
      expectStatus(await call('POST', versionPath, payload, admin.accessToken), 201);
      await version.getByRole('button', { name: 'Phát hành phiên bản' }).click();
      const alert = version.getByRole('alert').filter({ hasText: 'Nội dung đã nhập được giữ lại' });
      await alert.waitFor();
      assert.equal(await version.getByLabel('Thời hạn tối đa').inputValue(), '180');
      await page.screenshot({ path: path.join(output, 't20-conflict-' + theme + '.png'), animations: 'disabled' });
      await alert.getByRole('button', { name: 'Kiểm tra phiên bản mới' }).click();
      await version.getByText('v3', { exact: true }).waitFor();
      assert.equal(await version.getByRole('checkbox').isChecked(), false);
      await version.getByRole('checkbox').check();
      await version.getByRole('button', { name: 'Phát hành phiên bản' }).click();
      await row.getByText('v3', { exact: true }).waitFor();

      await row.getByRole('button', { name: 'Lịch sử' }).click();
      const history = page.getByRole('dialog', { name: /Lịch sử/ });
      await history.getByLabel('Phiên bản gốc').selectOption('1');
      await history.getByRole('cell', { name: '120 ngày', exact: true }).waitFor();
      await history.getByRole('cell', { name: '180 ngày', exact: true }).waitFor();
      assert.ok(await history.locator('.policy-comparison').evaluate(table =>
        table.parentElement.scrollWidth <= table.parentElement.clientWidth));
      await page.screenshot({ path: path.join(output, 't20-history-' + theme + '.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await history.waitFor({ state: 'hidden' });

      await row.getByRole('button', { name: 'Ngừng áp dụng' }).click();
      const stop = page.getByRole('dialog', { name: /Ngừng áp dụng/ });
      await page.screenshot({ path: path.join(output, 't20-stop-' + theme + '.png'), animations: 'disabled' });
      await stop.getByRole('button', { name: 'Xác nhận ngừng áp dụng' }).click();
      await row.getByText('Đã ngừng áp dụng').waitFor();
      assert.equal(await row.getByRole('button', { name: 'Tạo phiên bản' }).count(), 0);
      assert.equal(await row.getByRole('button', { name: 'Lịch sử' }).isEnabled(), true);
      const available = expectStatus(await call('GET', '/policies', undefined, dev.accessToken), 200);
      assert.ok(!available.some(item => item.policyId === current.id));
      const audit = JSON.parse(sql("SELECT jsonb_agg(action ORDER BY id) FROM audit_logs WHERE entity_type='POLICY' AND entity_id='" + current.id + "' AND outcome='SUCCESS'"));
      assert.deepEqual(audit, ['POLICY_CREATED', 'POLICY_VERSION_CREATED', 'POLICY_VERSION_CREATED', 'POLICY_DEACTIVATED']);
      await page.reload();
      await row.getByText('Đã ngừng áp dụng').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      assert.equal(calls.filter(value => value === 'POST /policies').length, 1);
      assert.equal(calls.filter(value => value === 'POST ' + versionPath).length, 2);
      assert.equal(calls.filter(value => value === 'PATCH /policies/' + current.id + '/deactivate').length, 1);
      assert.deepEqual(errors, []);
      return { width, theme, audit, staleSubmissionPreserved: true, versionsCompared: [1, 3], excludedFromRequestPicker: true };
    });
  }
  await test('T20 real UI/API: regular users cannot load or mutate admin policies', async () => {
    const { page, calls, errors } = await newPage();
    await page.goto(new URL('/policies', origin).href);
    await uiLogin(page, 'dev.nguyen@congty.com');
    await page.getByRole('heading', { name: 'Bạn không có quyền mở trang này', exact: true }).waitFor();
    assert.equal(calls.filter(value => value.includes('/policies/admin')).length, 0);
    expectStatus(await call('GET', '/policies/admin', undefined, dev.accessToken), 403, 'ADMIN_REQUIRED');
    expectStatus(await call('POST', '/policies', {
      code: 'DENIED_T20', name: 'Denied T20', algorithm: 'RSA', minimumKeySize: 2048, maximumValidityDays: 90, warningDays: [30],
    }, dev.accessToken), 403, 'ADMIN_REQUIRED');
    assert.deepEqual(errors, []);
    return { forbiddenUi: true, privilegedReadsFromUi: 0, apiReadStatus: 403, apiWriteStatus: 403 };
  });
};
