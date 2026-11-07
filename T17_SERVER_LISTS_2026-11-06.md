# T17 — Danh sách phía server, 06/11/2026

Các danh sách assets, requests, users, audit và notifications hỗ trợ `sortBy` và `sortOrder`. Cột sắp xếp được ánh xạ từ danh sách cho phép. API từ chối tên cột hoặc chiều không hợp lệ trước khi truy vấn DB. ID cùng chiều phân định các dòng có giá trị bằng nhau, giá trị NULL nằm cuối khi yêu cầu sắp xếp rõ ràng.

| Endpoint | Các cột `sortBy` | Thứ tự khi không yêu cầu sắp xếp |
| --- | --- | --- |
| `/api/v1/assets` | `expiresAt`, `createdAt`, `code`, `status`, `type` | Ngày hết hạn tăng dần và ID tăng dần |
| `/api/v1/requests` | `submittedAt`, `updatedAt`, `status`, `type`, `emergency` | Hàng Approver ưu tiên khẩn rồi ngày gửi tăng dần. Danh sách cá nhân theo ngày gửi/cập nhật giảm dần. |
| `/api/v1/users` | `displayName`, `email`, `createdAt`, `lastLoginAt`, `status` | Tên hiển thị và ID tăng dần |
| `/api/v1/audit-logs` | `occurredAt`, `action`, `outcome`, `actor`, `entity` | Thời điểm và ID giảm dần |
| `/api/v1/notifications` | `createdAt`, `type`, `readAt` | Ngày tạo và ID giảm dần |

`sortOrder` nhận `asc` hoặc `desc` và cần `sortBy`. Khi chỉ truyền `sortBy`, chiều mặc định là `asc`. Ví dụ `/api/v1/assets?page=2&pageSize=25&sortBy=expiresAt&sortOrder=desc` trả trang thứ hai theo thời hạn giảm dần. `page` tối đa 1.000.000, `pageSize` tối đa 100, mặc định lần lượt là 1 và 25.

Scope owner, phòng ban phê duyệt và recipient tiếp tục áp dụng trước count và phân trang. Với users, cùng thứ tự được dùng cả lúc chọn ID của trang lẫn lúc ghép metadata vai trò. Thông báo thêm tìm kiếm `search` tối đa 100 ký tự trong loại, mã tài sản và lý do yêu cầu được gắn, đồng thời hỗ trợ lọc `type` của thông báo trong ứng dụng.

Audit Log trước đây bỏ qua bộ lọc khi không truyền page/pageSize. Yêu cầu như `/api/v1/audit-logs?action=ASSET_REVOKED` nay trả kết quả phân trang đã lọc. Các entry point dùng mảng legacy khi không truyền tham số vẫn được giữ, gồm `/audit-logs?limit=50`.

## Bằng chứng hiện tại

[Backend 304/304](tools/test-artifacts/server-lists-20261106/backend-unit.json) đạt sau thay đổi. Các ca mới gọi entry point danh sách để kiểm tên cột độc hại, query lặp dạng mảng, scope, biến bind, phân định ID, cùng thứ tự ở hai tầng users và bộ lọc audit không có page.

Runner runtime LOGIN đã bổ sung fixture 600 dòng phù hợp mỗi danh sách và 120 dòng ngoài scope cho assets/requests/notifications. Nó sẽ đối chiếu sáu trang có dữ liệu và một trang rỗng theo cả hai chiều với dữ liệu DB, kiểm scope User/Approver, tổng và query plan `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)` cho count lẫn trang. Kịch bản đã đạt trong [runtime LOGIN 48/48](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/runtime-privileges-70488ce7aad4/results.json). Cả 12 tổ hợp có đúng tổng 600 và đủ bảy trang theo thứ tự từ PostgreSQL. Mười query plan có thời gian thực thi 0,475–3,739 ms trong fixture này.

T50 đã đo danh sách qua HTTP với 50.000 tài sản và 250.000 audit. Ở mức 16 yêu cầu đồng thời, danh mục trang đầu và trang sâu đạt mốc thử sau khi giới hạn trang trước khi ghép metadata. Migration 017 giảm p95 truy vấn Audit Log trong kịch bản từ 507,4 xuống 131,7–153,4 ms. Chỉ số tải và p95 nghiệm thu cần được chốt trên cấu hình đích. [Báo cáo T50](T50_CAPACITY_2026-11-06.md)
