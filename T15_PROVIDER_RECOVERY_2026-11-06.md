# T15 — Retry và đối soát provider, 06/11/2026

Worker chỉ tự lên lịch lại lỗi khóa, deadlock hoặc serialization khi nhật ký giao dịch chứng minh lượt xử lý hiện tại chưa gửi. Hai mốc chờ là 15 và 60 giây. Mỗi lần claim có phiên bản riêng. Sau hai lượt tự động, yêu cầu chuyển sang hàng đối soát. Admin có thể lên lịch thêm một lượt, trong giới hạn tổng cộng ba lượt đã lên lịch.

Lỗi sau mốc gửi được đưa vào đối soát. Một phản hồi HTTP lỗi hoặc nhật ký cũ chưa đủ để thử lại. Nếu provider đã trả kết quả hợp lệ, worker lưu metadata cho phép cùng mã băm đầu vào trước giao dịch ghi tài sản. Admin có thể áp dụng biên nhận nếu đầu vào, tài sản mục tiêu và cấu hình provider vẫn khớp. Thao tác dùng biên nhận có sẵn và hoàn tất trong một giao dịch gồm tài sản, trạng thái, audit và thông báo.

## API dành cho Security Admin

| API | Kết quả |
| --- | --- |
| `GET /api/v1/operations/provider-issues` | Danh sách phân trang. Có thể lọc `RECONCILIATION_REQUIRED`, `RETRY_SCHEDULED` hoặc `FAILED`. |
| `GET /api/v1/operations/provider-issues/:id` | Số lần gửi, số lượt đã lên lịch, mốc gửi/nhận, phân loại lỗi, thao tác được phép và lịch sử vận hành gần đây. |
| `POST /api/v1/operations/provider-issues/:id/actions` | Body gồm `version`, `action`, `reason` dài 10–500 ký tự sau khi bỏ khoảng trắng đầu cuối. `RETRY` chỉ dành cho lỗi tạm thời đã biết chưa gửi, `ABANDON` cho trường hợp đã biết chưa gửi và `CONFIRM` cho biên nhận khớp. |

API kiểm tra lại quyền và phiên bản khi ghi. Trường hợp đóng do lỗi chuyển yêu cầu sang `FAILED` và tạo thông báo trong ứng dụng lẫn email. API trả mã lỗi đã lọc, dấu thời gian và cờ biên nhận. Metadata biên nhận, tham chiếu provider và nội dung lỗi thô được giữ ngoài phản hồi vận hành.

## Kiểm thử và nâng cấp

| Kiểm tra | Kết quả |
| --- | --- |
| Backend và frontend | [267/267 backend](tools/test-artifacts/integration/crypta-t30-test-3a831597330c/backend-unit.json), [136/136 frontend](tools/test-artifacts/integration/crypta-t30-test-3a831597330c/frontend-unit.json), hai build đạt |
| Worker và PostgreSQL | [25/25](tools/test-artifacts/integration/crypta-t30-test-3a831597330c/worker-recovery-after-e0bcee501ef0/results.json), gồm retry đúng mốc và HTTP 503 sau khi gửi |
| API và PostgreSQL runtime LOGIN | [37/37](tools/test-artifacts/integration/crypta-t30-test-3a831597330c/runtime-privileges-cc4c7f6ba304/results.json), gồm từ chối kết quả chưa rõ, xung đột phiên bản, từ chối dữ liệu đã đổi và rollback audit |
| Migration ledger | [10/10](tools/test-artifacts/integration/crypta-t30-test-3a831597330c/runtime-ledger-a265b6d0298b/results.json). Migration 013 được thêm sau 001–012 và kiểm checksum cả 13 bản. |
| Email qua SMTP loopback | [10/10](tools/test-artifacts/integration/crypta-t30-test-3a831597330c/email-delivery-after-343b32f66897/results.json), gồm 9 loại thư nghiệp vụ |
| Prototype Edge | 1440 px sáng và 390 px tối. Kiểm các thao tác hợp lệ, trạng thái tải/lỗi/rỗng, giữ lý do khi xung đột và trường hợp chưa rõ kết quả. |
| Dọn stack test | [Báo cáo](tools/test-artifacts/integration/crypta-t30-test-3a831597330c/cleanup-report.json) |

## Giao diện theo mẫu đã duyệt

Chủ dự án đã duyệt mẫu T15. Mã giao diện đã tích hợp tại `/operations/provider`, có mục menu riêng cho Admin, danh sách phân trang, bộ lọc trạng thái, chi tiết lần gửi và form xác nhận. Khi xung đột, lý do nhập được giữ để đối chiếu trạng thái mới. Nếu phản hồi thao tác mất hoặc không khớp phiên bản, bộ theo dõi giữ khóa gửi lại cho đến khi đối chiếu.

Lượt kiểm cục bộ sau tích hợp đạt [144/144 frontend](tools/test-artifacts/provider-ui-20261106/frontend-unit.json), gồm ba acknowledgment hợp lệ, ba acknowledgment sai và một lượt mất phản hồi. Frontend build với chuyển động bật/tắt và backend build đạt. Kịch bản trình duyệt thật đã bổ sung vào `tools/test-real-integration.cjs` để kiểm đường đi UI/API/DB.

Giao diện tích hợp đã qua hai ca T15 trên cả [Edge](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/real-msedge-1793965266140/results.json) và [Chrome](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/real-chrome-1793965524000/results.json). Đã đối chiếu ảnh hộp xác nhận ở desktop sáng và mobile tối với mẫu đã duyệt. Cả hai có lý do, xác nhận tác động và thao tác áp dụng biên nhận. Tra cứu kết quả thiếu biên nhận cần adapter đã xác minh với provider thật theo T16.

## Quy trình vận hành

1. Mở **Đối soát provider** bằng vai trò Admin. Lọc yêu cầu cần đối soát và xem chi tiết lần gửi, mốc nhận cùng lịch sử.
2. Với **Có kết quả đã ghi**, chọn **Áp dụng biên nhận**, ghi lý do và xác nhận. Máy chủ đối chiếu lại phiên bản, đầu vào và phạm vi provider trước khi ghi kết quả.
3. Với lỗi tạm thời đã biết chưa gửi, xem số lượt đã lên lịch rồi chọn **Lên lịch thử lại** nếu còn lượt. Worker kiểm lại điều kiện trước khi gửi.
4. Với tác vụ đã biết chưa gửi cần kết thúc, chọn **Đóng do lỗi xử lý**, ghi lý do và xác nhận. Yêu cầu chuyển sang lỗi và người tạo nhận thông báo.
5. Với kết quả chưa rõ hoặc tài sản thiếu liên kết provider, ghi nhận operation ID và đối chiếu với nhà cung cấp theo runbook được chốt ở T16. Giữ yêu cầu trong hàng đối soát đến khi có bằng chứng.
6. Nếu màn hình báo lần gửi chưa rõ kết quả, chọn **Kiểm tra dữ liệu**, đọc trạng thái hiện tại và đối chiếu lịch sử trước khi kết thúc đối chiếu. Một trạng thái mới tải về cần được đối chiếu với lần thao tác đang kiểm tra.
