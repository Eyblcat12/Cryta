# Trạng thái triển khai Crypta

Cập nhật: 05/09/2026

## Đã hoàn thành (MVP vận hành nội bộ)

- UI prototype cho User, Approver và Security Admin; light/dark theme, responsive và dashboard charts.
- PostgreSQL bootstrap schema và dữ liệu seed demo.
- Backend NestJS foundation tại `backend/`.
- `POST /api/v1/auth/login`, `GET /api/v1/auth/me`.
- `GET/POST /api/v1/requests` và `POST /api/v1/requests/:id/decision`.
- JWT access token có kiểm tra `token_version`.
- Scope theo phòng ban, chặn Admin duyệt, chặn self-approval và quyết định lặp.
- Transaction gộp thay đổi request với Audit Log.
- Response envelope/error model có `requestId`; database rows được đổi sang camelCase.
- Swagger, Docker Compose local và hướng dẫn chạy.
- 18 unit tests cho policy, API presenter và crypto provider adapter.
- Frontend đăng nhập và đọc/ghi dữ liệu qua API thật; có khôi phục phiên, loading, error và retry.
- Refresh-token rotation bằng cookie HttpOnly; token chỉ lưu hash trong PostgreSQL; logout thu hồi session.
- Assets API, Policies API, request detail/cancel và Admin Audit API.
- Hàng đợi email PostgreSQL, SMTP thật, kiểm tra kết nối và retry tối đa 5 lần.
- Docker image cho frontend/backend và tệp `start-crypta.cmd` chạy toàn hệ thống một lần.
- Dark theme đổi sang bảng màu xanh lam–indigo, bỏ màu cam khỏi accent chính.
- Dashboard theo vai trò dùng số liệu, xu hướng và cơ cấu trực tiếp từ PostgreSQL; không còn số mẫu ở biểu đồ.
- Notification trong ứng dụng, đánh dấu đã đọc và email theo cùng một sự kiện nghiệp vụ.
- Job xử lý sau phê duyệt với trạng thái `PROCESSING`, `COMPLETED`, `FAILED`; tự phục hồi job treo sau khi khởi động lại.
- Adapter provider hỗ trợ `MOCK` cho local và `HTTP` qua HTTPS/token cho KMS, HSM hoặc CA thật.
- Quét hết hạn định kỳ, chống chạy trùng bằng PostgreSQL advisory lock.
- Chống brute-force cơ bản: khóa tài khoản 15 phút sau 5 lần đăng nhập sai.
- API và UI Admin xem người dùng, Audit Log, trạng thái dịch vụ và vô hiệu hóa/kích hoạt tài khoản; vô hiệu hóa sẽ thu hồi phiên.
- Tệp khởi động một lần đã kiểm tra bằng Windows PowerShell 5 và Docker Compose.
- Security Admin tạo tài khoản từ UI, sinh mật khẩu tạm mạnh và gán phạm vi phòng ban cho Approver.
- Tài khoản mới bắt buộc đổi mật khẩu ở lần đăng nhập đầu; sau khi đổi, toàn bộ phiên cũ bị thu hồi.
- Hàng đợi Approver hiển thị người gửi, phòng ban, tài sản và phiên bản request từ database; quyết định dùng optimistic concurrency.
- Policy được kiểm tra ở cả UI lẫn backend: loại tài sản, thuật toán, độ dài khóa và thời hạn.
- Tìm kiếm thật cho hàng đợi Approver/Audit Log; Help dialog mô tả quy trình theo vai trò.
- Security Admin có nút gửi email thử trực tiếp từ trang trạng thái dịch vụ khi SMTP đã bật.
- Chi tiết vòng đời tài sản không còn ngày, provider hoặc actor ghi cứng; chỉ hiển thị metadata thật.
- `tools/smoke-test.ps1` kiểm thử tích hợp các luồng quan trọng và tự dọn tài khoản tạm.

## Kết quả kiểm tra gần nhất

- Backend build: pass.
- Backend test: 18/18 pass.
- Frontend build: pass.
- Docker Compose config: pass.
- One-click startup `start-crypta.ps1 -NoBrowser`: pass.
- Swagger không cần database: HTTP 200.
- Protected endpoint không token: HTTP 401.
- Invalid login payload: HTTP 400 với error envelope chuẩn.
- Health khi PostgreSQL chưa chạy: HTTP 503 với `DATABASE_UNAVAILABLE`.

## Kiểm thử tích hợp đã chạy

- Docker Compose: PostgreSQL, Redis, backend và frontend đều healthy/running.
- Login qua Nginx, cookie HttpOnly, refresh rotation: pass.
- Assets API trả 4 tài sản; Requests API trả dữ liệu theo owner: pass.
- Tạo yêu cầu, scope approver, quyết định APPROVED, Audit Log và enqueue email: pass.
- Tạo yêu cầu mới, duyệt, job cấp tài sản, request chuyển `COMPLETED`, tài sản xuất hiện và tạo thông báo in-app: pass.
- Dashboard User/Approver/Admin, Users API và Audit API qua Nginx: pass.
- Rà giao diện trực tiếp ở dark/light và khung nhìn hẹp: pass.
- Smoke test tạo tài khoản, đổi mật khẩu bắt buộc, thu hồi phiên, queue Approver và policy boundary: pass.
- SMTP thật chưa thể gửi trong máy phát triển vì chưa có credential của chủ sở hữu; mã nguồn và endpoint kiểm tra đã sẵn sàng.

## Trước khi phát hành production cho một tổ chức cụ thể

1. Nhập SMTP credential thật và gửi email test tới địa chỉ quản trị.
2. Cấu hình adapter KMS/HSM/CA của tổ chức bằng HTTPS/token; adapter HTTP đã sẵn sàng nhưng hiện local đang dùng `MOCK`.
3. Loại bỏ dữ liệu seed, cấu hình domain HTTPS, secret manager, backup và monitoring.
4. Bổ sung E2E CI trên hạ tầng triển khai và kiểm thử tải theo quy mô người dùng thực.
