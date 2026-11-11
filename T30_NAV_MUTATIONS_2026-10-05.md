# T30 — Bằng chứng NAV-13 / NAV-15 ngày 05/10/2026

Harness riêng `tools/test-spa-navigation-mutations.cjs` bổ sung các thao tác thành công qua UI và URL bằng HTTP fixture, tái sử dụng fixture/export hiện có. Không sửa app, API, shared fullsuite hoặc workflow để đạt test. Browser engine được ghi từ runtime thực tế; có tùy chọn viewport/theme, filter và thư mục artifact.

## Kết quả production preview

Bundle ON `index-sWnhGYiW.js` / `index-CRAMZK9_.css` giữ nguyên trước/sau mỗi lượt. Hai lượt final đều EXIT 0, tổng **16/16**:

| Browser / engine | Viewport / theme | Kết quả |
| --- | --- | --- |
| Edge 154.0.4258.53 / chromium | 1440 × 1000 / light | [8/8](tools/test-artifacts/spa/t30-20261005/navigation-mutations-edge-final/results.json) |
| Chrome 154.0.8037.97 / chromium | 390 × 1000 / dark | [8/8](tools/test-artifacts/spa/t30-20261005/navigation-mutations-chrome-final/results.json) |

Harness hỗ trợ Firefox (`playwright.firefox`, không channel), nhưng không có lượt Firefox cho suite NAV trong báo cáo này. [Lượt Edge đầu](tools/test-artifacts/spa/t30-20261005/navigation-mutations-edge-after/results.json) đạt 6/8: hai ca access dừng ở strict locator vì cả inline notice và toast cùng báo thành công. Sửa duy nhất locator trong harness để giới hạn vào region phân quyền rồi chạy lại đầy đủ; không mô tả lỗi bộ chọn này thành lỗi product.

## NAV-13: cấp và sửa quyền

- Cấp `person-1` từ USER thành APPROVER, scope `department-1`, trên trang một; sửa `person-21` từ APPROVER thành USER, bỏ scope, trên trang hai.
- Chọn đúng người dùng, kiểm tra vai trò trước thay đổi, xác nhận qua checkbox và lưu đúng một PUT `/users/{id}/access`; payload đúng roles/scopes của tài khoản đã chọn.
- Sau acknowledgment, resource người dùng GET lại đúng trang phân quyền. Mở lại form thấy quyền mới; sang bảng Users rồi F5 vẫn thấy quyền mới, không gửi thêm write. Fixture chỉ cập nhật state khi đã nhận đúng mutation từ UI.

Đây là lát cắt success access của NAV-13. Tạo tài khoản, thay đổi status và policy mutation thuộc evidence khác; suite này không đại diện toàn bộ NAV-13.

## NAV-15: CREATE / RENEW / REVOKE

Mỗi type chạy hai cách mở: hành động UI hiện có và URL `/requests/new?type=…`, kèm `assetId=asset-300` cho RENEW/REVOKE. Radio/type và đối tượng được xác nhận trước submit. REVOKE cần bước xác nhận hiện có, click đầu không tạo POST.

CREATE gửi đúng policy `version-1`, không target asset, parameter `assetType: KEY`. RENEW/REVOKE đọc lại `/assets/asset-300`; API detail fixture có version 9 và policy `asset-policy-9`, khác snapshot danh sách `version-1`. Một POST `/requests` phải dùng ID `asset-300` và policy mới từ detail. Reason, emergency và parameters được đối chiếu; không chấp nhận POST dùng policy của snapshot danh sách.

Sau acknowledgment, về danh sách theo workflow hiện tại, mở request vừa tạo từ item UI. Cả lần mở và F5 ở `/requests/fixture-created` đều GET đúng ID, hiển thị đúng reason; không gửi lại POST. GET detail của request vừa tạo được override trong harness dựa trên payload POST thực tế, mô hình hóa request version 1. Không ép app tự chuyển ngay đến URL detail sau submit.

## Giới hạn hợp đồng và evidence

Access API hiện dùng PUT roles/scopes, không có expectedVersion. CreateRequest DTO có policyVersionId/targetAssetId nhưng không có expected asset/request version; harness không tạo thêm field hoặc đổi API. Version 9 của asset và version 1 của request là metadata GET fixture, không phải version được gửi trong POST tạo yêu cầu.

Updated user reads và created request GET là state giả lập sau mutation, không chứng minh PostgreSQL persistence, phân quyền/concurrency thật, provider completion, SMTP hoặc integration. Không đóng T30 hay các task integration từ 16 ca này. Suite không ghi password/token/credential hoặc gọi dịch vụ vận hành.
