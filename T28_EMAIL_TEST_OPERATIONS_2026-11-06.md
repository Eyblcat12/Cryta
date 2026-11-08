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

Bản xem trước kiểm Chromium ở 1440 px sáng và 390 px tối, gồm mở bằng bàn phím, Escape, thử tải lại và giữ mã phiếu khi có xung đột. Chủ dự án đã duyệt luồng ghi nhận SMTP đã chấp nhận hoặc xác minh chưa chấp nhận với mã phiếu đối soát. [Bản xem trước](tools/design-previews/email-recovery/index.html)

Backend đã có API ghi kết quả. API kiểm lại quyền Admin, khóa bản ghi EMAIL cần đối soát, so số lượt với chi tiết đã đọc và ghi audit cùng giao dịch. Cả hai kết quả đều cần mã phiếu. Kết quả đã chấp nhận giữ thời điểm UTC từ bằng chứng. Hai nhóm Nginx/PostgreSQL đạt, gồm 201 và 409 khi hai Admin ghi cùng lúc, lỗi dữ liệu đầu vào, cùng rollback trạng thái khi audit bị từ chối. Luồng này không đưa thư về hàng đợi gửi. [Hợp đồng vận hành](EMAIL_OPERATIONS.md#trạng-thái-và-xử-lý-sự-cố) · [Kết quả](tools/test-artifacts/integration/crypta-t30-test-bd79e0cae6fd/real-chromium-1794088854959/results.json)

CI `969a297` phát hiện ca đối soát để lại một Admin thử, làm sai giả định của ca bảo vệ Admin cuối. Đã chuyển sang tài khoản Admin thứ hai có sẵn. Hai nhóm T28 và ca bảo vệ Admin cuối chạy lần lượt trên cùng database cách ly đều đạt. [CI phát hiện lỗi](https://github.com/Eyblcat12/Cryta/actions/runs/42418641386) · [T28](tools/test-artifacts/integration/crypta-t30-test-d90e8bf3b2b7/real-chromium-1794089935188/results.json) · [Admin cuối](tools/test-artifacts/integration/crypta-t30-test-d90e8bf3b2b7/real-chromium-1794089945779/results.json)

## Tích hợp giao diện đã duyệt

Trang Vận hành email tải theo nhu cầu và hiển thị bảng desktop, danh sách mobile cùng hộp chi tiết. Email đã thất bại mở ở chế độ chỉ xem. Email đang chờ đối soát có biểu mẫu nhập kết quả, thời điểm UTC nếu SMTP đã chấp nhận và mã phiếu. Khi có xung đột hoặc mất phản hồi, giao diện giữ dữ liệu đã nhập và chờ đối chiếu trước khi gửi thao tác ghi tiếp. Sau xác nhận, danh sách email, tổng quan và nhật ký được làm mới. [Hướng dẫn vận hành](EMAIL_OPERATIONS.md#trạng-thái-và-xử-lý-sự-cố)

Build, lint và 148/148 ca frontend đạt. Edge đạt 5/5 ca với API mô phỏng, gồm bảng desktop, danh sách mobile, phản hồi chậm, xác nhận bị mất và kiểm trạng thái đã ghi. Chromium qua Nginx/PostgreSQL đạt 4/4 nhóm, gồm hai kết quả đối soát ở 1440 px sáng và 390 px tối, mã phiếu trong audit, không tăng lượt gửi sau ghi nhận, xung đột giữ biểu mẫu, thử tải lại và focus bằng bàn phím. Lượt cuối giữ hộp thoại trong khung nhìn ở cả hai giao diện và dọn stack sau khi chạy. [Edge](tools/test-artifacts/t28-email-ui-viewport-final/results-filtered.json) · [Chromium và PostgreSQL](tools/test-artifacts/integration/crypta-t30-test-71fd44e5222f/real-chromium-1794126532037/results.json) · [Desktop](tools/test-artifacts/integration/crypta-t30-test-71fd44e5222f/real-chromium-1794126532037/t28-email-delivery-1440-light.png) · [Mobile](tools/test-artifacts/integration/crypta-t30-test-71fd44e5222f/real-chromium-1794126532037/t28-email-delivery-390-dark.png)

Lượt tích hợp đầu dừng ở dữ liệu thử thiếu thời điểm thất bại của bản ghi `FAILED`. Lượt tiếp theo đã qua kiểm chức năng, nhưng kiểm ảnh thấy quy tắc định vị của giao diện tối ảnh hưởng hộp thoại. Lượt cuối bổ sung phép kiểm biên khung nhìn để phát hiện lại lỗi bố cục. [Ca đầu](tools/test-artifacts/integration/crypta-t30-test-4da1821ac19c/real-chromium-1794126349669/results.json) · [Ảnh trước sửa](tools/test-artifacts/integration/crypta-t30-test-c07c48508027/real-chromium-1794126412413/t28-email-delivery-390-dark.png)

CI của commit T28 đạt đủ năm job. Lượt T29 sau đó có hai ca T28 đo chiều cao trong lúc hộp thoại biến đổi kích thước khi mở. Bài kiểm chuyển sang đo chiều cao bố cục, độc lập với hiệu ứng. Bộ Chromium cục bộ chạy lại đủ 52/52 nhóm. [CI T28](https://github.com/Eyblcat12/Cryta/actions/runs/42463212257) · [CI phát hiện lỗi đo](https://github.com/Eyblcat12/Cryta/actions/runs/42463775396) · [Chromium 52/52](tools/test-artifacts/integration/crypta-t30-test-68e2f1a21411/real-chromium-1794127699163/results.json)
