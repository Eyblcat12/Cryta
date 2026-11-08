# Crypta — Quản lý khóa mã hóa và chứng thư số

Crypta là ứng dụng web quản lý metadata và vòng đời khóa/chứng thư theo quy trình yêu cầu–phê duyệt. Private key không được lưu trong source, API hoặc PostgreSQL; hệ thống chỉ lưu tham chiếu của nhà cung cấp khóa.

[Hướng dẫn sử dụng, API và vận hành](docs/HUONG_DAN_CRYPTA.md) · [Demo và bàn giao](docs/DEMO_VA_BAN_GIAO.md) · [Kịch bản nghiệm thu](docs/NGHIEM_THU_UAT.md) · [Cấu hình dịch vụ thật](CAU_HINH_DICH_VU_THAT.md)

## Khởi động nhanh trên Windows

Backend chạy trực tiếp mặc định chỉ kiểm migration (`validate`). Operator chạy migration riêng trước startup. Compose demo khai báo `apply` để giữ quy trình local bên dưới. [Quy trình migration và quyền runtime](DATABASE_MIGRATIONS.md) · [Đóng gói, nâng cấp và phục hồi](RELEASE_RUNBOOK.md)

Yêu cầu duy nhất: cài và mở Docker Desktop.

1. Nhấp đúp `start-crypta.cmd`.
2. Chờ cửa sổ báo các dịch vụ `healthy`.
3. Mở `http://localhost:8080` (tệp khởi động cũng tự mở địa chỉ này).

Để dừng, nhấp đúp `stop-crypta.cmd`. Lệnh dừng không xóa database. Lần chạy đầu tự tạo `.env` với mật khẩu PostgreSQL và JWT secret ngẫu nhiên; tuyệt đối không gửi tệp `.env` cho người khác.

Chạy `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-crypta.ps1 -Diagnose` để xem trạng thái Docker Compose và kiểm readiness qua cổng đã cấu hình. Đổi cổng bằng `APP_PORT` và đặt `APP_ORIGIN`, `APP_URL` khớp URL mới, ví dụ `http://localhost:18081`. Khi cập nhật mã nguồn, chạy lại `start-crypta.cmd` để build image mới. Kiểm readiness trước khi sử dụng.

## Tài khoản dữ liệu mẫu

Mật khẩu local chung: `Password@123`.

| Vai trò | Email |
|---|---|
| User | `dev.nguyen@congty.com` |
| Approver | `it.manager@congty.com` |
| Security Admin | `admin@congty.com` |

Đổi hoặc loại bỏ toàn bộ tài khoản mẫu trước khi triển khai thật.

Security Admin quản lý tài khoản ở **Người dùng & vai trò**. Với cấu hình mặc định, **Thêm người dùng** cấp mật khẩu tạm phải đổi ở lần đăng nhập đầu. Khi bật luồng email tài khoản, **Mời tài khoản** gửi liên kết một lần để người nhận tự đặt mật khẩu.

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
APP_URL=https://crypta.tenmien.com
APP_TIME_ZONE=Asia/Ho_Chi_Minh
```

`APP_TIME_ZONE` đặt múi giờ hiển thị trong email và mốc ngày, tháng của biểu đồ Tổng quan. Mặc định là `Asia/Ho_Chi_Minh`. Biểu đồ 7 ngày gồm ngày hiện tại và 6 ngày trước. Biểu đồ 6 tháng gồm tháng hiện tại và 5 tháng trước.

Sau đó chạy lại `start-crypta.cmd`. Backend xác minh kết nối SMTP khi khởi động. Email được lưu vào bảng `notifications` và gửi nền. Security Admin dùng **Vận hành email → Gửi thử** để gửi thư xác minh, rồi kiểm tra hộp thư đích. API tương ứng là `POST /api/v1/notifications/test-email`. Trường hợp kết quả gửi không chắc chắn chuyển sang `RECONCILIATION_REQUIRED` để đối chiếu. [Hướng dẫn đối soát email](EMAIL_OPERATIONS.md)

Khi đặt sau HTTPS/reverse proxy ở môi trường thật, đổi `APP_ORIGIN` sang domain HTTPS và `COOKIE_SECURE=true`.

## Kết nối KMS, HSM hoặc CA thật

Mặc định local dùng adapter `MOCK` để kiểm thử trọn quy trình mà không tạo private key thật. Để thử adapter HTTPS trên stack local, điền cấu hình riêng trong `.env`. Production dùng [mẫu cấu hình riêng](deploy/production.env.example) và đọc token từ tệp bí mật.

```dotenv
CRYPTO_PROVIDER_MODE=HTTP
CRYPTO_PROVIDER_URL=https://crypto-adapter.noibo.example
CRYPTO_PROVIDER_TOKEN=token-lay-tu-secret-manager
CRYPTO_PROVIDER_SCOPE=ten-moi-truong-va-tai-khoan-provider
CRYPTO_PROVIDER_TIMEOUT_MS=15000
```

Adapter nhận `POST /assets` để cấp/gia hạn và `POST /assets/revoke` để thu hồi. Crypta chỉ lưu mã tham chiếu, fingerprint và metadata trả về; không nhận hoặc lưu private key.

Mỗi thao tác gửi `operationId` là ID yêu cầu và header `Idempotency-Key`. Crypta ghi trạng thái trước và sau khi gọi adapter. Security Admin dùng **Đối soát provider** để xử lý lần gửi cần kiểm tra. Giữ `CRYPTO_PROVIDER_SCOPE` ổn định cho cùng tài khoản và endpoint. Trước khi dùng dữ liệu thật, xác minh khả năng xử lý lặp và tra cứu kết quả theo `operationId` trên sandbox của provider đã chọn. [Cấu hình và tiêu chí kiểm tra](CAU_HINH_DICH_VU_THAT.md)

## Kiến trúc chạy

Điều hướng dashboard dùng client-side routing. Menu thay nội dung chính và cập nhật URL, Back/Forward hoạt động trong SPA. Các trang Admin Users, Assets, Audit, Email, User Requests và Approver Queue giữ bộ lọc, tìm kiếm và trang trong query URL. Image Docker mặc định tắt fade khi chuyển trang theo kết quả đo N6. Khi cần thử riêng, build frontend với `--build-arg VITE_ROUTE_MOTION=on`. Fade thử nghiệm tuân theo thiết lập giảm chuyển động của hệ điều hành. [Kết quả N6](IMPLEMENTATION_TRACKER.md)

- `frontend`: React/TypeScript được Nginx phục vụ tại cổng `8080`.
- `backend`: NestJS API nội bộ; Swagger ở `/docs` trong mạng backend hoặc khi mở cổng riêng.
- `postgres`: dữ liệu nghiệp vụ, phiên refresh đã hash, audit log và hàng đợi email.
- `mailhog`: chỉ chạy khi chủ động dùng profile `local-mail`; không tham gia gửi mail thật.

## Điều hướng giao diện

Mới nhất06/11: [viền focus và nhãn radio](T30_FOCUS_CONTRAST_2026-11-06.md) đạt600/600 kiểm tương phản, cận thấp nhất4,64449:1; native radio keyboard12/12/hai build đạt. Chỉ CSS đổi, JavaScript giữ byte pha trước; snapshot206 file/cleanup đã kiểm. Chưa là nghiệm thu toàn WCAG hoặc T30.

Pha focus trước đó: [sửa Tab thoát dialog đang gửi](T30_DIALOG_FOCUS_2026-11-06.md), before0/16→96/96 nhóm kiểm lỗi; FE131/131,180/180 fixture mỗi Edge/Chrome/Firefox,visual4/4/hai build đạt. Những suite này không chạy lại trong lượt CSS; xem báo cáo để phân biệt source/build từng pha.

Pha integration06/11 trước sửa focus: [26/26 mỗi Edge/Chrome](T30_DELAYED_GET_2026-11-06.md), thêm ba race GET thật chờ PostgreSQL qua route/logout/role; backup11/11 và cleanup đạt. Trước đó có [runtime LOGIN/API19/19](T43_RUNTIME_LOGIN_2026-11-06.md), gồm cấp lại quyền/password rotation. BE186/186/build, audit0 cả ba scope và worker23/policy8/expiry13/parser3 giữ phạm vi từng pha; không chạy lại trong lượt focus. Parent Compose vẫn bootstrap local/demo; rollout runtime, T30/N6 và toàn dự án còn mở. [Tiến độ](PROJECT_PROGRESS_2026-11-05.md), [54+6 task](TASK_STATUS_2026-11-05.md); [provider/SMTP/deployment thật chưa chọn](CAU_HINH_DICH_VU_THAT.md).

[Đối chiếu network Users12/12](T30_USERS_NETWORK_2026-11-06.md) bổ sung baseline fixture trước/sau routing: entry7→3 GET,503+retry14→4, không đọc bảng ngoài nhu cầu Users. [Skeleton gộp hàng](T30_SKELETON_BANDS_2026-11-06.md) không được tích hợp vì24 mẫu chưa có lợi ích performance ổn định; product giữ nguyên.

Stack tích hợp có runner `./tools/test-isolated-stack.ps1` và `tools/test-real-integration.cjs`; dùng DB/volume mới riêng, localhost, SMTP tắt và provider MOCK. [Hướng dẫn](tools/testing/README.md). Docker đã hoạt động và suite thật đã chạy; stack test sau đó được dọn đúng namespace, giữ container vận hành. Chạy suite browser thật tuần tự trên cùng stack.

Dashboard dùng client-side routing: sidebar và topbar được giữ nguyên, còn vùng nội dung chính thay theo URL. Vì vậy có thể bookmark, tải lại trực tiếp và dùng Back/Forward cho các trang như `/dashboard`, `/assets`, `/requests`, `/approvals`, `/policies`, `/users`, `/audit`, `/operations/email` và `/notifications`. Quyền ở frontend chỉ kiểm soát trải nghiệm; API vẫn là nơi quyết định quyền và phạm vi dữ liệu thật. Nginx đã cấu hình SPA fallback về `index.html` cho deep link, còn `/api/` tiếp tục được proxy riêng tới backend.

Khi thao tác đang gửi hoặc kết quả chưa rõ, giao diện giữ thông báo kể cả sau khi rời/đóng rồi mở lại form. Nút **Kiểm tra dữ liệu** chỉ đọc trạng thái hiện tại; thao tác cũ vẫn có thể đã được thực hiện. Sau khi đối chiếu, tick xác nhận rồi **Kết thúc đối chiếu** để gỡ theo dõi; thao tác này không gửi lại hoặc chứng minh lần gửi trước thành công. Theo dõi chỉ tồn tại trong bộ nhớ và sẽ mất nếu reload/đóng tab.

Dashboard và bảng tài khoản có vùng giữ chỗ lúc tải chậm. Tải lại cùng bảng giữ dữ liệu trước đó và khóa thao tác đổi trạng thái tới khi đọc xong; lỗi dịch vụ ghi rõ snapshot cũ. Đổi query hoặc mất quyền bỏ dữ liệu cũ để tránh nhầm ngữ cảnh.

Mỗi page/bảng sở hữu dữ liệu của mình; shell chỉ đọc summary và số thông báo chưa đọc. Dashboard gọi `/api/v1/dashboard?role=...`, shell gọi `/api/v1/dashboard/summary?role=...`; backend kiểm tra role đã cấp. Thống kê User lấy toàn bộ owner scope, không lấy 250 tài sản đầu. Bản thay đổi này cần build/triển khai **cả frontend và backend**; backend cũ chưa có summary/lifecycle. Bảng ownership, hợp đồng và bằng chứng chưa nghiệm thu nằm ở [báo cáo T30 mới nhất](T30_PROGRESS_2026-10-06.md) và các báo cáo được dẫn tại đó.

Các trang “của tôi” dùng `ownedOnly=true` (assets/selector) và `createdByMe=true` (requests): API lấy ID từ phiên để lọc trước count/pagination, kể cả tài khoản nhiều role. Không truyền filter giữ scope theo quyền server hiện có. Có ADMIN trong tập role thì UI không cho tạo/duyệt bằng cách đổi role hiển thị; action chi tiết còn kiểm tra ownership, creator, department, trạng thái và version. API tiếp tục kiểm tra các điều kiện khi POST. Filter mới cũng cần backend tương ứng trước khi triển khai frontend.

Các bảng danh sách giữ `q`, `status`, `page`, `pageSize` được hỗ trợ trong URL. Số dòng mỗi trang từ 1 đến 100; đổi tìm kiếm/bộ lọc/số dòng về trang 1, Back/Forward/F5 giữ ngữ cảnh. URL sai được chuẩn hóa bằng replace. Tìm kiếm trên topbar ghi rõ đích theo trang đang xem; trang không hỗ trợ dùng đích theo role. Cảnh báo mở danh sách với filter phù hợp. Form chưa lưu có bước ở lại/bỏ thay đổi và beforeunload khi cần; trình duyệt có thể giới hạn cảnh báo, dữ liệu form không được lưu tự động để phục hồi.

## Kiểm tra dành cho lập trình viên

```text
cd backend
npm ci
npm run build
npm run test:openapi
npm test

cd ../frontend
npm ci
npm test
npm run build

cd ..
powershell -ExecutionPolicy Bypass -File .\tools\smoke-spa-routes.ps1
powershell -ExecutionPolicy Bypass -File .\tools\smoke-test.ps1
```

`smoke-spa-routes.ps1` chỉ đọc: gọi bản đang chạy tại `http://localhost:8080` để kiểm tra deep link không redirect, JS asset và API health. `smoke-test.ps1` là kiểm thử tích hợp **có ghi database**: đăng nhập Admin, tạo tài khoản tạm, bắt buộc đổi mật khẩu, thu hồi phiên, kiểm tra hàng đợi Approver và policy. Chỉ chạy script thứ hai trên môi trường thử nghiệm phù hợp; tài khoản test được tự động vô hiệu hóa sau khi chạy.

Browser regression cách ly: build frontend, chạy `npm --prefix frontend run preview -- --host 127.0.0.1 --port 4173 --strictPort`, rồi `node tools/test-spa-workspace.cjs "<thu-muc-node_modules-chua-playwright>"` trong terminal khác. Mặc định dùng Edge đã cài; `CRYPTA_TEST_BROWSER` chọn browser và `CRYPTA_UI_TEST_URL` chọn preview. Script chặn toàn bộ `/api/v1/*` bằng fixture, không ghi DB; kết quả/ảnh/trace lỗi ở `tools/test-artifacts/spa`. Không dùng bộ này thay integration API/DB hoặc Nginx smoke.

Khởi chạy local không Docker: backend cổng `3000`, frontend cổng `5173`; Vite tự proxy `/api` sang backend.

## Lưu ý triển khai thực tế

Production dùng [Compose riêng](docker-compose.production.yml) với image đã duyệt, PostgreSQL runtime qua TLS, proxy HTTPS và bí mật từ tệp do môi trường cấp. [Quy trình triển khai](RELEASE_RUNBOOK.md#cấu-hình-docker-production)

Backup thủ công khi PostgreSQL đang chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\backup-crypta.ps1
```

Tệp `.dump` và manifest SHA-256 nằm trong `backups/` (đã được Git bỏ qua). Diễn tập phục hồi chỉ vào **database mới**, không ghi đè database ứng dụng:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\restore-crypta-test.ps1 -BackupFile .\backups\TEN_TEP.dump -TargetDatabase crypta_restore_test
```

Chọn tệp từ một backup có manifest hợp lệ và dùng tên database đích chưa tồn tại. Script đối chiếu SHA-256 trước và sau khi chép dump vào container, rồi kiểm `pg_restore --list` trước khi tạo database. Sau khi phục hồi, database đích được giữ để đối chiếu. Trước production còn cần lịch backup, lưu trữ ngoài máy và diễn tập trên môi trường đích. Khóa tại KMS/CA có quy trình sao lưu riêng của provider. [Quy trình nâng cấp và phục hồi](RELEASE_RUNBOOK.md)

- Provision tài khoản Admin ban đầu, lập lịch backup PostgreSQL và giám sát email `FAILED`.
- Kết nối adapter KMS/HSM/CA production bằng `CRYPTO_PROVIDER_MODE=HTTP`.
- Database có migration tương thích volume cũ; file bootstrap chỉ dành cho database mới.
