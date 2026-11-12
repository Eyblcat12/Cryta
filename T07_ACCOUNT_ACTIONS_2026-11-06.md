# T07 — Mời tài khoản và đặt lại mật khẩu

Security Admin gửi lời mời từ mục **Người dùng và vai trò**. Người nhận chọn mật khẩu qua link trước khi tài khoản hoạt động. Admin có thể phát hành lại lời mời đang chờ và thu hồi link cũ. Người dùng có thể chọn **Quên mật khẩu?** để tự yêu cầu link qua email. Thiết kế giao diện đã được chủ dự án duyệt. [Mẫu xem trước](tools/design-previews/account-actions/index.html).

Link mời có hạn 24 giờ, link reset có hạn 30 phút. Hai loại link tách riêng theo mục đích, người nhận và lượt phát hành. PostgreSQL giữ mã băm và trạng thái, worker tái tạo mã bằng khóa riêng khi gửi. Link dùng fragment và trang xóa fragment khỏi thanh địa chỉ trước khi tải giao diện. API nhận mã trong body của thao tác hoàn tất. Khi dùng link thành công, hệ thống cập nhật mật khẩu, tiêu thụ link, thu hồi phiên và ghi audit trong cùng transaction. Reset còn đưa thư báo thay đổi vào hàng đợi.

Endpoint yêu cầu reset dùng phản hồi 202 giống nhau cho email đủ điều kiện, email lạ và trường hợp đã chạm giới hạn gửi. Nó gộp yêu cầu lặp trong hai phút và giới hạn theo địa chỉ lẫn toàn dịch vụ. Nếu ghi hàng đợi thất bại, transaction được hoàn tác và sự cố được ghi bằng sự kiện hệ thống không chứa địa chỉ hoặc mã. Cơ chế cùng phản hồi và thời gian chờ tối thiểu giảm khả năng dò tài khoản. Độ trễ quan sát được vẫn phụ thuộc tải và kết nối cơ sở dữ liệu.

Migration `012_account_actions` giữ đường tạo tài khoản bằng mật khẩu tạm cho triển khai chưa bật email tài khoản. Cấu hình mặc định tắt lời mời/reset. Khi bật, API yêu cầu SMTP và origin ứng dụng hợp lệ cùng khóa riêng 32 byte. [Cấu hình và vận hành](EMAIL_OPERATIONS.md), [Migration](DATABASE_MIGRATIONS.md).

| Kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| Unit và build | Backend 265/265 và frontend 136/136. Build backend và frontend bật/tắt motion đạt. | [Backend](tools/test-artifacts/account-actions-20261106/backend-final.json), [Frontend](tools/test-artifacts/account-actions-20261106/frontend-final.json) |
| API và PostgreSQL | Runtime LOGIN 30/30. Kiểm quyền Admin, phản hồi 202 đồng nhất, giới hạn địa chỉ, SMTP loopback, sai mục đích, đồng thời, hết hạn, cấp lại, rollback audit và thu hồi phiên. | [Runtime](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/runtime-privileges-27b44d65d3ea/results.json) |
| Migration | 10/10 nhóm CLI/validator với 12 migration trên role giới hạn. Lượt chạy trước phần bổ sung cờ giao diện vào payload đăng nhập. Mã migration trùng với bản cuối. | [Ledger](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/runtime-ledger-1c4715fc4d39/results.json) |
| Hồi quy | 26/26 trên Edge với API và PostgreSQL sau sửa mở link cùng tab, trước chỉnh kích thước ô nhập. | [Hồi quy](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/real-msedge-1793948378291/results.json) |

Lượt trình duyệt đầu đạt 4/6. Mở lại link reset trên cùng đường dẫn tạo sự kiện đổi fragment trong trang hiện tại. Màn hình ban đầu chỉ đọc fragment lúc tải app nên không hiện lại form. Lượt sau đọc được fragment mới, xóa khỏi URL, rồi hiển thị thông báo khi backend từ chối mã đã dùng. [Lượt đầu](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/account-actions-ui-1793948058824/results.json), [Kiểm lại](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/account-actions-ui-1793948319677/results.json).

Bản cuối đạt 6/6 luồng qua Edge desktop sáng và Chrome mobile tối. Mỗi trình duyệt đi từ biểu mẫu Admin đến thư mời, kích hoạt, đăng nhập, yêu cầu reset, thư reset, thu hồi phiên đang mở, từ chối dùng lại link và đăng nhập bằng mật khẩu mới. Test đo chiều cao ô mật khẩu tối thiểu 44 px. [Báo cáo trình duyệt](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/account-actions-ui-1793948512841/results.json), [Ảnh kích hoạt mobile](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/account-actions-ui-1793948512841/chrome-activation.png).

SMTP trong các lượt thử là loopback với dữ liệu giả lập. Nghiệm thu T25 còn cần cấu hình SMTP của môi trường thật và xác nhận thư đến hộp thư người dùng. [Bản chụp 243 tệp](tools/test-artifacts/frontend-artifacts/account-actions-20261106-release-check/source-manifest.json), [Đối chiếu image](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/account-actions-provenance.json).

Backup/restore đạt 11/11 trên 19 bảng và các sequence. Sau kiểm, stack còn 0 container, volume và network thuộc project thử. Danh tính tám container bên ngoài được bảo toàn. [Backup/restore](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/backup-restore-0b9388d3dde3/results.json), [Cleanup](tools/test-artifacts/integration/crypta-t30-test-83728d40845b/cleanup-report.json).
