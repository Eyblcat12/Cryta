# X04 — Xuất báo cáo theo phạm vi tra cứu

[Mẫu tương tác](../tools/design-previews/report-exports/index.html) · [Desktop](../tools/design-previews/report-exports/desktop.png) · [Mobile](../tools/design-previews/report-exports/mobile.png)

Nút **Xuất báo cáo** nằm trên danh sách Tài sản, Yêu cầu hoặc Audit Log. Hộp xác nhận hiển thị bộ lọc hiện tại, tổng kết quả, phạm vi và múi giờ. Người dùng chọn định dạng rồi tiếp tục làm việc khi tác vụ chạy nền. Tác vụ hiển thị các trạng thái đang tạo, sẵn sàng, thất bại, đã hủy và hết hạn. Mẫu Chromium đạt 20 ca trên desktop/mobile, gồm mở bằng bàn phím, Escape trả focus, đổi định dạng, vượt giới hạn, hủy, thử lại và reflow.

| Báo cáo | Phạm vi | Cột dự kiến |
| --- | --- | --- |
| Tài sản | Chủ sở hữu, Approver đúng phạm vi, Security Admin | Mã, loại, đơn vị, trạng thái, ngày hiệu lực và hết hạn |
| Yêu cầu | Người tạo, Approver đúng phạm vi, Security Admin | Mã, loại, đơn vị, trạng thái, mức khẩn, thời điểm gửi và hoàn tất |
| Audit Log | Security Admin | Mã sự kiện, hành động, loại đối tượng, kết quả và thời điểm |

Mẫu dùng giới hạn 10.000 dòng CSV, 1.000 dòng PDF và thời hạn tải một giờ sau khi tệp sẵn sàng. Múi giờ lấy từ cấu hình ứng dụng. Hệ thống đề nghị thu hẹp bộ lọc khi vượt giới hạn và giữ nguyên bộ lọc lúc người dùng tạo tác vụ. Quyền và phạm vi được xác minh ở máy chủ lúc tạo, lúc xử lý và lúc tải.

Báo cáo dùng các cột công bố trong bảng. Tham chiếu provider, token, tham số yêu cầu, nội dung lý do và metadata audit nằm ngoài báo cáo. CSV trung hòa ô có thể trở thành công thức trong bảng tính. PDF giữ dấu tiếng Việt, lặp tiêu đề bảng qua các trang và hiển thị tổng số dòng. Audit ghi người tạo, loại báo cáo, phạm vi, số dòng và lần tải.
