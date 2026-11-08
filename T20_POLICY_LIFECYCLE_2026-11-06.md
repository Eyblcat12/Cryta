# T20 — Vòng đời chính sách mật mã, 06/11/2026

API quản trị đã được kiểm chứng trên PostgreSQL. Chủ dự án đã duyệt mẫu và luồng đã được tích hợp vào trang Chính sách của Security Admin. [Bản xem trước giao diện](tools/design-previews/policy-lifecycle/index.html)

Trang quản trị tải chính sách đang và đã ngừng áp dụng. Admin có thể tạo chính sách, phát hành ngay, đối chiếu hai phiên bản và xác nhận ngừng áp dụng. Khi có xung đột, biểu mẫu giữ nội dung, đọc lại số phiên bản và yêu cầu xác nhận lại trước khi gửi. Các thao tác dùng cơ chế đối chiếu kết quả chưa rõ của workspace.

Lượt tích hợp đầu qua PostgreSQL/API/Nginx xác nhận hai luồng vòng đời ở 1440 px sáng và 390 px tối. Ca phân quyền bị dừng vì locator tìm thấy cả tiêu đề lẫn thông báo có cùng chữ. Đã sửa locator để kiểm tiêu đề và tăng chiều cao trường nhập của hộp thoại theo bản mẫu. [Lượt đầu](tools/test-artifacts/integration/crypta-t30-test-91813cb1e51c/real-chromium-1793984063202/results.json)

Ngày 07/11, bộ Chromium đầy đủ đạt 38/38 nhóm. Sau đó kiểm hình ảnh phát hiện ngày giờ trong bảng lịch sử mobile bị cắt. Bản CSS cuối cho các ô xuống dòng và giữ chiều rộng bảng trong hộp thoại. Phép đo chiều cao dùng kích thước layout để tránh biến đổi khi hộp thoại đang mở. Build frontend, 147 unit, smoke và 3/3 ca T20 thật đạt trên bản cuối. Hai ca vòng đời xác nhận đúng bốn audit thành công, chính sách ngừng áp dụng biến mất khỏi danh sách chọn và vẫn đọc được lịch sử. [Bộ Chromium đầy đủ](tools/test-artifacts/integration/crypta-t30-test-445e594eb7df/real-chromium-1793984510008/results.json) · [T20 bản cuối](tools/test-artifacts/integration/crypta-t30-test-660be5950fab/real-chromium-1793984803334/results.json) · [Lịch sử mobile](tools/test-artifacts/integration/crypta-t30-test-660be5950fab/real-chromium-1793984803334/t20-history-dark.png)

## Phạm vi đã kiểm

- Security Admin có thể tạo policy và phát hành v1 trong cùng transaction, phát hành phiên bản mới, xem lịch sử và ngừng áp dụng. Danh sách quản trị trả về một dòng mỗi policy, bản mới nhất và bản đang hiệu lực theo đồng hồ PostgreSQL. API phát hành hiệu lực ngay.
- Hai Admin ghi cùng phiên bản kỳ vọng được tuần tự hóa bằng khóa dòng policy. Khi phiên bản hoặc trạng thái đã đổi, lần ghi sau nhận `VERSION_CONFLICT`. Một lần gửi CREATE chờ Admin phát hành sẽ kiểm tra lại phiên bản sau khi lấy được khóa. Mỗi lần ghi thành công có audit cùng transaction.
- Ngừng áp dụng chặn CREATE và RENEW mới. REVOKE vẫn khả dụng cho tài sản đã cấp để duy trì đường xử lý sự cố. Yêu cầu đã gửi tiếp tục dùng phiên bản bất biến đã gắn, kể cả khi policy ngừng áp dụng giữa lúc worker gọi provider. Lịch sử và cảnh báo hết hạn tiếp tục dùng dữ liệu đã gắn với tài sản.
- API dùng schema và 12 migration hiện có. Môi trường dùng runtime LOGIN cần áp lại grant đã cập nhật. [Quyền DB](DATABASE_MIGRATIONS.md).

## Kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| Backend build và unit | 265/265 |
| Frontend build và unit | 136/136, bao gồm hiệu chỉnh giá trị độ dài khóa mặc định trong form phát hành hiện tại |
| API và PostgreSQL runtime LOGIN | [34/34](tools/test-artifacts/integration/crypta-t30-test-aa5c281b8bc4/runtime-privileges-ad6c8dc55494/results.json), gồm quyền Admin, tranh chấp, rollback audit, hồi quy T07 SMTP loopback |
| Worker và PostgreSQL | [23/23](tools/test-artifacts/integration/crypta-t30-test-aa5c281b8bc4/worker-recovery-after-c622d5e37c5e/results.json), gồm ngừng áp dụng trước và trong lúc gọi MOCK |
| Phiên bản bất biến và audit | [8/8](tools/test-artifacts/integration/crypta-t30-test-aa5c281b8bc4/policy-version-01a575bc7668/results.json) |
| Prototype trên Edge | 1440 px sáng và 390 px tối, gồm tạo, lịch sử, giữ dữ liệu khi xung đột, ngừng áp dụng, lỗi tải và thử lại |
| Dọn môi trường cô lập | [Đã dọn stack test và đối chiếu ID container khác](tools/test-artifacts/integration/crypta-t30-test-aa5c281b8bc4/cleanup-report.json) |

Lượt runtime đầu đạt 31/33. Hai ca T07 đợi sau thư nghiệp vụ do các ca mới sinh ra trong DB test. Lượt cuối hoãn các thư nghiệp vụ có sẵn trong DB test trước khi bật SMTP loopback và đạt đủ 34 nhóm, gồm ca đợi khóa policy mới. Lượt kiểm API dùng provider MOCK.

## T19 — Kiểm cấu hình policy đã lưu ngày 08/11/2026

API và worker dùng cùng bộ quy tắc cho thuật toán, curve, hồ sơ chứng thư, kích thước khóa tối thiểu và thời hạn tối đa. Bản cũ có thể bỏ qua giới hạn dạng chữ khi người gửi cung cấp tham số rõ ràng. Bản mới trả `POLICY_CONFIGURATION_INVALID` nếu trường đang dùng có dữ liệu sai. Chuỗi số thập phân hợp lệ trong phiên bản cũ vẫn được đọc và áp giới hạn. Bản ghi phiên bản đã phát hành giữ nguyên trong PostgreSQL.

Chín ca đối chứng unit lỗi trên bản cũ. Bộ backend trên bản sửa đạt 517/517. Qua Nginx và PostgreSQL, API từ chối policy lỗi trước khi tạo yêu cầu. Ba nhóm T20 trên Chromium đạt ở desktop, mobile và với người dùng ngoài quyền Admin. [T19 API](tools/test-artifacts/integration/crypta-t30-test-81839f7fc055/real-chromium-1794135089064/results.json) · [T20 Chromium](tools/test-artifacts/integration/crypta-t30-test-81839f7fc055/real-chromium-1794135096369/results.json)

Bộ worker/PostgreSQL đạt 37/37. Yêu cầu lịch sử đã duyệt với giới hạn lỗi chuyển sang đối soát trước lần gửi đầu tiên, với 0 lần gọi provider và 0 tài sản. Các ca phiên bản cũ, hiệu lực tương lai và ngừng áp dụng vẫn đạt. Giới hạn theo nhà cung cấp và tổ hợp mục đích sử dụng cần xác nhận với provider đã chọn. [Worker](tools/test-artifacts/integration/crypta-t30-test-81839f7fc055/worker-recovery-after-4a00d269c42c/results.json)
