# Vận hành hàng đợi email Crypta

Crypta chỉ gửi thư thật khi `SMTP_ENABLED=true` và đã cấu hình `SMTP_HOST`, `SMTP_FROM` cùng thông số xác thực/TLS phù hợp. Không lưu mật khẩu SMTP trong Git hoặc gửi qua chat. `SMTP_FROM` phải là danh tính gửi được nhà cung cấp cho phép. Lệnh gửi thử xác minh SMTP nhận thư, **không** chứng minh thư đã đến Inbox; cần kiểm tra Inbox, Spam và header tại hộp thư thử.

Đặt `SMTP_SECURE=true` với cổng TLS trực tiếp, thường là 465. Với STARTTLS, thường là cổng 587, đặt `SMTP_SECURE=false`. Crypta yêu cầu nâng cấp STARTTLS trước xác thực hoặc gửi thư. Relay thử không mã hóa chỉ được phép với địa chỉ loopback trực tiếp và không dùng tài khoản SMTP. Nếu cấu hình auth, điền cả username và password qua secret của môi trường. [Tùy chọn TLS của Nodemailer](https://nodemailer.com/smtp#tls-options)

Khi bật SMTP, API chỉ hoàn tất startup sau khi cấu hình hợp lệ và kiểm kết nối thành công. Khi kiểm TLS hoặc xác thực thất bại, log chỉ ghi sự kiện `email.smtp_verify_failed`. Chế độ demo có thể dùng `SMTP_ENABLED=false` để chạy không gửi thư.

Bộ kiểm SMTP loopback dùng relay có chứng thư sinh tạm. Khi CA chưa được tin cậy, worker dừng trước AUTH. Khi thêm CA vào bộ tin cậy của tiến trình thử, relay nhận AUTH và DATA sau STARTTLS, chấp nhận đúng một thư và ứng dụng ghi `EMAIL_TEST_ACCEPTED`. [Bài kiểm](backend/test/email-test-smtp.integration.ts)

Ngày 09/11, hai image từ commit `51c9a4a` chạy Compose production trên Docker trong WSL với PostgreSQL TLS và relay STARTTLS cách ly. PostgreSQL có bản ghi `SENT` ngay lần thử đầu cho cả bốn loại thư được kiểm, gồm thư duyệt, tài sản sắp hết hạn, lời mời và đặt lại mật khẩu. Relay hoàn tất 15 phiên STARTTLS có AUTH, nhận 14 thư và ghi 0 lệnh AUTH hoặc DATA qua kết nối chưa mã hóa. Smoke HTTPS đạt 10/10. Đã dọn stack thử và đối chiếu 15 container ngoài stack giữ nguyên ID. [Báo cáo diễn tập](tools/test-artifacts/crypta-ca-test-039355c91717/report.json)

Job backend trên GitHub xác nhận 7/7 ca SMTP trên `51c9a4a`, gồm ca STARTTLS có xác thực. Artifact `13692863421` khớp SHA-256 `d87d396c3cd954d12974138f910444b2292ff8dd9882658057adb6a311ef92f7`. [GitHub Actions](https://github.com/Eyblcat12/Cryta/actions/runs/42658794991)

## Gửi thư kiểm tra

Chỉ Security Admin đang hoạt động được dùng `POST /api/v1/notifications/test-email`. Giới hạn dùng chung DB là một lượt/Admin/phút và năm lượt/toàn hệ thống/phút; quá hạn trả 429. Ghi audit giữ lượt trước khi gửi và nhả khóa DB trước kết nối SMTP. Mỗi lượt có operation ID và Message-ID `<email-test-UUID@domain-cua-SMTP_FROM>`. Theo correlation của phản hồi, Admin có thể tra API audit với `correlationId=req_UUID`, rồi đối chiếu operation ID và hộp thư.

Chỉ `EMAIL_TEST_ACCEPTED` xác nhận SMTP chấp nhận đúng người nhận. `EMAIL_TEST_REJECTED` là từ chối có bằng chứng. `EMAIL_TEST_OUTCOME_UNKNOWN` hoặc `SMTP_TEST_ACKNOWLEDGEMENT_FAILED` cần kiểm tra hộp thư, Message-ID và audit trước khi gửi lại; hệ thống không tự thử lại. Lượt đã giữ vẫn được tính khi SMTP từ chối hoặc kết quả chưa rõ. Không lấy việc hết cửa sổ giới hạn tần suất làm bằng chứng thư trước chưa gửi.

Audit không lưu địa chỉ nhận đầy đủ, chỉ domain, operation ID và correlation. Runtime không được sửa/xóa audit, nên cửa sổ giới hạn không phụ thuộc bộ nhớ API. Chính sách retention cần giữ ít nhất cửa sổ một phút đang dùng; cấu hình lưu trữ dài hạn còn thuộc T22. [Bằng chứng và các kiểm còn chờ](T28_EMAIL_TEST_OPERATIONS_2026-11-06.md).

## Nội dung và liên kết

Khi bật SMTP, đặt `APP_URL` thành origin của frontend, ví dụ `https://crypta.example.com`. URL không có user/password, path, query hoặc fragment. HTTP chỉ được phép trên localhost/127.0.0.1/IPv6 loopback để thử local. `APP_ORIGIN` tiếp tục dùng cho CORS; khi đổi domain phải cấu hình cả hai. Thiếu hoặc sai `APP_URL` làm startup SMTP dừng trước khi kết nối. `APP_TIME_ZONE` là múi giờ IANA hợp lệ, mặc định `Asia/Ho_Chi_Minh`; thư hiển thị rõ múi giờ bên cạnh thời gian.

Các mẫu nghiệp vụ bao gồm yêu cầu mới, chờ phê duyệt cấp hai, được duyệt, bị từ chối, hoàn tất, lỗi hoặc cần đối soát, cùng các sự kiện tài sản sắp hết hạn, đã hết hạn và thu hồi. Nội dung HTML và plain text dùng tên người nhận, sự kiện, mã tham chiếu và thời gian. Liên kết tới yêu cầu hoặc tài sản tiếp tục qua đăng nhập và kiểm quyền. Dữ liệu cũ thiếu mã hợp lệ mở trung tâm thông báo. Khi thiếu thời gian, thư bỏ dòng thời gian. Worker cũng hỗ trợ thư mời, đặt lại mật khẩu, báo đã đổi mật khẩu và báo thay đổi MFA.

Worker ghi thông báo kết quả cùng transaction trạng thái/audit. Nếu ghi thông báo hoàn tất lỗi sau khi provider đã trả kết quả, asset/hoàn tất rollback và receipt được giữ để đối soát. Không tự gọi lại provider. Mỗi kết quả và mỗi kênh có một deduplication key. Chuẩn bị nội dung lỗi trước khi gọi SMTP là kết quả chắc chắn chưa gửi: trạng thái FAILED với thông báo chuẩn; không xếp vào kết quả SMTP chưa rõ.

Trước khi gửi thư yêu cầu mới, worker kiểm lại tài khoản, đơn vị, vai trò Approver và phạm vi của yêu cầu. Nếu Approver đã mất phạm vi, thư chờ chuyển `FAILED` mà không gọi SMTP. Trạng thái của thông báo trong ứng dụng được quản lý riêng.

Mẫu mời và đặt lại mật khẩu dùng link riêng có hạn dùng. Xem mục Email mời và phục hồi tài khoản để bật luồng T07.

`node tools/test-real-email-delivery.cjs <report-stack-test.json>` kiểm DB/worker và SMTP loopback trong DB riêng. `node tools/preview-email-templates.cjs <report-email.json> <node_modules-co-playwright>` tạo HTML/plain-text và ảnh desktop/mobile bằng dữ liệu giả. Đây không thay bằng chứng Inbox, Spam, email client thật hoặc nghiệm thu T25. [Bằng chứng T24](T24_EMAIL_TEMPLATES_2026-11-06.md).

## Trạng thái và xử lý sự cố

Bảng **Tình trạng hàng đợi** hiển thị số email chờ gửi, đang gửi, đã được SMTP chấp nhận, thất bại và cần đối soát. Tuổi hàng đợi tính từ lịch của thư đến hạn lâu nhất. Lỗi gần nhất là mốc của các thư còn ở trạng thái thất bại. Dùng **Làm mới tình trạng** để đọc lại. Khi đọc lỗi, giao diện ghi rõ thời điểm của số liệu lần đọc trước nếu còn dữ liệu.

Mốc worker là lượt quét kết thúc gần nhất đã ghi vào PostgreSQL từ bất kỳ replica nào. Khi SMTP bật, hệ thống cảnh báo thư đến hạn chờ từ năm phút, lượt quét gần nhất gặp lỗi hoặc năm phút thiếu tín hiệu worker. Mốc quét phản ánh hoạt động của worker. Kết quả SMTP xem qua số đếm hoặc chi tiết thư, còn việc thư đến hộp thư được kiểm ở T25.

| Trạng thái | Ý nghĩa | Hành động |
| --- | --- | --- |
| `PENDING` | Chờ gửi hoặc SMTP từ chối tạm thời rõ ràng (4xx) | Worker tự thử lại, tối đa 5 lần. Bản ghi `PENDING` đã hết lượt chuyển sang `FAILED` trong lượt quét mà không gọi SMTP. |
| `SENDING` | Một worker đã nhận việc | Worker kiểm số lượt và thời hạn ngay trước SMTP. Sau 10 phút, lượt quá hạn không còn khóa sẽ chuyển sang cần đối soát. |
| `SENT` | SMTP đã chấp nhận đúng địa chỉ đích và database đã ghi nhận | Vẫn cần kiểm tra hộp thư nếu nghiệm thu gửi thật. |
| `FAILED` | Thư gặp lỗi chuẩn bị, bị SMTP từ chối hoặc đã xác minh SMTP chưa chấp nhận | Chỉ lên lịch gửi lại khi có mã phiếu đã ghi trong Audit Log và còn lượt. |
| `RECONCILIATION_REQUIRED` | Kết quả SMTP không chắc chắn hoặc worker/DB ngắt giữa chừng | **Không gửi lại tự động.** Kiểm tra log SMTP, Message-ID và hộp thư nhận; ghi quyết định vận hành trước khi thử lại thủ công. |

Message-ID của thư nghiệp vụ có dạng `<notification-UUID@domain-cua-SMTP_FROM>`. Mã thông báo nằm trong bảng `notifications.id`. Có thể tra cứu **chỉ đọc** trên database vận hành:

```sql
SELECT id, type, delivery_status, attempt_count, recipient_id,
       scheduled_for, claimed_at, sent_at, failed_at, error_message
FROM notifications
WHERE channel = 'EMAIL'
  AND delivery_status IN ('FAILED', 'RECONCILIATION_REQUIRED')
ORDER BY created_at DESC;
```

Đối chiếu nhật ký SMTP và hộp thư trước khi ghi kết quả. Dù dùng Message-ID ổn định và deduplication trong database, SMTP vẫn có trường hợp cần đối soát thủ công.

Worker giữ khóa trên bản ghi trong lúc chờ SMTP và ghi kết quả. Lượt quét bỏ qua bản ghi còn khóa để worker khác tiếp tục xử lý hàng đợi. Nếu PostgreSQL ngắt phiên sau DATA, dấu `SENDING` đã ghi trước khi gửi vẫn còn. Khi lượt hết hạn, hệ thống đưa thư sang đối soát. Phản hồi thành công thiếu địa chỉ đích cũng được đưa sang đối soát.

Security Admin mở **Vận hành → Email cần xử lý → Xem chi tiết** để xem số lượt, thời điểm và mã tra trong Message-ID. Với bản ghi **Cần đối soát**, chọn kết quả theo nhật ký SMTP, nhập mã phiếu nội bộ và chọn **Ghi kết quả**. Nếu SMTP đã chấp nhận, nhập thời điểm trong nhật ký theo UTC. Nếu dữ liệu đã đổi, dùng **Tải lại chi tiết** và so lại bằng chứng với lượt gửi mới. Nếu mất phản hồi khi ghi, dùng **Kiểm tra dữ liệu** để đọc trạng thái hiện tại.

Nếu SMTP xác nhận chưa chấp nhận, mở lại bản ghi và chọn **Lên lịch gửi lại** khi nút xuất hiện. Đối chiếu mã phiếu trước khi xác nhận. Worker nhận việc sau ít nhất hai phút khi SMTP đang bật. Số lượt chỉ tăng khi worker nhận việc và dùng chung giới hạn năm lượt với các lần thử tự động. Thư mời và đặt lại mật khẩu dùng luồng cấp liên kết mới của T07.

API `GET /api/v1/notifications/delivery-issues` chỉ trả metadata vận hành đã lọc và yêu cầu quyền Admin.

`GET /api/v1/notifications/delivery-issues/{id}` trả lần gửi gần nhất, số lượt, trạng thái và chẩn đoán đã lọc cho Security Admin. Mã `messageIdPrefix` dùng để tìm trong nhật ký SMTP. Khi danh tính gửi đã đổi, tra theo tên miền gửi ở thời điểm đó. Mã SMTP số chỉ lấy từ mẫu từ chối chuẩn do worker ghi.

`POST /api/v1/notifications/delivery-issues/{id}/reconcile` ghi quyết định của Security Admin cho bản ghi `RECONCILIATION_REQUIRED`. Gửi `attemptCount` từ chi tiết và `evidenceReference` là mã phiếu đối soát nội bộ. Với `outcome: ACCEPTED`, kèm `acceptedAt` theo bằng chứng SMTP ở dạng UTC có hậu tố `Z`. Với `outcome: UNSENT`, dùng bằng chứng SMTP xác nhận chưa chấp nhận và bỏ `acceptedAt`. Kết quả lần lượt là `SENT` hoặc `FAILED`. Trạng thái và audit commit cùng nhau. Nếu API trả 409, tải lại chi tiết và đối chiếu kết quả đang lưu. Luồng đối soát không đưa thư vào hàng đợi gửi.

`POST /api/v1/notifications/delivery-issues/{id}/retry` nhận `attemptCount` và `evidenceReference` đã ghi cho cùng lượt. API khóa bản ghi và lưu trạng thái `PENDING`, mốc hẹn cùng sự kiện `EMAIL_DELIVERY_RETRY_SCHEDULED` trong một giao dịch. Worker đọc lại tình trạng tài khoản và đơn vị người nhận trước khi gửi.

## Email mời và phục hồi tài khoản

Để bật T07, chạy migration `012_account_actions`, áp lại quyền runtime, rồi cấu hình `SMTP_ENABLED=true`, `APP_URL`, `ACCOUNT_ACTIONS_ENABLED=true` và `ACCOUNT_ACTION_KEY`. Dùng một khóa ngẫu nhiên 32 byte ở dạng 64 ký tự hex và lưu riêng trong secret của môi trường. Mọi instance API và email worker của cùng môi trường cần dùng chung khóa. Với môi trường thật, đặt `APP_URL` về origin HTTPS người dùng truy cập.

Security Admin tạo tài khoản ở trạng thái chờ chấp nhận lời mời. Link có hạn 24 giờ. Khi gửi lại, hệ thống thu hồi link cũ và giới hạn tối thiểu một phút giữa hai lượt cho cùng phiên bản tài khoản. Người dùng tự yêu cầu reset bằng email, với thời hạn 30 phút. API trả cùng thông báo cho email đủ điều kiện và email lạ. Yêu cầu lặp trong vòng hai phút dùng lượt đã cấp, với giới hạn ba yêu cầu mỗi địa chỉ trong 15 phút và giới hạn chung 120 yêu cầu mỗi phút. Cổng giới hạn chung chia sẻ giữa các instance.

Mã link nằm trong phần fragment. Trang mở link xóa fragment khỏi thanh địa chỉ và giữ mã trong bộ nhớ đến khi gửi biểu mẫu. Đổi mật khẩu thành công thu hồi phiên cũ và đưa thư báo thay đổi vào hàng đợi. Khi đổi `ACCOUNT_ACTION_KEY`, link chưa sử dụng mất hiệu lực. Sau khi đồng bộ khóa mới trên các instance, Admin có thể phát hành lại lời mời và người dùng có thể yêu cầu reset mới.
