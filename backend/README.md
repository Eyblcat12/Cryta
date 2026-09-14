# Crypta API

Backend NestJS cho hệ thống quản lý vòng đời khóa và chứng thư. Slice hiện tại gồm health check, JWT login, `/me`, danh sách/tạo yêu cầu và quyết định có kiểm tra role, department scope và Separation of Duties.

## Chạy local

1. Khởi động PostgreSQL và chạy `../database_schema.sql`, sau đó `../seed_data.sql`.
2. Sao chép `.env.example` thành `.env` và thay JWT secret.
3. Chạy `npm install`, `npm run start:dev`.
4. Swagger: `http://localhost:3000/docs`; health: `http://localhost:3000/api/v1/health`.

Tài khoản demo dùng mật khẩu `Password@123`; không dùng thông tin này ngoài môi trường local/demo.

## Kiểm soát đã có

- Access token ngắn hạn; danh tính và role được nạp lại từ database mỗi request.
- User chỉ đọc request của mình; Approver chỉ đọc scope được giao; Admin đọc toàn hệ thống.
- Admin không được tạo hoặc phê duyệt request.
- Chống tự duyệt, ngoài scope, quyết định lặp và xung đột phiên bản.
- Thay đổi request và Audit Log nằm trong cùng transaction.
- API không có trường hoặc endpoint trả private key.
