# Ghi chú bảo vệ đồ án Crypta

Bộ slide có 14 trang và lời dẫn trong speaker notes. Thời gian gợi ý khoảng 10–12 phút, cần tự đo khi luyện trên máy dùng để bảo vệ. [Slide chỉnh sửa được](media/crypta-bao-ve.pptx) · [Báo cáo](BAO_CAO_DO_AN.md) · [Video dự phòng](media/crypta-demo.webm).

## Lời dẫn theo trang

| Trang | Nội dung trình bày | Điểm cần làm rõ |
| --- | --- | --- |
| 1 | Giới thiệu Crypta, bài toán quản lý vòng đời khóa và chứng thư | Đây là lớp quản lý metadata và workflow, demo bằng MOCK |
| 2 | Rủi ro theo dõi thủ công, mục tiêu đủ 12 use case | Không lưu private key tài sản trong ứng dụng |
| 3 | Ba vai trò và phân phạm vi | API chặn tự duyệt, duyệt chéo scope và Admin duyệt nghiệp vụ |
| 4 | Trình duyệt, Nginx, NestJS, PostgreSQL và worker | Worker nằm trong backend, dữ liệu và queue nằm trong PostgreSQL |
| 5 | Nhóm dữ liệu và catalog hiện hành | 28 bảng, 234 cột, 40 khóa ngoại sau migration 027 |
| 6 | Nháp, gửi, duyệt, xử lý và hoàn tất | Policy hai cấp giữ PENDING sau cấp một, từ chối kết thúc duyệt |
| 7 | User đọc quyết định từ chối | Tên người quyết định, lý do và timeline khớp server |
| 8 | Approver xem tài sản trong đơn vị | Phân trang và lọc scope tại server, link trực tiếp vẫn kiểm quyền |
| 9 | Provider đã nhận lệnh nhưng mất phản hồi | Ledger và biên nhận, không tự retry khi chưa biết kết quả |
| 10 | Bảo vệ phiên và dữ liệu | Transaction/version, thu hồi phiên, redaction và audit |
| 11 | Sáu chức năng nâng cao | Nêu trạng thái thực tế của từng mục, chỉ demo thêm nếu còn thời gian |
| 12 | Kiểm thử và số liệu | Phân biệt test DB thật với fixture, số ca khác tỷ lệ coverage |
| 13 | Thực hiện kịch bản trực tiếp | Chuyển vai trò theo thứ tự, mở video khi môi trường gặp sự cố |
| 14 | Kết quả và giới hạn | Provider MOCK, dịch vụ thật và trợ năng còn điều kiện xác nhận |

## Demo trực tiếp

Chuẩn bị Docker hoạt động và chạy launcher. Dùng một cửa sổ, đăng xuất trước mỗi lần đổi tài khoản giữa ba vai trò. Nếu muốn dùng đồng thời, dùng các trình duyệt hoặc profile độc lập; các cửa sổ cùng profile dùng chung cookie và phiên đăng nhập. Tạo yêu cầu với lý do dễ nhận biết như `Demo bảo vệ cấp khóa`. Tránh dựa vào ID cố định vì mỗi lượt tạo dữ liệu khác nhau. Chọn policy một cấp cho chuỗi chính để dễ theo dõi, giải thích hai cấp ở phần mở rộng.

1. User mở **Tạo yêu cầu**, chọn cấp khóa, nhập lý do và gửi. Nếu trình diễn nháp, lưu rồi mở lại và gửi trước khi chuyển vai trò.
2. Approver lọc theo lý do trong hàng chờ đúng đơn vị, mở chi tiết và duyệt. User tải lại đến khi yêu cầu hoàn tất, mở tài sản vừa tạo.
3. User gửi gia hạn tài sản đó, Approver duyệt. Mở lịch sử tài sản cũ và mới để chỉ liên kết trước/sau và trạng thái Đã thay thế.
4. User tạo thu hồi cho tài sản mới, đọc xác nhận, Approver duyệt. Trở lại chi tiết để kiểm Đã thu hồi.
5. Tạo một yêu cầu khác, Approver từ chối với lý do. User mở lại, chỉ tên người quyết định, lý do và timeline dừng ở Đã từ chối.
6. Admin mở tài sản toàn hệ thống, policy, tài khoản/scope và Audit Log. Giải thích Admin quản trị nhưng không có quyền phê duyệt nghiệp vụ.
7. Dùng chương UC11/UC12 trong video để trình diễn mốc hết hạn đã chuẩn bị. Nêu rõ có hai tài sản giả và lệnh gọi quét chủ động. Lịch mỗi giờ đã có bài kiểm riêng, không thay lịch hệ thống trong buổi bảo vệ.

Chạy lại trên bộ dữ liệu cách ly mới nếu muốn có cùng thứ tự ban đầu. Hướng dẫn [dựng và quay demo](DEMO_VA_BAN_GIAO.md) có kiểm đúng stack trước khi ghi dữ liệu. Không dùng script test trên database chứa dữ liệu cần giữ.

## Câu hỏi thường gặp

**Hệ thống có tự tạo thuật toán mật mã hay thay CA không?** Crypta quản lý workflow và metadata. Bản chính dùng MOCK. Bridge OpenBao đã thử khóa ký RSA/ECDSA, còn CA công cộng cần tích hợp và đối chiếu riêng.

**Tại sao Admin không được duyệt?** Quyền quản trị tài khoản/policy tách khỏi quyết định nghiệp vụ. Server kiểm vai trò Admin trong tập quyền, nên đổi role hiển thị không vượt quy tắc này.

**Hai người duyệt cùng lúc thì sao?** Service khóa bản ghi và kiểm version/trạng thái. Constraint bảo vệ quyết định theo cấp. Một lệnh hợp lệ thắng, lệnh lỗi thời nhận conflict và phải đọc lại. Với policy hai cấp, cấp hai phải do Approver khác trong cùng scope.

**Timeout rồi có thử lại được không?** Cần phân biệt server chưa thực hiện với server đã thực hiện nhưng phản hồi mất. UI có bước đọc lại. Worker có ledger, operation ID và đối soát provider. Không suy từ timeout ra quyền gửi lại.

**Audit có chống quản trị DB sửa không?** Quyền runtime và trigger chặn thao tác thông thường. X05 bổ sung checkpoint ký Ed25519 để phát hiện thay đổi so với mốc đã lưu độc lập. Nếu cùng một người kiểm soát cả DB, khóa ký và kho checkpoint thì mức bảo vệ đó không còn độc lập.

**MFA và SSO đã làm chưa?** Có TOTP sáu số, mười mã khôi phục dùng một lần, OIDC với Keycloak cách ly và nối MFA cho vai trò nhạy cảm. Chúng cần cấu hình riêng, không mặc định bật tất cả trong demo cơ bản.

**197/197 có nghĩa coverage 100% không?** Đây là số ca giao diện dùng API fixture đã đạt. 66/66 là bộ Chromium chạy qua Nginx/PostgreSQL, 18/18 là bộ nháp/mất phản hồi. Chúng không đo tỷ lệ bao phủ toàn bộ mã nguồn.

**Email đã gửi thật chưa?** Luồng SMTP đã kiểm relay và STARTTLS cách ly. Chưa xác nhận thư qua Internet đến hộp thư bên ngoài. Demo trên lớp để SMTP tắt và thể hiện thông báo trong ứng dụng.

**Có thể dùng dữ liệu thật ngay không?** Cần cấu hình provider/CA, SMTP, HTTPS, secret, backup, người vận hành và nghiệm thu trên môi trường đích theo [cổng gốc](CONG_NGHIEM_THU_RELEASE.md). Bản nộp hiện tại được mô tả đúng là đồ án chạy local với metadata mô phỏng.

## Trước khi nộp

- Bổ sung bìa trường, môn học, tên thành viên và giảng viên theo mẫu của lớp.
- Tự luyện toàn bài hai lần, ghi thời gian và điểm vướng, kiểm lại audio/video trên máy trình bày.
- Kiểm Docker và cổng 8080, chuẩn bị bản video phát ngoại tuyến.
- Ghi SHA commit dùng để bảo vệ và link PR vào biên bản của nhóm.
- Loại `.env`, token và thông tin cá nhân khỏi tệp nộp.

Các mục này do người nộp xác nhận, không đánh dấu thay bằng kết quả test tự động.
