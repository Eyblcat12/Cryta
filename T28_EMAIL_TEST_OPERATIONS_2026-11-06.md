# T28 — Gửi thư thử có giới hạn và audit, 06/11/2026

Đã sửa thống kê `/notifications/status` để chỉ đếm kênh EMAIL. Thông báo IN_APP đã phát không còn làm tăng tổng email SENT. Danh sách lỗi và metrics queue khác đã lọc kênh EMAIL từ trước.

API gửi thư thử hiện đi qua `EmailTestService`. Admin đang hoạt động, đúng token version và đơn vị hoạt động được kiểm lại trong transaction sau khi chờ khóa. Khóa advisory dùng chung DB bảo vệ giới hạn một lượt/Admin/phút và năm lượt/toàn hệ thống/phút. Ghi `EMAIL_TEST_REQUESTED` cùng transaction giữ lượt, rồi commit và nhả kết nối trước khi gọi SMTP. Audit lỗi trước commit thì không gọi SMTP. Không có migration hoặc quyền DB mới; dùng quyền SELECT/INSERT audit và khóa dòng user/department đã có.

Mỗi lượt có operation UUID và Message-ID `<email-test-UUID@domain-gửi>`. Audit chỉ lưu operation ID, domain nhận và correlation; không lưu địa chỉ đầy đủ, nội dung thư hay thông báo lỗi SMTP thô. Kết quả có ba loại: SMTP chấp nhận đúng người nhận (`EMAIL_TEST_ACCEPTED`), từ chối rõ ràng (`EMAIL_TEST_REJECTED`, chỉ lưu mã số) và kết quả chưa rõ (`EMAIL_TEST_OUTCOME_UNKNOWN`). Chỉ trả `sent:true` sau bằng chứng chấp nhận đúng địa chỉ. Mất kết nối sau DATA hoặc thiếu bằng chứng không được gọi là thành công. Không tự thử lại.

SMTP đã nhận nhưng ghi audit kết quả lỗi trả `SMTP_TEST_ACKNOWLEDGEMENT_FAILED` và log an toàn với operation/correlation. Audit giữ lượt vẫn còn để tra cứu. Lượt bị từ chối hay chưa rõ cũng tiêu thụ ngân sách. Giới hạn tần suất không phải idempotency hoặc bảo đảm gửi một lần; khi kết quả chưa rõ phải kiểm tra hộp thư/Message-ID trước khi quyết định gửi lại. SMTP chấp nhận không chứng minh Inbox đã nhận.

## Kiểm chứng

| Kiểm tra | Bằng chứng |
| --- | --- |
| Backend unit | [367/367](tools/test-artifacts/email-test-operations-20261106/backend-unit.json), gồm 23 ca mới cho giới hạn, quyền sau chờ khóa, rollback intent, không lộ SMTP diagnostic, uncertain/ack failure và acceptance đúng recipient. |
| Backend build | Đạt. |
| SMTP protocol cục bộ | Đạt [4/4](tools/test-artifacts/email-test-operations-20261106/smtp-protocol.json) sau khi bộ duyệt cấp quyền TCP loopback. Dùng Nodemailer thật, SMTP server trong cùng process và DB mô phỏng. |
| Bộ kiểm riêng | `npm --prefix backend run test:smtp`; test nằm ở `email-test-smtp.integration.ts`, config riêng vì cần quyền TCP loopback. Đã nối bước bắt buộc vào CI backend; CI remote chưa chạy. |
| PostgreSQL/API/SMTP | Cả sáu nhóm T28 đạt trong [runtime LOGIN 48/48](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/runtime-privileges-70488ce7aad4/results.json). |
| Frontend | Không đổi trong lượt này. Hash source/build được đối chiếu với snapshot T21/T18 đã đạt FE147/147 và hai build; không gọi là chạy lại. |

Sáu nhóm DB mới kiểm lỗi audit trước SMTP, hai gửi đồng thời chỉ có một DATA, audit kết quả lỗi sau DATA không tự gửi lại, 550 so với mất ACK, giới hạn toàn cục giữa nhiều Admin và tổng email không lẫn IN_APP. Chỉ chạy trên DB cấp riêng và SMTP loopback của runner; không gửi tới dịch vụ bên ngoài. Khóa/tần suất qua nhiều API process và diễn tập triển khai thực vẫn cần nghiệm thu.

## Phần còn mở

T28 còn trang chi tiết lần thử, xử lý từng email lỗi có audit, backlog/worker heartbeat trên UI và xác nhận quy trình vận hành. T23 còn toàn ma trận timeout/restart/giới hạn thử. T25 còn chọn SMTP, domain, hộp thư và nghiệm thu nhận thư thật. Giao diện và luồng mới cho các mục đó cần prototype và duyệt theo skill UI/UX.

Lượt CI remote và nghiệm thu hộp thư bên ngoài vẫn còn mở.

[Service](backend/src/notifications/email-test.service.ts), [unit](backend/test/email-test.spec.ts), [SMTP protocol](backend/test/email-test-smtp.integration.ts), [runner T28](tools/testing/email-test-operations-runner.cjs), [snapshot nguồn/build](tools/test-artifacts/email-test-operations-20261106/source-snapshot.json).

## Lượt 08/11/2026

API chi tiết lần gửi trả mốc tạo, nhận việc, gửi và thất bại, mã đối chiếu Message-ID cùng nhóm chẩn đoán đã lọc. Ca API qua Nginx/PostgreSQL xác nhận chỉ Security Admin có quyền đọc, bản ghi IN_APP bị loại, phản hồi có `Cache-Control: no-store` và lỗi SMTP thô được ẩn. [Kết quả](tools/test-artifacts/integration/crypta-t30-test-23338ffb1a7d/real-chromium-1794088525532/results.json)

Bản xem trước kiểm Chromium ở 1440 px sáng và 390 px tối, gồm mở bằng bàn phím, Escape, thử tải lại và giữ mã phiếu khi có xung đột. Luồng đề xuất ghi nhận SMTP đã chấp nhận hoặc xác minh chưa chấp nhận, có mã phiếu đối soát. Mẫu đang chờ duyệt trước khi tích hợp vào giao diện ứng dụng. [Bản xem trước](tools/design-previews/email-recovery/index.html)
