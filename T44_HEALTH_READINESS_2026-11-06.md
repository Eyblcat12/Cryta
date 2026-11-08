# T44 — Kiểm tra liveness và readiness

| Endpoint | Điều kiện | Kết quả |
| --- | --- | --- |
| `GET /api/v1/health/live` | Tiến trình API trả lời HTTP | 200, trạng thái và thời gian |
| `GET /api/v1/health/ready` | API kết nối được PostgreSQL và chạy `SELECT 1` | 200 khi thành công, 503 `DATABASE_UNAVAILABLE` khi thất bại |
| `GET /api/v1/health` | Cùng kiểm tra với readiness | Giữ đường dẫn, nội dung phản hồi và operation ID của client hiện có |

Compose dùng readiness. Probe dùng tối đa một kết nối PostgreSQL riêng và gộp các yêu cầu đến trong khi đang kiểm tra. Kết nối có thời hạn 1 giây và đọc kết quả có thêm tối đa 1 giây. Driver loại kết nối lỗi. 503 mang request ID theo định dạng API hiện tại. Khi khởi động, API vẫn phải qua bước migration hoặc kiểm ledger trước khi mở cổng HTTP.

| Kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| Trước sửa, máy chủ loopback không trả handshake | Probe còn chờ tại mốc 2.519 ms | [Đối chứng](tools/test-artifacts/health-readiness-20261106/before-results.json) |
| Sau sửa, treo handshake hoặc treo sau khi nhận `SELECT 1` | Hai nhóm, mỗi nhóm sáu yêu cầu đồng thời cùng trả 503 trong 1.023–1.073 ms, dùng một kết nối mỗi nhóm. Liveness 200 trong 4–16 ms. Mỗi lần thử lại mở kết nối mới, còn 0 socket lỗi trước khi dọn fixture. | [Kết quả loopback](tools/test-artifacts/health-readiness-20261106/after-results.json) |
| PostgreSQL 17 và Nginx trong Compose | 9/9 probe. Liveness 200 trong 6 ms lúc mất DB, hai readiness 503 trong 1.008 ms. Cả ba trở về 200, đăng nhập lại 200, API giữ PID, thời điểm chạy và số lần restart. Ba operation ID Swagger đạt. | [Kết quả outage](tools/test-artifacts/integration/crypta-t30-test-a8eaf09637cf/health-readiness.json) |
| Backend | 186/186 test, build đạt. Ba file JS đã đối chiếu giữa build local, fixture và image. Hai request ID của 503 xuất hiện trong log và secret sinh cho lượt thử vắng mặt. | [Unit](tools/test-artifacts/health-readiness-20261106/backend-tests-final.json), [đối chiếu image](tools/test-artifacts/integration/crypta-t30-test-a8eaf09637cf/health-provenance.json) |
| Dọn tài nguyên | 0 container, volume và network của stack thử. Tám container khác giữ nguyên danh tính. | [Cleanup](tools/test-artifacts/integration/crypta-t30-test-a8eaf09637cf/cleanup-report.json) |

Bản chụp gồm 208 file nguồn và hai build frontend. [Manifest](tools/test-artifacts/frontend-artifacts/health-readiness-20261106-final/source-manifest.json).

Lượt loopback đầu có sai số ở bộ đếm socket vì fixture chưa đọc dữ liệu đến. Lượt cuối bật đọc socket để nhận sự kiện đóng và kiểm lại cả hai tình huống. Phép thử Compose dùng provider MOCK và SMTP tắt. Readiness đo kết nối PostgreSQL và một truy vấn đơn giản. T44 còn đo khả năng phục vụ của pool nghiệp vụ, log có cấu trúc, metrics, ngưỡng và kênh cảnh báo, cùng diễn tập lỗi provider/SMTP.

## Lượt tiếp theo — log JSON và lọc lỗi HTTP/SMTP

API sinh `x-request-id` cho từng yêu cầu. Client dùng giá trị trả về trong header hoặc body để tra log. Log `http.server_error` có method, route mẫu, status, request ID và thời gian xử lý. Lỗi ngoài giữ mã công khai của API. Worker email ghi ID thông báo, trạng thái SMTP dạng số nếu có và thông báo chuẩn. Quy tắc hàng đợi vẫn dựa vào mã phản hồi và số lần thử. Worker tài sản ghi sự kiện đối soát sau commit, còn job hết hạn ghi số lượng và thời gian chạy.

| Kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| Đối chứng kiểm log HTTP và lỗi SMTP | 17/20 trên mã trước. Ba ca phát hiện dữ liệu giả trong URL, stack hoặc thông báo lỗi SMTP. | [Đối chứng](tools/test-artifacts/log-redaction-20261106/before.json) |
| Build và toàn bộ test backend | 187/187. Sáu file JS trong image khớp build local. | [Unit](tools/test-artifacts/log-redaction-20261106/after.json), [đối chiếu image](tools/test-artifacts/integration/crypta-t30-test-e99b98df2c79/log-redaction-provenance.json) |
| PostgreSQL outage qua Nginx | 9/9 probe. Hai lỗi 503 khớp request ID trong header, body và log JSON. Hai chuỗi giả trong header và query vắng mặt trong log backend. | [HTTP và log](tools/test-artifacts/integration/crypta-t30-test-e99b98df2c79/health-readiness.json) |
| SMTP qua Nodemailer và bảng PostgreSQL tạm | 5/5. 451 còn lượt → PENDING, 451 hết lượt hoặc 550 → FAILED, ngắt kết nối → RECONCILIATION_REQUIRED, lỗi verify → SMTP_VERIFY_FAILED. Chuỗi giả vắng mặt trong log của worker và thông báo mới lưu. | [SMTP loopback](tools/test-artifacts/integration/crypta-t30-test-e99b98df2c79/smtp-loopback.json) |
| Hồi quy PostgreSQL | Worker tài sản 23/23, job hết hạn 13/13. Stack test còn 0 container, volume, network sau dọn. | [Worker](tools/test-artifacts/integration/crypta-t30-test-e99b98df2c79/worker-recovery-after-70eab006a4da/results.json), [Expiry](tools/test-artifacts/integration/crypta-t30-test-e99b98df2c79/expiry-scan-92ae63c4eb2e/results.json), [Cleanup](tools/test-artifacts/integration/crypta-t30-test-e99b98df2c79/cleanup-report.json) |

T21 còn kiểm kê log proxy, đường khởi động, audit từ chối và dữ liệu SMTP lịch sử đã lưu. T44 còn metrics tuổi hàng đợi, độ trễ toàn API, ngưỡng và kênh cảnh báo, diễn tập provider và SMTP trên môi trường đã chọn.

## Lượt metrics và tín hiệu vận hành

Security Admin dùng `GET /api/v1/operations/metrics` với access token. API trả snapshot `no-store`. PostgreSQL đo số việc sẵn sàng và đang xử lý, tuổi công việc sẵn sàng lâu nhất, số thao tác provider cần đối soát, và email đến hạn, hẹn giờ, đang gửi, thất bại hoặc cần đối soát. Tuổi hàng đợi trống là `null`. Chế độ provider và cờ SMTP thể hiện cấu hình. Trạng thái provider cần đối soát là dữ liệu đã ghi trong DB.

Mỗi tiến trình giữ kết quả và thời gian chạy gần nhất của ba worker. Kết quả poll hoàn tất thể hiện vòng poll kết thúc, còn lỗi từng việc nằm trong các số đếm DB. Bộ đếm HTTP nhóm response đã hoàn tất theo lớp status và các khoảng thời gian đến 100 ms, 500 ms, 1 s, 3 s và trên 3 s. Health và metrics được loại khỏi bộ đếm. Đọc `process.since` để nhận biết khi số đếm bắt đầu lại.

| Tín hiệu | Điều kiện | Đầu mối xử lý đề xuất |
| --- | --- | --- |
| `ASSET_QUEUE_DELAYED` | Có yêu cầu APPROVED chờ từ 120 giây | Vận hành worker |
| `PROVIDER_RECONCILIATION_REQUIRED` | Có ít nhất một thao tác provider cần đối soát | Vận hành mật mã |
| `EMAIL_QUEUE_DELAYED` | SMTP bật và email đã đến hạn chờ từ 300 giây | Vận hành email |
| `EMAIL_RECONCILIATION_REQUIRED` | Có ít nhất một email cần đối soát | Vận hành email |
| `EMAIL_WORKER_FAILED` / `EMAIL_WORKER_STALE` | SMTP bật và lượt quét gần nhất gặp lỗi hoặc không có lượt quét kết thúc trong năm phút. Khi chưa ghi lượt nào, đo từ lúc tạo dòng trạng thái. | Vận hành email |
| `EXPIRY_SCAN_FAILED` / `EXPIRY_SCAN_STALE` | Lần quét lấy được khóa gần nhất thất bại hoặc đã 2 giờ từ lần thành công gần nhất theo PostgreSQL. Nếu chưa thành công, tính từ lúc tạo dòng trạng thái. | Vận hành job |

Khi metrics trả `503 METRICS_UNAVAILABLE`, kiểm `/health/ready` để phân biệt lỗi truy vấn hàng đợi với mất kết nối DB. Kiểm thử khóa bảng xác nhận thời hạn khoảng 2 giây sau khi gửi truy vấn. Xác thực và lấy connection dùng pool API. Kênh thu thập và người trực cụ thể sẽ cấu hình theo môi trường triển khai, ưu tiên kênh ngoài email cho cảnh báo SMTP.

| Kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| Quyền và bộ đếm HTTP | Guest 401, User và Approver 403, Admin 200. Loại probe và scrape khỏi bộ đếm. Có kết quả thật của asset poll và expiry scan. | [Runtime metrics](tools/test-artifacts/integration/crypta-t30-test-bba6c4ae4979/operations-metrics.json) |
| Snapshot và tín hiệu từ SQL | Bảng PostgreSQL tạm xác nhận tuổi hàng đợi, email đến hạn và hẹn giờ, loại IN_APP và phát tín hiệu phù hợp khi bật hoặc tắt SMTP. | [Runtime metrics](tools/test-artifacts/integration/crypta-t30-test-bba6c4ae4979/operations-metrics.json) |
| Khóa bảng thông báo | Ba yêu cầu chia sẻ một truy vấn chờ khóa. Metrics 503 trong 2.009–2.010 ms, readiness 200, nhả khóa rồi metrics 200. | [Runtime metrics](tools/test-artifacts/integration/crypta-t30-test-bba6c4ae4979/operations-metrics.json) |
| PostgreSQL runtime LOGIN | 19/19 nhóm, gồm Admin đọc metrics qua API chạy bằng quyền tối thiểu. | [Runtime privileges](tools/test-artifacts/integration/crypta-t30-test-bba6c4ae4979/runtime-privileges-a62a78478b1f/results.json) |
| Hồi quy và đối chiếu | 187/187 test backend và build đạt. Outage 9/9 qua Nginx. 11 file JS khớp build local và image. Stack đã dọn. | [Unit](tools/test-artifacts/operations-metrics-20261106/backend.json), [Health](tools/test-artifacts/integration/crypta-t30-test-bba6c4ae4979/health-readiness.json), [Image](tools/test-artifacts/integration/crypta-t30-test-bba6c4ae4979/operations-metrics-provenance.json), [Cleanup](tools/test-artifacts/integration/crypta-t30-test-bba6c4ae4979/cleanup-report.json) |

Lượt này kiểm số liệu, tín hiệu hàng đợi và quyền truy cập. T44 còn bộ thu thập và gửi cảnh báo, kiểm ngưỡng thời gian của expiry bằng sự cố, số đo dưới tải và diễn tập provider/SMTP trên môi trường đã chọn.

## Lượt bộ theo dõi độc lập

`node tools/monitor-operations.cjs` chạy dưới tiến trình do vận hành quản lý, có thể đặt ngoài máy chạy API. Nó đọc liveness và readiness trước. Khi DB sẵn sàng, nó đọc `/api/v1/operations/signals` bằng token chỉ đọc mã tín hiệu. Route này tắt khi chưa cấu hình hash và chỉ trả thời gian lấy mẫu cùng mã tín hiệu. Token monitor không cấp quyền vào metrics Admin hoặc các API nghiệp vụ.

Để cấu hình, sinh token ngẫu nhiên 32 byte, mã hóa thành 64 ký tự hex thường và lưu trong file chỉ tài khoản chạy monitor được đọc. Backend nhận SHA-256 của **chuỗi hex**, đặt tại `OPERATIONS_MONITOR_TOKEN_SHA256`. Chạy lại backend với cấu hình mới rồi cấp file token cho monitor. Khi xoay token, thay đồng thời file và hash, sau đó kiểm lỗi quyền trong log monitor.

```powershell
$env:CRYPTA_MONITOR_ORIGIN = 'https://crypta.example.invalid'
$env:CRYPTA_MONITOR_TOKEN_FILE = 'C:\secrets\crypta-monitor.token'
$env:CRYPTA_MONITOR_STATE_FILE = 'C:\crypta-monitor\state.json'
node tools/monitor-operations.cjs
```

Origin là HTTPS, hoặc HTTP loopback để thử. Monitor từ chối redirect. Mỗi probe có thời hạn 4 giây và giới hạn body 16 KiB. Monitor đợi 15 giây giữa các lượt. Hai mẫu liên tiếp mở hoặc đóng cảnh báo. Khi API hoặc DB không cho phép quan sát hàng đợi, trạng thái cảnh báo hàng đợi được giữ đến khi có mẫu mới.

Kênh hiện có là stdout JSON, độc lập với SMTP. `operations.alert_opened` và `operations.alert_resolved` mang `eventId`, mã cảnh báo, mức độ, thời gian và nhãn nhóm xử lý. Collector của môi trường triển khai có thể định tuyến theo `owner` đến người trực platform, database, mật mã, mail hoặc job.

`CRYPTA_MONITOR_STATE_FILE` là tùy chọn. Dùng một tiến trình monitor cho mỗi file trong thư mục cục bộ có quyền ghi, chỉ tài khoản monitor được truy cập. File giữ mã cảnh báo đang mở và các chuyển trạng thái chưa ghi xong ra stdout. Sau restart, monitor nạp lại cảnh báo đang mở, phát lại bản ghi đang chờ với cùng `eventId` và bắt đầu lại bộ đếm mẫu. Collector khử trùng bản ghi phát lại theo `eventId`. Khi chưa cấu hình file, trạng thái chỉ nằm trong bộ nhớ. File hỏng hoặc gắn với origin khác làm monitor dừng với `MONITOR_INVALID_STATE` để người vận hành kiểm tra. Ghi xong stdout xác nhận việc chuyển vào luồng log của tiến trình. Kiểm định tuyến và nhận cảnh báo ở kênh trực được thực hiện riêng.

| Kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| CLI và HTTP fixture | 3/3. CLI phát JSON stdout sau hai probe lỗi. Token không theo redirect, dữ liệu quá cỡ hoặc mã lạ được coi là chưa quan sát. | [TAP](tools/test-artifacts/operations-monitor-20261106/monitor.tap) |
| Quyền monitor | Qua Nginx, thiếu/sai token 401, token monitor vào metrics Admin 401, token đúng vào signals 200 với snapshot tối thiểu. Hai ca hash trống/sai trả 404 khi gọi controller biên dịch trong image. | [Runtime](tools/test-artifacts/integration/crypta-t30-test-15a59776c463/operations-monitor.json), [đối chiếu image](tools/test-artifacts/integration/crypta-t30-test-15a59776c463/operations-monitor-provenance.json) |
| Cảnh báo và phục hồi | Sáu chuyển trạng thái cho DB, provider và email. DB dừng thật, provider/email dùng bản ghi cần đối soát giả trong PostgreSQL. Hai cảnh báo hàng đợi giữ mở trong outage DB, phục hồi sau khi dọn fixture. Không có bản sao sự kiện hay token trong log kiểm tra. | [Sự kiện monitor](tools/test-artifacts/integration/crypta-t30-test-15a59776c463/operations-monitor.json) |
| Hồi quy và dọn tài nguyên | 187/187 test backend và build đạt. Metrics Admin và khóa bảng đạt trên cùng image. Đã dọn stack và file token thử. | [Unit](tools/test-artifacts/operations-monitor-20261106/backend.json), [Metrics](tools/test-artifacts/integration/crypta-t30-test-15a59776c463/operations-metrics.json), [Cleanup](tools/test-artifacts/integration/crypta-t30-test-15a59776c463/cleanup-report.json) |

T44 còn nối collector stdout vào kênh người trực đã chọn, kiểm ngưỡng dưới tải và diễn tập gián đoạn với provider/SMTP của môi trường đó.

## Lượt 08/11/2026

Migration 025 lưu trạng thái quét hết hạn trong PostgreSQL. Replica không lấy được khóa giữ nguyên trạng thái chung. Lượt thành công chỉ cập nhật mốc sau khi công việc cùng giao dịch có thể commit. Lượt thất bại ghi sau rollback nếu database còn truy cập được. Một lỗi cũ ghi muộn không ghi đè lượt thành công mới hơn. Kết quả trong `process.jobs` vẫn mô tả riêng từng tiến trình, còn mã cảnh báo đọc từ database chung. Khi PostgreSQL gián đoạn, theo dõi readiness cùng tín hiệu lỗi cục bộ.

Bộ expiry PostgreSQL đạt 21/21, gồm hai bộ đọc metrics dùng chung DB, khởi tạo lại bộ đọc, bỏ qua lượt thua khóa và mô phỏng lỗi ghi muộn. Ca kiểm đưa mốc thành công về ba giờ trước để xác minh `EXPIRY_SCAN_STALE`. Còn kiểm nhiều máy và chuyển cảnh báo đến người trực trên môi trường đích. [Kết quả cách ly](tools/test-artifacts/integration/crypta-t30-test-b97d86ae9c93/expiry-scan-c609ce13b0f8/results.json)

Collector đạt 6/6 ca CLI và HTTP loopback, gồm phát lại sự kiện đang chờ với cùng ID sau lỗi ghi, giữ trạng thái đang mở và đóng sau hai mẫu khỏe. Diễn tập Nginx/PostgreSQL dừng rồi khởi động lại riêng database thử, nạp lại trạng thái collector hai lần, ghi sáu chuyển trạng thái với sáu ID riêng và giữ nguyên tiến trình API. [Kết quả collector](tools/test-artifacts/integration/crypta-t30-test-80255a70f4f0/operations-monitor.json)
