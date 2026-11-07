# Vận hành hàng đợi email Crypta

Crypta chỉ gửi thư thật khi `SMTP_ENABLED=true` và đã cấu hình `SMTP_HOST`, `SMTP_FROM` cùng thông số xác thực/TLS phù hợp. Không lưu mật khẩu SMTP trong Git hoặc gửi qua chat. `SMTP_FROM` phải là danh tính gửi được nhà cung cấp cho phép. Lệnh gửi thử xác minh SMTP nhận thư, **không** chứng minh thư đã đến Inbox; cần kiểm tra Inbox, Spam và header tại hộp thư thử.

Đặt `SMTP_SECURE=true` với cổng TLS trực tiếp, thường là 465. Với STARTTLS, thường là cổng 587, đặt `SMTP_SECURE=false`. Crypta yêu cầu nâng cấp STARTTLS trước xác thực hoặc gửi thư. Relay thử không mã hóa chỉ được phép với địa chỉ loopback trực tiếp và không dùng tài khoản SMTP. Nếu cấu hình auth, điền cả username và password qua secret của môi trường. [Tùy chọn TLS của Nodemailer](https://nodemailer.com/smtp#tls-options)

Khi bật SMTP, API chỉ hoàn tất startup sau khi cấu hình hợp lệ và kiểm kết nối thành công. Khi kiểm TLS hoặc xác thực thất bại, log chỉ ghi sự kiện `email.smtp_verify_failed`. Chế độ demo có thể dùng `SMTP_ENABLED=false` để chạy không gửi thư.

## Gửi thư kiểm tra

Chỉ Security Admin đang hoạt động được dùng `POST /api/v1/notifications/test-email`. Giới hạn dùng chung DB là một lượt/Admin/phút và năm lượt/toàn hệ thống/phút; quá hạn trả 429. Ghi audit giữ lượt trước khi gửi và nhả khóa DB trước kết nối SMTP. Mỗi lượt có operation ID và Message-ID `<email-test-UUID@domain-cua-SMTP_FROM>`. Theo correlation của phản hồi, Admin có thể tra API audit với `correlationId=req_UUID`, rồi đối chiếu operation ID và hộp thư.

Chỉ `EMAIL_TEST_ACCEPTED` xác nhận SMTP chấp nhận đúng người nhận. `EMAIL_TEST_REJECTED` là từ chối có bằng chứng. `EMAIL_TEST_OUTCOME_UNKNOWN` hoặc `SMTP_TEST_ACKNOWLEDGEMENT_FAILED` cần kiểm tra hộp thư, Message-ID và audit trước khi gửi lại; hệ thống không tự thử lại. Lượt đã giữ vẫn được tính khi SMTP từ chối hoặc kết quả chưa rõ. Không lấy việc hết cửa sổ giới hạn tần suất làm bằng chứng thư trước chưa gửi.

Audit không lưu địa chỉ nhận đầy đủ, chỉ domain, operation ID và correlation. Runtime không được sửa/xóa audit, nên cửa sổ giới hạn không phụ thuộc bộ nhớ API. Chính sách retention cần giữ ít nhất cửa sổ một phút đang dùng; cấu hình lưu trữ dài hạn còn thuộc T22. [Bằng chứng và các kiểm còn chờ](T28_EMAIL_TEST_OPERATIONS_2026-11-06.md).

## Nội dung và liên kết

Khi bật SMTP, đặt `APP_URL` thành origin của frontend, ví dụ `https://crypta.example.com`. URL không có user/password, path, query hoặc fragment. HTTP chỉ được phép trên localhost/127.0.0.1/IPv6 loopback để thử local. `APP_ORIGIN` tiếp tục dùng cho CORS; khi đổi domain phải cấu hình cả hai. Thiếu hoặc sai `APP_URL` làm startup SMTP dừng trước khi kết nối. `APP_TIME_ZONE` là múi giờ IANA hợp lệ, mặc định `Asia/Ho_Chi_Minh`; thư hiển thị rõ múi giờ bên cạnh thời gian.

Tám sự kiện đang hỗ trợ gồm yêu cầu mới/được duyệt/bị từ chối/hoàn tất/cần đối soát và tài sản sắp hết hạn/đã hết hạn/thu hồi. HTML và plain text chỉ có tên người nhận, sự kiện, mã tham chiếu và thời gian; không sao chép lý do yêu cầu, private key hoặc token phiên. Link mở chi tiết yêu cầu/tài sản và vẫn phải qua đăng nhập, kiểm quyền của ứng dụng. Dữ liệu cũ thiếu mã hợp lệ mở trung tâm thông báo; thiếu thời gian thì bỏ dòng thời gian thay vì hiển thị thời điểm giả.

Worker ghi thông báo kết quả cùng transaction trạng thái/audit. Nếu ghi thông báo hoàn tất lỗi sau khi provider đã trả kết quả, asset/hoàn tất rollback và receipt được giữ để đối soát. Không tự gọi lại provider. Mỗi kết quả và mỗi kênh có một deduplication key. Chuẩn bị nội dung lỗi trước khi gọi SMTP là kết quả chắc chắn chưa gửi: trạng thái FAILED với thông báo chuẩn; không xếp vào kết quả SMTP chưa rõ.

Trước khi gửi thư yêu cầu mới, worker kiểm lại tài khoản, đơn vị, vai trò Approver và phạm vi của yêu cầu. Nếu Approver đã mất phạm vi, thư chờ chuyển `FAILED` mà không gọi SMTP. Trạng thái của thông báo trong ứng dụng được quản lý riêng.

Mẫu mời và đặt lại mật khẩu dùng link riêng có hạn dùng. Xem mục Email mời và phục hồi tài khoản để bật luồng T07.

`node tools/test-real-email-delivery.cjs <report-stack-test.json>` kiểm DB/worker và SMTP loopback trong DB riêng. `node tools/preview-email-templates.cjs <report-email.json> <node_modules-co-playwright>` tạo HTML/plain-text và ảnh desktop/mobile bằng dữ liệu giả. Đây không thay bằng chứng Inbox, Spam, email client thật hoặc nghiệm thu T25. [Bằng chứng T24](T24_EMAIL_TEMPLATES_2026-11-06.md).

## Trạng thái và xử lý sự cố

| Trạng thái | Ý nghĩa | Hành động |
| --- | --- | --- |
| `PENDING` | Chờ gửi hoặc SMTP từ chối tạm thời rõ ràng (4xx) | Worker tự thử lại, tối đa 5 lần. |
| `SENDING` | Một worker đã nhận việc | Nếu quá 10 phút, worker chuyển sang cần đối soát thay vì gửi lại. |
| `SENT` | SMTP đã chấp nhận và database đã ghi nhận | Vẫn cần kiểm tra hộp thư nếu nghiệm thu gửi thật. |
| `FAILED` | SMTP từ chối vĩnh viễn (5xx) hoặc hết lượt thử | Kiểm tra cấu hình/địa chỉ và nguyên nhân trước khi lập yêu cầu gửi lại. |
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

Không đổi trạng thái bằng SQL khi chưa xác minh với nhà cung cấp và người nhận. API/UI xử lý có kiểm toán cho quyết định gửi lại vẫn nằm trong backlog T23/T28. Dù dùng Message-ID ổn định và deduplication trong database, SMTP không bảo đảm gửi chính xác một lần trong mọi tình huống; trường hợp kết quả chưa rõ phải được đối soát.

Security Admin có thể xem danh sách chỉ đọc tại mục **Email cần xử lý** trên dashboard. API `GET /api/v1/notifications/delivery-issues` chỉ trả metadata vận hành cần thiết (không trả thông báo lỗi SMTP thô) và yêu cầu quyền Admin.
## Email mời và phục hồi tài khoản

Để bật T07, chạy migration `012_account_actions`, áp lại quyền runtime, rồi cấu hình `SMTP_ENABLED=true`, `APP_URL`, `ACCOUNT_ACTIONS_ENABLED=true` và `ACCOUNT_ACTION_KEY`. Dùng một khóa ngẫu nhiên 32 byte ở dạng 64 ký tự hex và lưu riêng trong secret của môi trường. Mọi instance API và email worker của cùng môi trường cần dùng chung khóa. Với môi trường thật, đặt `APP_URL` về origin HTTPS người dùng truy cập.

Security Admin tạo tài khoản ở trạng thái chờ chấp nhận lời mời. Link có hạn 24 giờ. Khi gửi lại, hệ thống thu hồi link cũ và giới hạn tối thiểu một phút giữa hai lượt cho cùng phiên bản tài khoản. Người dùng tự yêu cầu reset bằng email, với thời hạn 30 phút. API trả cùng thông báo cho email đủ điều kiện và email lạ. Yêu cầu lặp trong vòng hai phút dùng lượt đã cấp, với giới hạn ba yêu cầu mỗi địa chỉ trong 15 phút và giới hạn chung 120 yêu cầu mỗi phút. Cổng giới hạn chung chia sẻ giữa các instance.

Mã link nằm trong phần fragment. Trang mở link xóa fragment khỏi thanh địa chỉ và giữ mã trong bộ nhớ đến khi gửi biểu mẫu. Đổi mật khẩu thành công thu hồi phiên cũ và đưa thư báo thay đổi vào hàng đợi. Khi đổi `ACCOUNT_ACTION_KEY`, link chưa sử dụng mất hiệu lực. Sau khi đồng bộ khóa mới trên các instance, Admin có thể phát hành lại lời mời và người dùng có thể yêu cầu reset mới.
