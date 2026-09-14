# Crypta — Quản lý khóa mã hóa và chứng thư số

Crypta là ứng dụng web quản lý metadata và vòng đời khóa/chứng thư theo quy trình yêu cầu–phê duyệt. Private key không được lưu trong source, API hoặc PostgreSQL; hệ thống chỉ lưu tham chiếu của nhà cung cấp khóa.

## Khởi động nhanh trên Windows

Yêu cầu duy nhất: cài và mở Docker Desktop.

1. Nhấp đúp `start-crypta.cmd`.
2. Chờ cửa sổ báo các dịch vụ `healthy`.
3. Mở `http://localhost:8080` (tệp khởi động cũng tự mở địa chỉ này).

Để dừng, nhấp đúp `stop-crypta.cmd`. Lệnh dừng không xóa database. Lần chạy đầu tự tạo `.env` với mật khẩu PostgreSQL và JWT secret ngẫu nhiên; tuyệt đối không gửi tệp `.env` cho người khác.

## Tài khoản dữ liệu mẫu

Mật khẩu local chung: `Password@123`.

| Vai trò | Email |
|---|---|
| User | `dev.nguyen@congty.com` |
| Approver | `it.manager@congty.com` |
| Security Admin | `admin@congty.com` |

Đổi hoặc loại bỏ toàn bộ tài khoản mẫu trước khi triển khai thật.

Security Admin có thể tạo tài khoản ngay trong mục **Quản trị tài khoản**. Tài khoản mới luôn phải đổi mật khẩu tạm ở lần đăng nhập đầu tiên; việc đổi mật khẩu sẽ thu hồi mọi phiên cũ.

## Bật email SMTP thật

Mở `.env` và cập nhật:

```dotenv
SMTP_ENABLED=true
SMTP_HOST=smtp.nha-cung-cap.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=no-reply@tenmien.com
SMTP_PASSWORD=mat-khau-ung-dung-hoac-smtp-api-key
SMTP_FROM=Crypta <no-reply@tenmien.com>
```

Sau đó chạy lại `start-crypta.cmd`. Backend xác minh kết nối SMTP khi khởi động; nếu thông tin sai, backend sẽ không báo healthy. Email được lưu vào bảng `notifications`, gửi nền và thử lại tối đa 5 lần. Đăng nhập Security Admin, vào **Trạng thái dịch vụ → Email SMTP → Gửi thử** để gửi thư xác minh thật; API tương ứng là `POST /api/v1/notifications/test-email`.

Gợi ý cấu hình thông dụng:

- Microsoft 365: host `smtp.office365.com`, port `587`, `SMTP_SECURE=false`.
- Gmail Workspace: host `smtp.gmail.com`, port `587`, dùng App Password; không dùng mật khẩu đăng nhập thường.
- Amazon SES/SendGrid/Mailgun: dùng SMTP credential do nhà cung cấp cấp.

Khi đặt sau HTTPS/reverse proxy ở môi trường thật, đổi `APP_ORIGIN` sang domain HTTPS và `COOKIE_SECURE=true`.

## Kết nối KMS, HSM hoặc CA thật

Mặc định local dùng adapter `MOCK` để kiểm thử trọn quy trình mà không tạo private key thật. Môi trường production cần một adapter HTTPS của tổ chức và cấu hình trong `.env`:

```dotenv
CRYPTO_PROVIDER_MODE=HTTP
CRYPTO_PROVIDER_URL=https://crypto-adapter.noibo.example
CRYPTO_PROVIDER_TOKEN=token-lay-tu-secret-manager
CRYPTO_PROVIDER_TIMEOUT_MS=15000
```

Adapter nhận `POST /assets` để cấp/gia hạn và `POST /assets/revoke` để thu hồi. Crypta chỉ lưu mã tham chiếu, fingerprint và metadata trả về; không nhận hoặc lưu private key.

## Kiến trúc chạy

- `frontend`: React/TypeScript được Nginx phục vụ tại cổng `8080`.
- `backend`: NestJS API nội bộ; Swagger ở `/docs` trong mạng backend hoặc khi mở cổng riêng.
- `postgres`: dữ liệu nghiệp vụ, phiên refresh đã hash, audit log và hàng đợi email.
- `redis`: cache/hàng đợi mở rộng cho các job provider.
- `mailhog`: chỉ chạy khi chủ động dùng profile `local-mail`; không tham gia gửi mail thật.

## Kiểm tra dành cho lập trình viên

```text
cd backend
npm ci
npm run build
npm test

cd ../frontend
npm ci
npm run build

cd ..
powershell -ExecutionPolicy Bypass -File .\tools\smoke-test.ps1
```

Smoke test gọi bản đang chạy tại `http://localhost:8080`, kiểm tra health, đăng nhập Admin, tạo tài khoản tạm, bắt buộc đổi mật khẩu, thu hồi phiên, dữ liệu hàng đợi Approver và ràng buộc policy. Tài khoản test được tự động vô hiệu hóa sau khi chạy.

Khởi chạy local không Docker: backend cổng `3000`, frontend cổng `5173`; Vite tự proxy `/api` sang backend.

## Lưu ý triển khai thực tế

- Dùng secret manager thay cho tệp `.env` trên server.
- Thay tài khoản seed, bật TLS, backup PostgreSQL và giám sát email `FAILED`.
- Kết nối adapter KMS/HSM/CA thật bằng `CRYPTO_PROVIDER_MODE=HTTP`; chế độ `MOCK` chỉ dùng cho local/demo.
- Database có migration tương thích volume cũ; file bootstrap chỉ dành cho database mới.
