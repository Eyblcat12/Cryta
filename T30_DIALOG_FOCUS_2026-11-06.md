# T30 — Giữ focus trong dialog đang gửi,06/11/2026

Đã sửa lỗi bàn phím có thể tái hiện trên4 dialog: request, quyết định, tạo người dùng và gửi email thử. Khi form đang gửi, Tab từ nút Đóng trước đây đưa focus ra body. Nay focus giữ ở nút Đóng, là control duy nhất còn hoạt động trong dialog ở trạng thái này. Không đổi workflow, bố cục hoặc CSS.

## Nguyên nhân và bản sửa

[useDialogBehavior](frontend/src/WorkspaceUi.tsx) chọn control bằng `:not([disabled])`, nhưng input/textarea bị vô hiệu hóa qua `fieldset disabled` thường không có attribute disabled riêng. Browser coi chúng là `:disabled`; code trap vẫn dùng chúng làm tab stop cuối. Tab mặc định bỏ qua các control đó và thoát dialog.

Bộ lọc chung nay thêm `!element.matches(':disabled')`, dùng semantics fieldset của browser thay vì giả định attribute trên từng control. Các nhánh Escape, return focus, scroll reveal và xử lý dialog trên cùng giữ implementation hiện có. Đây là sửa hành vi đã có, không đưa prototype skeleton vào sản phẩm.

## Đối chứng lỗi và kiểm sau sửa

[Before](tools/test-artifacts/spa/dialog-focus-20261106-before/results.json) **0/16**, Edge156.0.4314.58, tất cả lỗi tại Tab đầu tiên: active element BODY/null. Bốn loại dialog ×desktop/mobile ×light/dark đều có controls attributeDisabled=false nhưng actuallyDisabled=true. Build trước là `sWnhGYiW/CRAMZK9_`, source trước khớp snapshot pha [delayed GET](T30_DELAYED_GET_2026-11-06.md).

[Runner](tools/test-spa-dialog-focus.cjs) dùng API fixture và giữ response mutation; control bị disabled thật trong DOM, không chỉ gán class. Mỗi ca nhấn Tab/Tab/Shift+Tab/Shift+Tab/Tab, kiểm active element thuộc dialog và nút Đóng, một mutation fixture, không pageerror. Chỉ trạng thái/tag/focus được ghi; không body hoặc mật khẩu.

| Browser/mode | Kết quả | Report |
| --- | --- | --- |
| Edge156.0.4314.58 ON |16/16|[report](tools/test-artifacts/spa/dialog-focus-20261106-msedge-on-after-final/results.json)|
| Edge156.0.4314.58 OFF |16/16|[report](tools/test-artifacts/spa/dialog-focus-20261106-msedge-off-after-final/results.json)|
| Chrome157.0.8103.39 ON |16/16|[report](tools/test-artifacts/spa/dialog-focus-20261106-chrome-on-after-final/results.json)|
| Chrome157.0.8103.39 OFF |16/16|[report](tools/test-artifacts/spa/dialog-focus-20261106-chrome-off-after-final/results.json)|
| Firefox153.0/Gecko ON |16/16|[report](tools/test-artifacts/spa/dialog-focus-20261106-firefox-on-after-final/results.json)|
| Firefox153.0/Gecko OFF |16/16|[report](tools/test-artifacts/spa/dialog-focus-20261106-firefox-off-after-final/results.json)|

Tổng **96 nhóm/480 phím**, có Chromium và Gecko thực. Frontend [131/131 unit](tools/test-artifacts/unit/dialog-focus-20261106-frontend/results.json), [build ON](tools/test-artifacts/unit/dialog-focus-20261106-frontend/build-on.log)/[OFF](tools/test-artifacts/unit/dialog-focus-20261106-frontend/build-off.log) exit0. JS ON `index-BWV_OzFu.js`, OFF `index-DFRUkWzt.js`; CSS vẫn `index-CRAMZK9_.css`.

Lượt [after đầu0/16](tools/test-artifacts/spa/dialog-focus-20261106-msedge-on-after/results.json) qua các phím rồi lỗi assertion `x.startsWith is not a function`: fixture mutation là object, harness nhầm string. Đã sửa kiểm đúng endpoint/object, giữ kiểm bàn phím và lưu sáu lượt final riêng; không tính lượt lỗi đó là pass. Before16 lỗi focus vẫn là đối chứng độc lập, không đổi thành lỗi harness.

## Hồi quy và bàn giao

[Edge180/180](tools/test-artifacts/spa/dialog-focus-20261106/full-msedge/results.json), [Chrome180/180](tools/test-artifacts/spa/dialog-focus-20261106/full-chrome/results-chrome.json), [Firefox180/180](tools/test-artifacts/spa/dialog-focus-20261106/full-firefox/results-firefox.json) chạy lại **toàn suite không filter**, EXIT0, trên bundle ON mớiBWV_OzFu/CRAMZK9_. Có dirty form, nested confirm, focus/keyboard/scroll, mutation, query, session boundary, media preference và routing. Không gán180 của các bundle cũ thành kết quả này.

[Visual4/4](tools/test-artifacts/spa/dialog-focus-20261106/visual-02/results.json) kiểm Request dialog pending ở1440/390 ×light/dark, active close `:focus-visible`, outline có và rect nằm trong viewport. Đã xem [desktop light](tools/test-artifacts/spa/dialog-focus-20261106/visual-02/pending-1440-light.png) và [mobile dark](tools/test-artifacts/spa/dialog-focus-20261106/visual-02/pending-390-dark.png); focus hiển thị tại Đóng, không bị footer che. Không dùng outline-present check để tuyên bố contrast/WCAG đầy đủ. [Visual lượt đầu0/4](tools/test-artifacts/spa/dialog-focus-20261106/visual-01/results.json) giữ lỗi locator chọn cả fieldset ngoài và fieldset con kế thừa disabled; đã thu hẹp selector đúng mutation fieldset và lưu lượt2 riêng.

[Snapshot205 file](tools/test-artifacts/frontend-artifacts/dialog-focus-20261106-final/source-manifest.json), SHA-256 `b3ad45e4f6c23780d8e1c491abef26629f8250f9649431181a0d1e963ab2cd25`; chỉ WorkspaceUi.tsx là application source đổi so pha trước. [Verifier](tools/test-artifacts/frontend-artifacts/dialog-focus-20261106-final/evidence-verification.json) khớp205 source files,6 build files, before16 lỗi đúng symptom, FE131,96 nhóm/480 phím và180 mỗi browser/visual4. Đây là kiểm bằng chứng đã lưu, không chạy lại test.

[Host cleanup](tools/test-artifacts/spa/dialog-focus-20261106/host-cleanup.json) xác nhận11 preview process của các lượt before/after/full/visual đã thoát, listener4173 và esbuild0. [Full preview cleanup](tools/test-artifacts/spa/dialog-focus-20261106/full-preview-cleanup.json) có EXIT0 đủ ba browser. Không dùng hoặc thay Docker trong lượt frontend này.

## Phạm vi

Đây là fixture keyboard regression, không gọi SMTP/provider/database thật, không chứng minh mọi modal/stacked dialog hoặc nghe announcement bằng screen reader. Chưa đóng T30/N5/N6 hoặc toàn bộ WCAG audit. Backend application source không thay đổi;186/186 unit và26/26 real integration mỗi Edge/Chrome thuộc các pha trước, không gán cho lượt này. [Toàn54+6 task](TASK_STATUS_2026-11-05.md) và Goal vẫn mở.
