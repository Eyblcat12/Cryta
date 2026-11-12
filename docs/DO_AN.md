# Bàn giao đồ án Crypta

Phạm vi cập nhật ngày 12/11/2026 theo xác nhận của chủ dự án rằng đây là đồ án trên trường. Bản bàn giao phục vụ chạy cục bộ, trình diễn và giải thích thiết kế. Giữ đủ 12 use case, các chức năng nâng cao đã triển khai và kiểm thử kỹ thuật. Dữ liệu mẫu và provider MOCK giúp dựng lại buổi demo mà không cần mua hạ tầng hoặc dịch vụ.

Các điều kiện dùng tài sản thật trong kế hoạch R1/R2 được giữ làm hướng phát triển. SMTP tới hộp thư bên ngoài, staging HTTPS của tổ chức, provider/CA thương mại, người trực và ký nghiệm thu vận hành chưa được thực hiện. Các mục này không được đánh dấu đã đạt. Việc chấm điểm và xác nhận của giảng viên thuộc buổi bảo vệ.

## Tài liệu bắt đầu

- [README và tài khoản mẫu](../README.md) để chạy ứng dụng.
- [Hướng dẫn giảng viên](GIANG_VIEN.md) để tải bản main và kiểm tra nhanh.
- [Báo cáo đồ án](BAO_CAO_DO_AN.md) để đọc thiết kế và kết quả.
- [Slide bảo vệ](media/crypta-bao-ve.pptx) và [ghi chú thuyết trình](THUYET_TRINH.md).
- [Video dự phòng và 12 chương](DEMO_VA_BAN_GIAO.md).
- [Kịch bản 12 UC](NGHIEM_THU_UAT.md) để chạy lại và ghi kết quả.
- [Sơ đồ use case](USE_CASES.md) và [hợp đồng OpenAPI](openapi.json) để đối chiếu với mã nguồn.

## Phạm vi bàn giao theo kế hoạch

| Nhóm task | Nội dung trong bản đồ án | Minh chứng |
| --- | --- | --- |
| T01–T04 | Baseline Git, hợp đồng API, migration và seed | [CI](CI_REMOTE_2026-11-07.md), [migration](../DATABASE_MIGRATIONS.md) |
| T05–T08 | Đăng nhập, phiên, quản trị tài khoản, đơn vị và scope | [Hướng dẫn](HUONG_DAN_CRYPTA.md), kiểm quyền và phiên trong CI |
| T09–T16 | Nháp, cấp mới, gia hạn, thu hồi, duyệt, worker và đối soát | [12 UC](NGHIEM_THU_UAT.md), [ca nháp trên DB](../T09_REQUEST_DRAFTS_2026-11-06.md), [adapter](X06_OPENBAO_TRANSIT.md) |
| T17–T22 | Danh mục, lịch sử tài sản, policy phiên bản và audit | [Luồng hoạt động](../01_luong_hoat_dong_he_thong.md), [ERD](ERD_HIEN_HANH.md) |
| T23–T29 | Hàng đợi email, cảnh báo, thông báo và dashboard | [Email](../EMAIL_OPERATIONS.md), [lịch quét](../T27_HARDENING_2026-11-06.md) |
| T30–T34 | SPA routing, bảng, form, light/dark, mobile và bàn phím | [Tracker giao diện](../IMPLEMENTATION_TRACKER.md), CI Chromium thật và fixture |
| T35–T39 | Unit, tích hợp, 12 UC và kiểm phân quyền | [Công cụ kiểm](../tools/testing/README.md), artifact CI được đối chiếu checksum |
| T40–T46 | Docker, launcher, backup/restore, quyền DB, health và CI | [README](../README.md), [runbook](../RELEASE_RUNBOOK.md) |
| T47–T54 | Hướng dẫn, diễn tập sự cố, tải và bộ bàn giao | [Báo cáo](BAO_CAO_DO_AN.md), [demo](DEMO_VA_BAN_GIAO.md), [số đo tải](../T50_CAPACITY_2026-11-06.md) |
| X01–X06 | TOTP, hai cấp duyệt, Keycloak, CSV/PDF, checkpoint audit và OpenBao | [X01](MFA_X01.md), [X02](X02_TWO_STAGE_APPROVAL.md), [X03](X03_OIDC.md), [X04](X04_REPORT_EXPORTS.md), [X05](X05_AUDIT_ANCHOR.md), [X06](X06_OPENBAO_TRANSIT.md) |

Bảng trên mô tả phần đã xây và minh chứng kỹ thuật. Trạng thái nghiệm thu vận hành từng task vẫn nằm trong [tracker gốc](../TASK_STATUS_2026-11-05.md).

## Chạy và chuẩn bị bảo vệ

1. [Tải ZIP của nhánh main](https://github.com/Eyblcat12/Cryta/archive/refs/heads/main.zip) từ [repo Cryta](https://github.com/Eyblcat12/Cryta), rồi giải nén. Nếu dùng Git, clone repo và dùng nhánh `main`. Mở Docker và chạy `start-crypta.cmd`. Script tạo bí mật local khi chưa có `.env`, build và chờ readiness. Mở `http://localhost:8080`.
2. Đăng nhập ba vai trò theo README. Thử một yêu cầu cấp mới bằng User, duyệt bằng Approver, rồi trở lại User đọc tài sản. Dùng dữ liệu giả và giữ provider MOCK trong buổi demo.
3. Theo [ghi chú thuyết trình](THUYET_TRINH.md), trình bày kiến trúc và cơ chế bảo vệ trước khi demo. Mở sẵn video dự phòng và trang Audit Log.
4. Chạy thử toàn bài hai lần trước buổi bảo vệ, đo thời gian trên máy sẽ trình bày. Người thuyết trình tự đánh dấu các mục đã thử trong [biên bản UAT](NGHIEM_THU_UAT.md). Các lượt kiểm tự động không thay việc luyện nói của nhóm.
5. Dừng bằng `stop-crypta.cmd` để giữ database. Dùng stack kiểm cách ly nếu muốn lặp từ dữ liệu mới, theo [hướng dẫn kiểm thử](../tools/testing/README.md). Không xóa volume đang lưu bài demo.

Docker engine phải báo hoạt động trước khi chạy launcher. Nếu Docker Desktop lỗi trên máy Windows, xem [hướng dẫn chẩn đoán](../README.md) và dùng video dự phòng trong lúc sửa engine. Không cần cấu hình SMTP hoặc CA bên ngoài để chạy 12 chương demo hiện có.

## Giới hạn cần trình bày trung thực

MOCK tạo metadata và mã tham chiếu mô phỏng, không cấp khóa hoặc chứng thư tin cậy công cộng. Adapter OpenBao đã kiểm sandbox cho khóa ký RSA/ECDSA. Luồng SMTP đã kiểm relay cách ly, còn giao thư qua Internet phụ thuộc dịch vụ được chọn. Kiểm bàn phím và cây trợ năng đã có bằng chứng, nhưng hai điểm đọc thành tiếng của menu mobile chưa đủ xác nhận NVDA, nên không tuyên bố đạt toàn bộ WCAG. Hiệu năng là số đo của cấu hình thử, không phải cam kết SLA.

Không đưa `.env`, token provider, mật khẩu dịch vụ hoặc dữ liệu cá nhân vào bộ nộp. Tài khoản mẫu trong README chỉ phục vụ bản local. Các chi tiết trường, lớp, thành viên và giảng viên do người nộp bổ sung theo mẫu chính thức của môn học.
