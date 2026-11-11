# Demo và bàn giao Crypta

Bản đồ án trên trường có [báo cáo kỹ thuật](BAO_CAO_DO_AN.md), [slide 14 trang](media/crypta-bao-ve.pptx), [ghi chú bảo vệ](THUYET_TRINH.md) và [phạm vi bàn giao](DO_AN.md). Video dưới đây dùng để xem nhanh hoặc dự phòng khi demo trực tiếp.

[Mở video demo](media/crypta-demo.webm) quay ngày 11/11/2026, dài khoảng 57 giây, độ phân giải 1440 × 900. Video có chú thích và dùng dữ liệu mẫu trong PostgreSQL cách ly với schema 027. Có thể dừng ở từng chương để đối chiếu với hướng dẫn. Provider chạy chế độ MOCK và SMTP tắt trong lần quay này.

| Mốc gần đúng | Chương | Thao tác và kết quả |
| --- | --- | --- |
| 00:02 | UC01 | User gửi yêu cầu cấp khóa mới, worker hoàn tất sau quyết định. |
| 00:04 | UC05 | Approver tìm yêu cầu trong hàng chờ của đơn vị được giao và phê duyệt. |
| 00:11 | UC02 | User gia hạn, Approver duyệt, tài sản cũ chuyển **Đã thay thế** và tài sản mới được tạo. |
| 00:21 | UC03 | User xác nhận thu hồi khẩn, Approver duyệt, tài sản chuyển **Đã thu hồi**. |
| 00:32 | UC04 | Approver xem danh mục trong scope và gặp lỗi quyền khi mở tài sản đơn vị khác. |
| 00:35 | UC06 | Approver từ chối có lý do. User mở lại và đọc quyết định. |
| 00:42 | UC07 | Admin xem danh mục tài sản toàn hệ thống. |
| 00:45 | UC08 | Admin phát hành phiên bản kế tiếp của policy RSA. |
| 00:49 | UC09 | Admin lọc Audit Log để xem quyết định từ chối. |
| 00:50 | UC10 | Admin cấp vai trò Approver và scope Tài chính cho tài khoản mẫu. |
| 00:52 | UC11 | Cảnh báo tài sản sắp hết hạn xuất hiện trong thông báo của User. |
| 00:54 | UC12 | User mở tài sản đã được bộ quét chuyển sang **Đã hết hạn**. |

Video minh họa thao tác chính của 12 UC. Phiên được tạo qua API trước mỗi lần đổi vai trò để thông tin đăng nhập nằm ngoài phần quay. Bộ quay thêm hai tài sản giả ở sát mốc cảnh báo và đã quá hạn, rồi gọi `ExpiryScanService.run()` để trình diễn ngay. Lịch chạy mỗi giờ, SMTP, provider sandbox và các nhánh lỗi còn lại có kịch bản kiểm riêng. [Kịch bản UAT](NGHIEM_THU_UAT.md) · [Kiểm cảnh báo và restart](../T27_HARDENING_2026-11-06.md)

## Dựng lại buổi demo

1. Từ thư mục dự án, chạy `tools/test-isolated-stack.ps1 -KeepStack`. Ghi lại đường dẫn `report.json` mà script in ra. Stack cần qua smoke và giữ volume mới có seed.
2. Chạy `node tools/record-crypta-demo.cjs <report.json> <node_modules-co-playwright>`. Mặc định dùng Chrome. Có thể thêm `chromium` ở tham số cuối khi bản Chromium của Playwright đã được cài. Bộ quay kiểm project, database, volume, cổng loopback, provider MOCK và SMTP tắt trước khi tạo dữ liệu.
3. Kết quả nằm trong `demo-<timestamp>` cạnh report, gồm video, mốc chương và SHA-256. Mỗi lượt hoàn chỉnh cần dữ liệu mới vì demo tạo yêu cầu, tài sản, phiên bản policy và thay quyền tài khoản mẫu.
4. Phát video để kiểm và dọn bằng `tools/cleanup-isolated-stack.ps1 -ReportPath <report.json>` khi đã lưu kết quả. [Bộ quay](../tools/record-crypta-demo.cjs) · [Stack kiểm thử](../tools/testing/README.md)

SHA-256 của video bàn giao là `065b05163becc4fea76670c2173158ea75d370ce56bdfe764c4ec559b0e357e5`. Video đã phát đến cuối trong Chrome, có đủ 12 mốc và được kiểm các khung hình từng chương. Manifest kèm thời lượng, hash dữ liệu dựng demo, image đã chạy, trình duyệt, mốc chương và kết quả phát video. [Manifest bàn giao](media/crypta-demo-manifest.json)

## Tài liệu dùng trong buổi bàn giao

| Nội dung | Tài liệu |
| --- | --- |
| Giới thiệu và phạm vi chức năng | [Tổng quan sản phẩm](../03_tong_quan_san_pham.md) |
| Luồng nghiệp vụ, trạng thái và đối soát | [Luồng hoạt động](../01_luong_hoat_dong_he_thong.md) |
| Kiến trúc, container và ranh giới tích hợp | [Sơ đồ hệ thống](../02_so_do_he_thong_tong_quat.md) |
| 28 bảng, 234 cột, 40 khóa ngoại và constraint | [ERD hiện hành](ERD_HIEN_HANH.md), [draw.io](../erd_QuanLyKhoa_HTTT.drawio) |
| Sử dụng theo vai trò và xử lý lỗi | [Hướng dẫn Crypta](HUONG_DAN_CRYPTA.md) |
| Nghiệm thu có ghi lỗi và kiểm lại | [12 kịch bản UAT](NGHIEM_THU_UAT.md) |
| Cài đặt dịch vụ, email, backup, nâng cấp | [Cấu hình](../CAU_HINH_DICH_VU_THAT.md), [email](../EMAIL_OPERATIONS.md), [release](../RELEASE_RUNBOOK.md) |

Tài liệu kiến trúc và ERD đã đối chiếu ngày 11/11/2026 với catalog schema 027 của PostgreSQL 17 trên stack cách ly. Cả 20 sơ đồ Mermaid đã render thành công, gồm luồng hai cấp và các thành phần MFA, OIDC, báo cáo, checkpoint audit. Trang đầu của draw.io là schema hiện hành, trang thiết kế ban đầu được giữ để tham khảo. Khóa, mã hash phiên và token được mô tả theo tên cột và kiểu dữ liệu trong ERD. [Catalog được lưu cùng mã nguồn](evidence/schema-027.json) · [Bộ sinh ERD](../tools/update-erd.py) · [Bộ kiểm Mermaid](../tools/check-doc-diagrams.cjs)

## Tái dựng ERD từ catalog

Máy phát triển cần Docker và Python 3. Tạo stack mới bằng `tools/test-isolated-stack.ps1 -KeepStack`, rồi đặt `$schemaReport` thành đường dẫn `report.json` vừa được in. Chạy tại thư mục gốc dự án. Helper xác nhận stack cách ly và container PostgreSQL trước khi đọc tên bảng, cột và constraint. [Câu truy vấn catalog](../tools/schema-catalog.sql) · [Bộ sinh ERD](../tools/update-erd.py)

```powershell
$schemaReport = 'tools/test-artifacts/integration/<project>/report.json'
. ./tools/testing/database-context.ps1
$schemaContext = Get-CryptaDatabaseContext -ProjectDirectory (Get-Location).Path -IsolatedReport $schemaReport
$schemaArguments = @('exec', '-i', $schemaContext.ContainerId, 'psql', '-XqAt',
  '-U', $schemaContext.User, '-d', $schemaContext.Database, '-v', 'ON_ERROR_STOP=1')
$schemaJson = Get-Content -Raw tools/schema-catalog.sql | & docker @schemaArguments
if ($LASTEXITCODE -ne 0) { throw 'Catalog query failed.' }
$schemaSnapshot = Join-Path (Split-Path -Parent $schemaReport) 'schema-027.json'
[IO.File]::WriteAllText($schemaSnapshot, ($schemaJson -join [Environment]::NewLine), (New-Object Text.UTF8Encoding $false))
python tools/update-erd.py $schemaSnapshot
if ($LASTEXITCODE -ne 0) { throw 'ERD generation failed.' }
```

Kiểm trang schema 027, số bảng/cột/khóa ngoại và các liên kết, sau đó dọn stack bằng `tools/cleanup-isolated-stack.ps1 -ReportPath $schemaReport`.

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
