# T30-N4 — Reference trong dialog ngày 05/10/2026

Lát cắt tiếp theo của review `T30_LOADING_REVIEW_2026-10-04.md`: tên truy cập mật khẩu ban đầu, trạng thái chờ danh mục phòng ban khi tạo người dùng và chính sách khi tạo yêu cầu. Áp dụng skill `reporter-enterprise-ui-ux`; giữ workflow và CSS hiện có. Toàn bộ HTTP business của harness là fixture, không gọi backend, PostgreSQL, SMTP hoặc provider vận hành.

## Trước sửa

[Kết quả gốc](tools/test-artifacts/spa/t30-20261005/dialog-references-before/results.json): Edge `154.0.4258.53`, viewport 1440 × 1000, light; bundle `index-BKxJgvfI.js` / `index-CTxLXPoY.css`; **4/11**, EXIT 1. Lượt chạy được thực hiện trước sửa source.

- Accessible label của input mật khẩu ban đầu không tồn tại; tìm qua label trả 0 input.
- Vùng danh mục phòng ban và chính sách chưa có nhóm busy/status; fast/slow reference cases chưa đạt hợp đồng pending.
- Kết quả reference rỗng đã có thông báo, nhưng selector phòng ban/chính sách vẫn enabled.
- Bốn ca đã đạt trước sửa: hai reference 503 giữ draft và retry GET; hai reference 403 bỏ option/khóa submit và không POST. Không mô tả các ca đã đúng này thành lỗi đã sửa.

## Thay đổi source

`WorkspaceDialogs.tsx` liên kết password label và input bằng `useId`/`htmlFor`; giữ input type password và thứ tự input → Hiện → Tạo lại. Department và policy dùng nhóm riêng có `aria-busy`, placeholder phân biệt chờ/lỗi/rỗng, status delayed 180 ms cùng một dòng dành sẵn để mạng nhanh không làm nhấp nháy status. Name/email/reason/role/close vẫn dùng được khi reference đang chờ.

CreateUser handler/button kiểm tra reference đã đọc hợp lệ, department hiện có và scope đã chọn còn trong danh mục; chưa biết/lỗi/rỗng khóa hành động phụ thuộc reference. CREATE request handler/button kiểm tra version đã chọn còn thuộc compatible policies của lần đọc hiện tại. Retry giữ GET theo nguồn và không tự gửi POST. Không thêm dependency, sửa backend hoặc thay mô hình navigation.

## Sau sửa trên production preview

Harness riêng `tools/test-spa-dialog-references.cjs` có 11 ca: label/focus password, fast <180 ms không status flash, slow delayed status/giữ focus/khóa action, 503 giữ draft/GET retry, 403 và empty cho cả hai nguồn. Harness giữ bundle trước/sau run để phát hiện preview đổi giữa lượt; ghi actual browser engine, viewport/theme và screenshot các trạng thái. `node --check` đạt sau thay đổi cuối.

Ba lượt AFTER trên `index-sWnhGYiW.js` / `index-CRAMZK9_.css` đều **11/11**, EXIT 0; tổng 33/33:

| Browser thực tế | Engine | Viewport / theme | Kết quả |
| --- | --- | --- | --- |
| Edge 154.0.4258.53 | chromium | 1440 × 1000 / light | [11/11](tools/test-artifacts/spa/t30-20261005/dialog-references-edge-after/results.json) |
| Chrome 154.0.8037.97 | chromium | 390 × 1000 / dark | [11/11](tools/test-artifacts/spa/t30-20261005/dialog-references-chrome-after/results.json) |
| Firefox 153.0 | firefox | 390 × 1000 / dark | [11/11](tools/test-artifacts/spa/t30-20261005/dialog-references-firefox-after/results.json) |

Đã xem screenshot department slow desktop/light và policy 503 mobile/dark: focus email/reason còn nguyên, placeholder và lỗi/thử lại đọc được, footer khóa submit; password được che trong screenshot. Các ca 503/403/empty không tạo POST; retry chỉ đọc lại nguồn reference. Không sửa product sau build cho các lượt này.

Giới hạn: evidence này là HTTP fixture + DOM/keyboard/screenshot, không kiểm chứng backend/PostgreSQL/SMTP/provider hoặc đọc bằng screen reader. Không đóng toàn bộ N4/NAV-29, N5/L hoặc T30 từ lát cắt reference; detail loading, zoom/reflow và review accessibility đầy đủ cần evidence riêng.
