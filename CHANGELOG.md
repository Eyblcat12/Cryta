# Thay đổi Crypta

## Bản đang chuẩn bị

- Bàn giao đồ án chạy local cùng báo cáo kỹ thuật, slide và video dự phòng 12 chương. ERD hiện hành sau migration 027 có 28 bảng, 234 cột và 40 khóa ngoại.
- MFA TOTP, phê duyệt hai cấp, SSO Keycloak, xuất CSV/PDF, checkpoint audit Ed25519 và bridge OpenBao đã có kiểm thử cách ly.
- Bổ sung ca nháp, gửi và hủy bị mất phản hồi sau khi server ghi. UI đọc đối chiếu và không tự gửi lặp.
- Chuyển Nginx sang image slim chính thức và sửa đóng gói commit UTC hậu tố `Z`, được kiểm ở cả CI push và PR.

- Quản lý đơn vị và phạm vi phê duyệt. Chuyển đơn vị thu hồi phiên và giữ dữ liệu lịch sử.
- Mời tài khoản và đặt lại mật khẩu bằng liên kết email có hạn. Admin phát hành lời mời. Người dùng tự yêu cầu đặt lại mật khẩu.
- Lưu, gửi và hủy yêu cầu nháp. Hàng đợi xử lý giữ biên nhận provider và có luồng đối soát cho Admin.
- Danh mục và lịch sử tài sản theo phạm vi của User, Approver và Admin. Theo dõi tài sản trước/sau gia hạn và mở yêu cầu liên quan.
- Audit có mã truy vết HTTP và ghi nhận lỗi sau rollback. Giới hạn gửi thử SMTP dùng chung database.
- Cảnh báo hết hạn theo policy version. Chủ sở hữu, Approver đúng phạm vi và Admin nhận qua hai kênh.
- Tách kiểm sức khỏe API và readiness database. Thêm bộ kiểm quyền runtime và diễn tập backup/restore.

Nâng cấp từ mốc `105d104` áp migration 004–027, gồm các bảng MFA/OIDC/báo cáo và tình trạng worker. Migration 017 thêm chỉ mục `pg_trgm` cho tìm kiếm Audit Log. Kiểm điều kiện extension, lịch bảo trì và ledger trước khi khởi động bản mới. Provider, SMTP và môi trường triển khai thật còn phải được cấu hình và nghiệm thu khi mở rộng khỏi bản đồ án local. [Hướng dẫn nâng cấp](RELEASE_RUNBOOK.md) · [Điều kiện migration](DATABASE_MIGRATIONS.md)
