# T30 — Viền focus rõ trên hai theme,06/11/2026

Đã sửa hai lỗi CSS: viền focus chung chỉ pha32% màu xanh nên nhạt, và radio Loại yêu cầu dùng input opacity0 nhưng chưa có chỉ báo focus trên label. Viền chung nay dùng nguyên token blue hiện có; label radio có outline khi input nhận `:focus-visible`. Không đổi kích thước, layout, DOM hoặc JavaScript ứng dụng.

W3C nêu chỉ báo focus do tác giả định dạng cần tương phản ít nhất3:1 với màu liền kề; người dùng bàn phím cần thấy control nào đang focus. Phạm vi kiểm này dựa trên [SC1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) và [SC2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html), chưa phải xác nhận toàn hệ thống tuân thủ WCAG.

## Đối chứng và cách đo

[Before đã kiểm đầy đủ](tools/test-artifacts/spa/focus-contrast-20261106-before-verified/results.json) chạy trên build cũ snapshot205 đã pin hash, không rollback workspace: **0/100**,24 nhóm setup thành công, không lỗi đo. Có96 viền có cận tương phản1,574–2,338:1, toàn bộ cận trên dưới3;4 ca radio focus input nhưng label có outline-style none. Build beforeBWV_OzFu/CRAMZK9_ là pha [focus trap](T30_DIALOG_FOCUS_2026-11-06.md).

[Runner](tools/test-spa-focus-contrast.cjs) kiểm25 control trong6 flow login/request/create-user/decision/help/email ×1440/390 ×light/dark. Màu computed lấy từ browser, alpha được composite trong sRGB rồi tính [relative luminance/contrast theo W3C](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance). Không làm tròn trước so3:1. Với nền panel dark có gradient trắng3,2%, lấy bao4% và cận luminance độc lập để tính lower bound bảo thủ. Cận này bao cả vị trí trong gradient và khác biệt serialize alpha; không gọi nó là màu chính xác tại từng pixel. Nền gradient/opacity khác bị từ chối, không tự coi là đạt.

Đối với radio opacity0, phép đo kiểm label là nơi vẽ chỉ báo và đồng thời xác nhận input native có focus-visible. Chưa bao gồm mọi control/link, ảnh nền/backdrop-filter, forced-colors native, screen reader hoặc toàn bộ clipping/raster. Không submit form, lưu password/body hoặc gọi API/provider/SMTP thật.

## Sau sửa

| Browser | ON | OFF |
| --- | --- | --- |
| Edge156.0.4314.58 |[100/100](tools/test-artifacts/spa/focus-contrast-20261106-msedge-on-after/results.json)|[100/100](tools/test-artifacts/spa/focus-contrast-20261106-msedge-off-after/results.json)|
| Chrome157.0.8103.39 |[100/100](tools/test-artifacts/spa/focus-contrast-20261106-chrome-on-after/results.json)|[100/100](tools/test-artifacts/spa/focus-contrast-20261106-chrome-off-after/results.json)|
| Firefox153.0/Gecko |[100/100](tools/test-artifacts/spa/focus-contrast-20261106-firefox-on-after/results.json)|[100/100](tools/test-artifacts/spa/focus-contrast-20261106-firefox-off-after/results.json)|

Tổng **600/600 checks**, không lỗi setup/đo, cận tương phản thấp nhất **4,644490237…:1**. Đã xem [radio desktop light](tools/test-artifacts/spa/focus-contrast-20261106-msedge-on-after/request-request-kind-1440-light.png) và [mobile dark](tools/test-artifacts/spa/focus-contrast-20261106-msedge-on-after/request-request-kind-390-dark.png): viền trên label hiện rõ, không thay layout.

[Hai build](tools/test-artifacts/unit/focus-contrast-20261106-frontend/build-results.json) exit0. CSS mớiCWPkO1Nq, JS file ON/OFF đổi tênBYt9mBPj/C1Inveug do graph build, nhưng **byte JavaScript ON/OFF giống pha trước**. Không chạy lại unit131 hoặc full180 mỗi browser vì thay đổi chỉ CSS; giữ chúng trong [pha focus trap trước](T30_DIALOG_FOCUS_2026-11-06.md), không gán là kết quả chạy mới.

[Radio keyboard12/12](tools/test-artifacts/spa/focus-contrast-20261106/radio-keyboard-01/results.json) dùng Tab và ArrowRight native trên Edge/Chrome/Firefox ×1440/390 ×light/dark: CREATE→RENEW→REVOKE→CREATE, Shift+Tab trở về Đóng rồi Tab vào lại. Chỉ báo đi theo radio đang focus, cùng màu với native outline,3px, nằm trong viewport; không có mutation. Đây là kiểm tương tác thật của browser, không nghe announcement bằng screen reader.

[Snapshot206 file](tools/test-artifacts/frontend-artifacts/focus-contrast-20261106-final/source-manifest.json), SHA-256 `851a687b1bef234ecc6155c29b15a11dd5888af9cab869092ccfc633a683baf7`. [Verifier](tools/test-artifacts/frontend-artifacts/focus-contrast-20261106-final/evidence-verification.json) kiểm source/build hashes, tính lại độc lập cận màu của600 sample, pin runtime before snapshot205 và xác nhận JS hai mode giữ byte. [Cleanup](tools/test-artifacts/spa/focus-contrast-20261106/host-cleanup.json) xác nhận10 preview process còn0, listener4173/esbuild0. Không dùng hoặc thay Docker trong lượt CSS này.

## Các lượt đo bị giới hạn

[Lượt đầu](tools/test-artifacts/spa/focus-contrast-20261106-before/results.json) có92 samples,2 setup Help mobile thất bại và32 ca gradient bị từ chối. [Lượt kế](tools/test-artifacts/spa/focus-contrast-20261106-before-final/results.json) đủ100 samples nhưng36 ca gradient còn bị từ chối; chỉ62 ca viền có số đo và2 radio light được kiểm hình thức. Các lượt này được giữ, không tính thành đối chứng100 đầy đủ. Sau khi sửa chờ shell mobile và bao alpha gradient, mới dùng before-verified0/100 nêu trên.

Trong baseline mode, `sourceHashes` của report là workspace lúc capture; runtime before được xác định bởi đường dẫn build cũ và manifest snapshot205 đã kiểm trước chạy. Không dùng hash CSS workspace sau sửa để tuyên bố đó là source before. Source/body dữ liệu và mã đo cùng được giữ để đối chiếu.

T30/N5/N6, screen reader và [toàn bộ54+6 task](TASK_STATUS_2026-11-05.md) vẫn mở. Viền rõ hơn không thay nghiệm thu mọi tiêu chí trợ năng hoặc hiệu năng.
