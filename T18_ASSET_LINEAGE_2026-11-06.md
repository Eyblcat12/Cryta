# T18 — Lịch sử và chuỗi tài sản, 06/11/2026

Lịch sử phân trang tại `/api/v1/assets/:id/history` đã bổ sung mốc bắt đầu gửi và nhận kết quả provider từ `sent_at` và `receipt_at`. Những mốc thiếu dấu thời gian được bỏ qua. Quyết định đã ghi ở `request_decisions` được dùng khi thiếu audit thành công tương ứng, tránh lặp lại quyết định đã có trong audit.

Count và trang dữ liệu dùng cùng tập sự kiện đã lọc theo quyền. Các mốc quyết định/provider chỉ lấy từ yêu cầu đã gửi, gắn với tài sản mục tiêu hoặc kết quả và nằm trong quyền của người đọc. API chỉ trả tên sự kiện, thời điểm, người thực hiện, outcome và mã yêu cầu. Biên nhận, tham chiếu provider và nhận xét phê duyệt được giữ ngoài projection lịch sử này.

Giao diện hiện có đã bổ sung nhãn tiếng Việt cho sự kiện sắp hết hạn và các thao tác đối soát. Phần policy hiển thị phiên bản policy đã gắn, tách khỏi phiên bản metadata tài sản. Lịch sử tải lại khi revision tài sản hoặc phiên bản metadata thay đổi.

## Bằng chứng cục bộ

| Kiểm tra | Kết quả |
| --- | --- |
| Backend unit | [305/305](tools/test-artifacts/asset-lineage-20261106/backend-unit.json) |
| Frontend unit | [145/145](tools/test-artifacts/asset-lineage-20261106/frontend-unit.json) |
| Build | Backend và frontend bật/tắt chuyển động đạt |
| PostgreSQL/API | Đã bổ sung kiểm trong runner runtime LOGIN, còn chờ thực thi sau khi hạn mức duyệt Docker hoạt động lại |

Kịch bản DB mới kiểm mốc yêu cầu, quyết định và provider trong lịch sử bản cũ lẫn bản mới sau gia hạn, kiểm liên kết trước/sau, thu hồi và phân trang ba sự kiện mỗi trang. Nó cũng kiểm sự kiện hết hạn. Các ca chuyển đơn vị đã có tiếp tục kiểm việc ẩn sự kiện yêu cầu ngoài phạm vi. Những kịch bản mới cần chạy trên PostgreSQL để xác nhận truy vấn hợp nhất hoạt động đúng. [Runner runtime](tools/testing/runtime-privileges-runner.cjs), [runner chuyển đơn vị](tools/test-real-departments.cjs).

## Giao diện đã được duyệt và tích hợp

[Mẫu T18](tools/design-previews/asset-lineage/index.html) đã được chủ dự án duyệt ngày 06/11 với lựa chọn “Duyệt, tích hợp theo mẫu”. Đã thêm route/menu danh mục tài sản của Approver và bảng tìm kiếm/phân trang theo API có scope. Chi tiết giữ lịch sử phân trang, liên kết tài sản trước/sau và liên kết yêu cầu cho vai trò được mở trang yêu cầu. Admin vẫn xem mã yêu cầu dưới dạng văn bản. Việc gia hạn/thu hồi giữ điều kiện owner và vai trò User.

Liên kết chuỗi và yêu cầu giữ điểm về danh sách cùng bộ lọc theo user/role; khi lịch sử tải hoặc lỗi, liên kết bị khóa. Frontend sau tích hợp đạt [147/147 unit](tools/test-artifacts/asset-lineage-20261106/frontend-approved-unit.json) và build bật/tắt chuyển động. Kịch bản [T18 UI thật](tools/testing/asset-lineage-ui.cjs) đã thêm bốn nhóm: desktop sáng, mobile tối, Admin không có link yêu cầu ngoài route và Approver ngoài scope không đọc metadata/history. Kịch bản tạo/gia hạn/thu hồi bằng API/worker thật, sau đó kiểm điều hướng, Enter trên link và giữ bộ lọc khi trở về; đã qua [Edge 32/32](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/real-msedge-1793965266140/results.json) và [Chrome 32/32](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/real-chrome-1793965524000/results.json), gồm hồi quy chung.

Đã đối chiếu ảnh mẫu và ảnh thật ở 1440px sáng và 390px tối. Bản đầu để mã yêu cầu dài gây khó đọc trên mobile. Bản hiện tại rút gọn nhãn hiển thị, giữ mã đầy đủ trong tên trợ năng và đường dẫn, đo khoảng cách tối thiểu 18px ở cả hai kích thước. Chuỗi cấp mới, gia hạn và thu hồi đã qua UI/API/DB. Expiry đã qua [PostgreSQL 19/19](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/expiry-scan-c4bd492b28b7/results.json), còn nghiệm thu hết hạn xuyên suốt UI. Không dùng unit/build thay cho nghiệm thu trình duyệt. [Snapshot mã/build hiện tại](tools/test-artifacts/audit-correlation-20261106/source-snapshot.json).
