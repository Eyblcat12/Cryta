# Cấu hình dịch vụ thật và phần còn chờ

Ngày 05/10/2026, chủ dự án xác nhận chưa chọn provider mật mã, SMTP và môi trường triển khai. Công việc cục bộ tiếp tục theo [kế hoạch T01–T54/X01–X06](KE_HOACH_HOAN_THIEN_DU_AN.md), ưu tiên T30. Các kết quả dùng MOCK hoặc HTTP fixture chỉ xác nhận phạm vi mô phỏng tương ứng.

| Mục | Cấu hình đã có trong dự án | Thông tin cần bổ sung để thử thật |
| --- | --- | --- |
| Provider · T16 | `CRYPTO_PROVIDER_MODE`, `CRYPTO_PROVIDER_URL`, `CRYPTO_PROVIDER_TOKEN`, `CRYPTO_PROVIDER_SCOPE`, `CRYPTO_PROVIDER_TIMEOUT_MS` | Nhà cung cấp, sandbox/base URL, hợp đồng cấp/thu hồi/tra cứu theo operation ID, chính sách idempotency và quyền truy cập sandbox. |
| Email · T25 | `SMTP_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Dịch vụ SMTP, danh tính gửi được xác minh, hộp thư thử đã đồng ý nhận thư và cấu hình TLS/domain theo dịch vụ. |
| Triển khai · T40/T51 | Compose production riêng, proxy TLS, cấu hình bằng tệp bí mật và PostgreSQL runtime hạn chế | Máy đích, URL/origin HTTPS, PostgreSQL đã provision, nơi backup và quyền vận hành. |

Mẫu local nằm trong [.env.example](.env.example). Bản production dùng [mẫu biến](deploy/production.env.example) và [Compose riêng](docker-compose.production.yml), với đường dẫn đến tệp bí mật được cấp từ kho bí mật của môi trường. [Quy trình triển khai](RELEASE_RUNBOOK.md#cấu-hình-docker-production)

## Provider

Chọn `CRYPTO_PROVIDER_MODE=MOCK` cho dữ liệu mô phỏng hoặc `HTTP` cho adapter. Với HTTP, dùng HTTPS, Bearer token chỉ cấp cho các thao tác cần thiết và `CRYPTO_PROVIDER_SCOPE` là mã ổn định, riêng cho tài khoản và môi trường provider. Giữ cùng URL và scope khi xoay token của cùng tài khoản. Chuyển endpoint hoặc tài khoản cần đối chiếu tài sản trước vì API chặn gia hạn và thu hồi khi phạm vi khác nhau.

| Điểm gọi | Hợp đồng HTTP hiện tại |
| --- | --- |
| `POST /assets` | Gửi `operationId` và header `idempotency-key` trùng nhau. Nhận HTTP 200/201, `operationId` trùng, `providerReference` mới, `assetType` phù hợp và `status: "ACTIVE"`. |
| Metadata `KEY` | `algorithm`, `keySize`, `usage` theo yêu cầu, `publicKeyFingerprint` dạng `SHA256:` và 64 ký tự hex. Hai mốc `validFrom` và `expiresAt` dạng UTC ISO phải đang hiệu lực và nằm trong giới hạn số ngày đã duyệt. |
| Metadata `CERTIFICATE` | Một `certificatePem` công khai dạng TLS server leaf. Crypta đọc serial, fingerprint, loại/kích thước khóa và thời hạn trực tiếp từ chứng thư. |
| `POST /assets/revoke` | Nhận HTTP 200/201, `operationId` và `providerReference` trùng yêu cầu, cùng `revoked: true`. |

Response sau mốc gửi thiếu bằng chứng sẽ chuyển vào đối soát. Một lần gia hạn thành công tạo tài sản kế nhiệm và đánh dấu bản cũ là `SUPERSEDED` trong Crypta. Người vận hành kiểm tra các ứng dụng đã chuyển sang tài sản mới rồi thực hiện chính sách retire ở provider theo runbook của tổ chức. [Mã adapter](backend/src/jobs/crypto-provider.service.ts).

Sau khi chọn provider, đối chiếu adapter với hợp đồng sandbox, hoàn thiện tra cứu/đối soát và kiểm thử cấp–gia hạn–thu hồi, timeout, response không hợp lệ, kết quả chưa rõ và crash/retry. Kiểm tra không cấp phát lặp trước khi dùng tài sản thật. T16 và các cổng liên quan chưa được nghiệm thu từ MOCK.

## SMTP

Chọn TLS trực tiếp hoặc STARTTLS theo dịch vụ. Crypta yêu cầu TLS nếu relay không phải loopback hoặc dùng thông tin đăng nhập. Khi bật SMTP, API chỉ hoàn tất startup sau khi kiểm cấu hình và kết nối thành công. [Cấu hình và kiểm lỗi](EMAIL_OPERATIONS.md)

Sau khi có cấu hình, thử trong môi trường cách ly với người nhận đã đồng ý. Bằng chứng cần gồm thư đến inbox/spam, header/danh tính gửi, link đúng môi trường và log đã che dữ liệu nhạy cảm cho luồng quyết định, cảnh báo và mời/reset sau khi các luồng tương ứng hoàn thiện. SMTP chấp nhận gửi chưa chứng minh thư đến hộp thư; lỗi và kết quả chưa rõ cần đối chiếu quy tắc hàng đợi ở T23.

## Máy triển khai

Chuẩn bị HTTPS/origin/cookie, secret và quyền DB, backup/restore, healthcheck, nâng cấp/rollback rồi diễn tập trên máy đích. Một môi trường demo dùng MOCK và tắt SMTP cần ghi rõ phạm vi đó trong bàn giao. T51/T54 còn phụ thuộc các cổng nghiệm thu trong kế hoạch; báo cáo build hoặc test cục bộ không thay nghiệm thu triển khai.

## Công việc vẫn thực hiện được ngay

Hoàn thiện chức năng và quyền, kiểm thử UI/API/DB/worker trên môi trường cách ly, migration, backup/restore, tài liệu vận hành và kịch bản UAT. Khi các dịch vụ đã được chọn, điền cấu hình riêng và chạy lại kịch bản thật; không cần bỏ phần công việc cục bộ đã kiểm chứng.
