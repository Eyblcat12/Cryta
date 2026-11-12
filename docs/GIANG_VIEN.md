# Hướng dẫn kiểm tra đồ án Crypta

Crypta quản lý metadata và vòng đời khóa/chứng thư qua User, Approver và Security Admin. Bản mặc định chạy ứng dụng, database và worker bằng Docker. Provider MOCK tạo metadata tài sản mô phỏng, SMTP tắt mặc định. Không cần tài khoản dịch vụ bên ngoài để thử luồng chính.

## Tải và chạy trên Windows

1. [Tải ZIP của main](https://github.com/Eyblcat12/Cryta/archive/refs/heads/main.zip). Có thể vào [trang repo](https://github.com/Eyblcat12/Cryta), chọn nhánh `main`, **Code → Download ZIP**.
2. Giải nén toàn bộ ZIP vào một thư mục. Các tệp `start-crypta.cmd`, `docker-compose.yml`, `database_schema.sql` và `seed_data.sql` cần nằm cùng cấp.
3. Mở Docker Desktop và chờ engine hoạt động. Máy cần kết nối Internet ở lần dựng đầu để tải image và dependency. Không cần cài Node.js nếu chỉ chạy demo bằng Docker.
4. Nhấp đúp `start-crypta.cmd`, giữ cửa sổ để đọc trạng thái. Khi các dịch vụ báo healthy, mở `http://localhost:8080`.
5. Kết thúc bằng `stop-crypta.cmd`. Database được giữ để có thể mở lại kiểm tra lịch sử.

Launcher tự tạo `.env` với bí mật database/JWT riêng cho máy nếu tệp chưa có. Cấu hình mẫu vẫn dùng tài khoản và dữ liệu demo. [Khởi động, đổi cổng và chẩn đoán](../README.md#khởi-động-nhanh-trên-windows).

## Tài khoản mẫu

Mật khẩu chung trong bản demo mới là `Password@123`.

| Vai trò | Email |
| --- | --- |
| User | `dev.nguyen@congty.com` |
| Approver | `it.manager@congty.com` |
| Security Admin | `admin@congty.com` |

Trong cùng một trình duyệt, đăng xuất trước khi đổi tài khoản. Các tab/cửa sổ cùng profile dùng chung cookie. Để giữ nhiều tài khoản đồng thời, dùng profile hoặc trình duyệt độc lập.

## Một lượt kiểm tra ngắn

1. **User** gửi yêu cầu cấp khóa mới theo policy đang hoạt động, với lý do dễ tìm như `Kiểm tra đồ án`.
2. Đăng xuất. **Approver** mở hàng chờ trong đơn vị, tìm yêu cầu và phê duyệt.
3. Đăng xuất. **User** mở lại yêu cầu đến khi hoàn tất, kiểm tài sản vừa được tạo. Thử gia hạn, duyệt bằng Approver rồi xem liên kết tài sản trước/sau. Có thể thử thu hồi theo cùng quy trình.
4. Tạo thêm một yêu cầu và cho **Approver từ chối có lý do**. User mở lại để đọc tên người quyết định, lý do và timeline.
5. **Admin** kiểm danh mục toàn hệ thống, policy, đơn vị/tài khoản/scope và Audit Log. Admin quản trị hệ thống, không được quyết định yêu cầu nghiệp vụ.

[Kịch bản đủ 12 UC và các nhánh lỗi](NGHIEM_THU_UAT.md) dùng để kiểm sâu hơn. Video dự phòng có đủ 12 chương, gồm cảnh báo và hết hạn đã được chuẩn bị bằng dữ liệu giả sát mốc và gọi bộ quét chủ động. [Video và mốc chương](DEMO_VA_BAN_GIAO.md).

## Hồ sơ và mã nguồn để chấm

| Nội dung | Vị trí |
| --- | --- |
| Báo cáo kỹ thuật 11 phần | [Báo cáo đồ án](BAO_CAO_DO_AN.md) |
| Slide chỉnh sửa được, 14 trang | [PowerPoint](media/crypta-bao-ve.pptx) |
| Video 57 giây, 12 chương | [Video](media/crypta-demo.webm), [manifest và mốc chương](DEMO_VA_BAN_GIAO.md) |
| Đặc tả 12 UC | [Kịch bản UAT](NGHIEM_THU_UAT.md), [sơ đồ tác nhân](USE_CASES.md) |
| Kiến trúc và trạng thái | [Kiến trúc](../02_so_do_he_thong_tong_quat.md), [luồng hoạt động](../01_luong_hoat_dong_he_thong.md) |
| Database schema 027 | [ERD 28 bảng](ERD_HIEN_HANH.md), [draw.io](../erd_QuanLyKhoa_HTTT.drawio), [catalog](evidence/schema-027.json) |
| Hợp đồng REST API | [OpenAPI JSON](openapi.json), [hướng dẫn API](HUONG_DAN_CRYPTA.md#api-và-truy-vết) |
| Backend và migration | [backend/src](../backend/src), [database_schema.sql](../database_schema.sql), [seed_data.sql](../seed_data.sql) |
| Frontend | [frontend/src](../frontend/src) |
| Kiểm thử và CI | [GitHub Actions](https://github.com/Eyblcat12/Cryta/actions), [công cụ kiểm](../tools/testing/README.md) |
| Giới hạn và phần mở rộng | [Phạm vi đồ án](DO_AN.md), [báo cáo phần 11](BAO_CAO_DO_AN.md#11-kết-quả-và-hướng-phát-triển) |

## Đọc bằng chứng kiểm thử

Các con số kiểm thử được gắn với commit và môi trường. Trong GitHub Actions, mở lượt chạy của commit cần kiểm để xem năm job và các artifact. Bộ kiểm gồm build/lint, secret scan, unit, SMTP loopback, PostgreSQL, trình duyệt và quét image. Tài liệu CI giữ riêng lịch sử từng lượt. [Bằng chứng CI](CI_REMOTE_2026-11-07.md).

[Bản ghi đã đối chiếu của ứng dụng `8bc9f71`](evidence/ci-8bc9f71.json) chứa checksum artifact, SHA head/merge, 18/18 ca nháp, 66/66 ca Chromium qua PostgreSQL, 197/197 ca UI fixture và kết quả quét hai image. Hai revision có cùng cây mã nguồn và đều chạy đủ năm job.

Bộ Chromium chạy qua Nginx/API/PostgreSQL kiểm dữ liệu thật của stack cách ly. Bộ UI fixture kiểm trạng thái giao diện bằng API mô phỏng. Số ca đạt không phải tỷ lệ coverage toàn bộ mã nguồn. Cấu hình production, nhà cung cấp mật mã, hộp thư Internet và các xác nhận vận hành được theo dõi riêng, phù hợp phạm vi đồ án chạy local đã nêu.

Nếu máy chưa chạy được Docker, có thể xem video, báo cáo, sơ đồ, OpenAPI và mã nguồn trực tiếp trên GitHub. Để chạy unit test trên máy, xem các lệnh ở [README](../README.md#kiểm-tra-dành-cho-lập-trình-viên); phần này cần Node.js 22 và cài dependency ngoài Docker.
