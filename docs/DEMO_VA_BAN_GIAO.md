# Demo và bàn giao Crypta

[Mở video demo](media/crypta-demo.webm) dài khoảng 48 giây, độ phân giải 1440 × 900. Video có chú thích và dùng dữ liệu mẫu trong PostgreSQL cách ly. Có thể dừng ở từng chương để đối chiếu với hướng dẫn. Provider chạy chế độ MOCK và SMTP tắt trong lần quay này.

| Mốc gần đúng | Chương | Thao tác và kết quả |
| --- | --- | --- |
| 00:02 | UC01 | User gửi yêu cầu cấp khóa mới, worker hoàn tất sau quyết định. |
| 00:04 | UC05 | Approver tìm yêu cầu trong hàng chờ của đơn vị được giao và phê duyệt. |
| 00:09 | UC02 | User gia hạn, Approver duyệt, tài sản cũ chuyển **Đã thay thế** và tài sản mới được tạo. |
| 00:16 | UC03 | User xác nhận thu hồi khẩn, Approver duyệt, tài sản chuyển **Đã thu hồi**. |
| 00:26 | UC04 | Approver xem danh mục trong scope và gặp lỗi quyền khi mở tài sản đơn vị khác. |
| 00:29 | UC06 | Approver từ chối có lý do. User mở lại và đọc quyết định. |
| 00:35 | UC07 | Admin xem danh mục tài sản toàn hệ thống. |
| 00:36 | UC08 | Admin phát hành phiên bản kế tiếp của policy RSA. |
| 00:39 | UC09 | Admin lọc Audit Log để xem quyết định từ chối. |
| 00:41 | UC10 | Admin cấp vai trò Approver và scope Tài chính cho tài khoản mẫu. |
| 00:43 | UC11 | Cảnh báo tài sản sắp hết hạn xuất hiện trong thông báo của User. |
| 00:45 | UC12 | User mở tài sản đã được bộ quét chuyển sang **Đã hết hạn**. |

Video minh họa thao tác chính của 12 UC. Phiên được tạo qua API trước mỗi lần đổi vai trò để thông tin đăng nhập nằm ngoài phần quay. Bộ quay thêm hai tài sản giả ở sát mốc cảnh báo và đã quá hạn, rồi gọi `ExpiryScanService.run()` để trình diễn ngay. Lịch chạy mỗi giờ, SMTP, provider sandbox và các nhánh lỗi còn lại có kịch bản kiểm riêng. [Kịch bản UAT](NGHIEM_THU_UAT.md) · [Kiểm cảnh báo và restart](../T27_HARDENING_2026-11-06.md)

## Dựng lại buổi demo

1. Từ thư mục dự án, chạy `tools/test-isolated-stack.ps1 -KeepStack`. Ghi lại đường dẫn `report.json` mà script in ra. Stack cần qua smoke và giữ volume mới có seed.
2. Chạy `node tools/record-crypta-demo.cjs <report.json> <node_modules-co-playwright>`. Máy cần Chrome và Playwright. Bộ quay kiểm project, database, volume, cổng loopback, provider MOCK và SMTP tắt trước khi tạo dữ liệu.
3. Kết quả nằm trong `demo-<timestamp>` cạnh report, gồm video, mốc chương và SHA-256. Mỗi lượt hoàn chỉnh cần dữ liệu mới vì demo tạo yêu cầu, tài sản, phiên bản policy và thay quyền tài khoản mẫu.
4. Phát video để kiểm và dọn bằng `tools/cleanup-isolated-stack.ps1 -ReportPath <report.json>` khi đã lưu kết quả. [Bộ quay](../tools/record-crypta-demo.cjs) · [Stack kiểm thử](../tools/testing/README.md)

SHA-256 của video bàn giao là `54a1dbfd08e73204db209701e83eb9b1f022f39f8ba51013caff4863fa8d4a7c`. Video đã phát đến cuối trong Chrome, có đủ 12 mốc và được kiểm các khung hình từng chương. Manifest kèm thời lượng, hash dữ liệu dựng demo, image đã chạy và mốc chương. [Manifest bàn giao](media/crypta-demo-manifest.json)

## Tài liệu dùng trong buổi bàn giao

| Nội dung | Tài liệu |
| --- | --- |
| Giới thiệu và phạm vi chức năng | [Tổng quan sản phẩm](../03_tong_quan_san_pham.md) |
| Luồng nghiệp vụ, trạng thái và đối soát | [Luồng hoạt động](../01_luong_hoat_dong_he_thong.md) |
| Kiến trúc, container và ranh giới tích hợp | [Sơ đồ hệ thống](../02_so_do_he_thong_tong_quat.md) |
| 19 bảng, 164 cột, 33 khóa ngoại và constraint | [ERD hiện hành](ERD_HIEN_HANH.md), [draw.io](../erd_QuanLyKhoa_HTTT.drawio) |
| Sử dụng theo vai trò và xử lý lỗi | [Hướng dẫn Crypta](HUONG_DAN_CRYPTA.md) |
| Nghiệm thu có ghi lỗi và kiểm lại | [12 kịch bản UAT](NGHIEM_THU_UAT.md) |
| Cài đặt dịch vụ, email, backup, nâng cấp | [Cấu hình](../CAU_HINH_DICH_VU_THAT.md), [email](../EMAIL_OPERATIONS.md), [release](../RELEASE_RUNBOOK.md) |

Tài liệu kiến trúc và ERD đã đối chiếu với schema 017. Cả 20 sơ đồ Mermaid đã render thành công. Trang đầu của draw.io là schema hiện hành, còn trang thiết kế ban đầu được giữ để tham khảo. Khóa, mã hash phiên và token được mô tả theo tên cột và kiểu dữ liệu trong ERD.

## Phân công khi tiếp nhận hệ thống

| Trách nhiệm | Vai trò tiếp nhận | Việc cần xác nhận |
| --- | --- | --- |
| Chấp thuận quy trình và dữ liệu | Chủ dự án hoặc người phụ trách nghiệp vụ | Chạy kịch bản UAT, ghi lỗi và xác nhận phạm vi release. |
| Tài khoản quản trị và cơ cấu đơn vị | Security Admin được chỉ định | Nhận tài khoản qua kênh riêng, thay tài khoản mẫu, kiểm role và scope. |
| Backup, phục hồi, migration và TLS | Người vận hành hạ tầng | Chốt môi trường, lịch backup, nơi lưu ngoài máy và diễn tập phục hồi. |
| Provider và đối soát mật mã | Người phụ trách provider | Chốt sandbox, danh tính dịch vụ, tra cứu operation và quy trình sự cố. |
| SMTP và email không rõ kết quả | Người phụ trách email | Chốt hộp thư thử, kiểm thư đến và đối chiếu Message-ID. |
| Theo dõi và hỗ trợ | Người trực được chỉ định | Nhận cảnh báo vận hành, giữ mã truy vết và chuyển lỗi tới người xử lý. |

Tên người tiếp nhận, thông tin hạ tầng và kênh hỗ trợ vẫn cần điền khi tổ chức buổi bàn giao. T47, T49 và T52 còn bước người nhận tự làm lại quy trình và ghi xác nhận. [Trạng thái các task](../TASK_STATUS_2026-11-05.md)
