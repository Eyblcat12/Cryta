# X02 — Phê duyệt hai cấp theo phiên bản policy

Chủ dự án chọn một Approver khác trong cùng phạm vi cho cấp hai và duyệt [mẫu giao diện](../tools/design-previews/two-stage-approval/index.html). Mẫu cho thấy cấu hình phiên bản policy, tiến độ trong hàng chờ, xác nhận quyết định và lịch sử của người gửi.

| Trạng thái | Quyết định được phép | Kết quả |
| --- | --- | --- |
| Chờ cấp 1 | Approver đúng phạm vi, khác người gửi | Duyệt cấp 1 giữ yêu cầu ở `PENDING`. Từ chối kết thúc yêu cầu và lưu lý do. |
| Chờ cấp 2 | Approver đúng phạm vi, khác người gửi và người đã duyệt cấp 1 | Duyệt cấp 2 đưa yêu cầu sang `APPROVED`. Từ chối giữ lịch sử cấp 1 và lưu lý do. |
| Quá hạn | Người gửi có thể hủy | Lịch sử được giữ. Người gửi có thể tạo yêu cầu mới. |
| Hủy trước khi đủ cấp | Người gửi | Yêu cầu sang `CANCELLED` và không còn trong hàng chờ quyết định. |

Mẫu đề xuất thời hạn tính từ lúc gửi, mặc định 48 giờ và cấu hình từ 1 đến 168 giờ trên policy hai cấp. Phiên bản hiện có giữ một cấp. Việc phát hành phiên bản mới không đổi yêu cầu đang gắn với phiên bản trước.

API khóa hàng yêu cầu và kiểm `version` trước khi ghi quyết định. Migration 020 giữ quyết định cũ ở cấp một và giới hạn mỗi yêu cầu một quyết định cho mỗi cấp và mỗi người. Trigger chặn chuyển sang trạng thái xử lý nếu policy hai cấp còn thiếu một quyết định duyệt. Worker chỉ nhận yêu cầu `APPROVED`. Lượt duyệt cấp một cập nhật tiến độ, audit và thông báo cho người đủ quyền duyệt tiếp. Hàng chờ email kiểm lại quyền và thời hạn khi gửi thông báo cấp hai.

Ca nghiệm thu cần có hai Approver đúng phạm vi, một người ngoài phạm vi và một người gửi. Kiểm hai quyết định đồng thời cùng phiên bản, từ chối cấp hai, quá hạn, hủy sau cấp một và policy cũ một cấp. Đối chiếu log, thông báo, bản ghi provider và tài sản trước và sau khi đủ cấp.

Lượt GitHub trên `204c735` xác nhận ca X02 đạt. Hai quyết định cùng phiên bản trả 201 và 409. PostgreSQL chặn cập nhật trạng thái trước cấp hai. Worker chỉ ghi một lần xử lý sau khi Approver thứ hai duyệt trên mobile. Từ chối, hủy và quá hạn không tạo tác vụ provider. Ba ca T49 chọn nhầm policy hai cấp được tạo trong ca X02. Bộ kiểm đã bổ sung ngừng áp dụng policy thử trong `finally` để giữ dữ liệu T49 độc lập. [Lượt CI đầu](https://github.com/Eyblcat12/Cryta/actions/runs/42346867675)

GitHub Actions trên `dcfff1d` đạt cả năm job và 165/165 nhóm tích hợp, gồm 40/40 Chromium và 4/4 MFA. Ca X02 cùng ba ca T49 đều đạt. Cả hai stack đã được dọn. [Lượt CI sau sửa](https://github.com/Eyblcat12/Cryta/actions/runs/42347634913)

Ngày 08/11, CI trên `e917cd3` đạt 44/45 nhóm Chromium. Ca X02 hết thời gian chờ lịch sử duyệt cấp hai. Lượt đối chứng giữ callback focus đến lúc nút Xác nhận đã có focus và tái hiện callback chuyển focus về nút Đóng. Hộp thoại nay giữ focus khi người dùng đã vào bên trong. Bộ kiểm yêu cầu Enter tạo phản hồi HTTP 201 và lịch sử hiển thị cấp hai. [CI](https://github.com/Eyblcat12/Cryta/actions/runs/42399400266) · [Đối chứng](../tools/test-artifacts/integration/crypta-t30-test-ac15e0c4e51b/real-chromium-1794075310914/results.json)

Bản sửa đạt 45/45 nhóm trên Chromium qua Nginx/PostgreSQL. Ca X02 kiểm focus không đổi, phản hồi 201, đủ hai Approver và đúng một lần chạy worker. [Kết quả bản sửa](../tools/test-artifacts/integration/crypta-t30-test-caf51f22a6a3/real-chromium-1794075359542/results.json)
