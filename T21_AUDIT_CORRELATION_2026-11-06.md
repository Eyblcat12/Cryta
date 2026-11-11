# T21 — Audit, correlation và đường ghi khi rollback, 06/11/2026

Mọi nguồn ghi `audit_logs` hiện tìm thấy trong backend đã dùng chung `auditMetadata`. Middleware sinh `req_UUID`, trả `x-request-id` và truyền mã bằng AsyncLocalStorage. Mã do client gửi không được dùng làm mã truy vết. Audit chạy từ HTTP nhận correlation; job định kỳ ngoài HTTP tiếp tục truy vết bằng mã yêu cầu/đối tượng đã có.

## Danh mục sự kiện và ranh giới giao dịch

| Nhóm | Sự kiện hiện có/bổ sung | Cách lưu |
| --- | --- | --- |
| Phiên và mật khẩu | LOGIN_SUCCESS, SESSION_REFRESHED, SESSION_REPLAY_REJECTED, LOGOUT, PASSWORD_CHANGED | Cùng transaction với thay đổi phiên/tài khoản. Logout khóa user trước session, theo thứ tự refresh và thay đổi mật khẩu. |
| Mời và reset | USER_INVITED, USER_INVITATION_REISSUED, USER_INVITATION_ACCEPTED, PASSWORD_RESET_REQUESTED, USER_PASSWORD_RESET | Cùng transaction với token/hash, trạng thái và hàng đợi thư. Yêu cầu reset chưa xác thực dùng actor SYSTEM; không suy diễn người gửi từ email nhập. |
| Tài khoản, quyền, đơn vị | USER_CREATED, USER_STATUS_CHANGED, USER_ACCESS_CHANGED, USER_DEPARTMENT_CHANGED; DEPARTMENT_CREATED/UPDATED/ACTIVATED/DEACTIVATED | Audit cùng transaction; metadata chỉ lấy trường nghiệp vụ đã chọn. |
| Chính sách | POLICY_CREATED, POLICY_VERSION_CREATED, POLICY_DEACTIVATED | Audit cùng transaction với phiên bản/trạng thái. |
| Yêu cầu và quyết định | REQUEST_DRAFT_CREATED/UPDATED, REQUEST_SUBMITTED, REQUEST_APPROVED/REJECTED/CANCELLED | Audit cùng transaction. Lưu lại lần PUT nháp đầu tiên đã thành công không tạo audit thứ hai. Nội dung lý do/tham số nháp không được sao chép vào audit. |
| Thực thi và đối soát | ASSET_CREATED/RENEWED/REVOKED, REQUEST_RECONCILIATION_REQUIRED, PROVIDER_RETRY_SCHEDULED, PROVIDER_RESULT_CONFIRMED, PROVIDER_REQUEST_ABANDONED | Giữ transaction nghiệp vụ hiện có; áp dụng redaction chung. Lý do đối soát được lọc trước khi ghi. |
| Hết hạn | ASSET_MARKED_EXPIRING_SOON, ASSET_MARKED_EXPIRED | Cùng transaction với đổi trạng thái/thông báo. |
| HTTP bị từ chối/thất bại | HTTP_REQUEST_DENIED cho 4xx, HTTP_REQUEST_FAILED cho 5xx trên các route nghiệp vụ được liệt kê | Filter đợi một INSERT độc lập sau khi service đã rollback. Chỉ ghi route mẫu, method, HTTP status, correlation và actor đã được guard xác minh. |

HTTP failure dùng pool riêng tối đa hai kết nối, cùng DATABASE_URL/runtime role; connect timeout 1 giây, statement timeout 2 giây, query timeout 2,5 giây. Cần cộng hai kết nối này vào ngân sách mỗi API replica, ngoài pool chính và probe readiness. Không nới quyền runtime hay thay trigger bất biến. Chưa có migration/index mới cho JSON correlation; query plan/retention phải được đo trước khi chốt.

Route chưa nhận diện, lỗi parser trước route matching và health probe không tạo bản ghi HTTP audit này. Lỗi probe/job vẫn có structured log/metrics hiện có. Nếu DB không ghi được audit lỗi, service ghi `audit.http_failure_not_persisted` với trường an toàn; độ bền lúc DB mất phụ thuộc hệ thống thu thập log triển khai, hiện chưa được chọn. Không coi stdout là bảo đảm lưu trữ lâu dài.

## Redaction và sửa lỗi phiên

Redaction áp dụng lúc ghi và khi trả metadata lịch sử. Ngoài tên khóa nhạy cảm lồng nhau, helper lọc dạng private PEM, Bearer/JWT, password/token/API key có nhãn và URI có user/password trong chuỗi tự do. Thực hiện trước giới hạn độ dài. Không lưu body, header, URL thô, raw exception hay biên nhận provider vào HTTP failure audit. Helper không thể nhận biết mọi secret tùy ý không có định dạng/nhãn; nguồn ghi vẫn phải chọn trường cho phép.

Refresh sai secret trước đây có thể thu hồi các phiên của user chỉ dựa trên session UUID. Đã sửa: sai secret rollback và không thay phiên; chỉ xử lý replay khi hash khớp và phiên đã thu hồi/hết hạn. Rotation/replay và audit cùng transaction; audit lỗi rollback các thay đổi. Logout cũng đã chuyển sang một transaction, tránh thu hồi phiên thành công khi audit thất bại.

Cập nhật 08/11. Nhánh replay còn kiểm chuỗi xoay vòng có phiên thay thế đang hoạt động. Cookie hết hạn hoặc chuỗi đã kết thúc bị từ chối và đi qua audit HTTP thông thường. [Bằng chứng T06](T05_USER_ADMINISTRATION_2026-11-06.md)

API audit thêm bộ lọc chính xác `correlationId=req_UUID`, dùng tham số SQL cho count và page, trả scalar correlationId. Mã yêu cầu nghiệp vụ UUID ở `requestId` vẫn có nghĩa riêng.

## Bằng chứng và phần còn mở

- Backend [344/344 unit](tools/test-artifacts/audit-correlation-20261106/backend-unit.json) và build đạt. Có kiểm concurrent context, audit secret/redaction, filter đợi ghi, wrong-secret/replay, rollback logout/refresh/nháp và retry nháp không lặp audit.
- Runner runtime LOGIN đã bổ sung hai nhóm HTTP/DB và mở rộng ca rollback yêu cầu; tổng dự kiến 42 nhóm. Kiểm failure audit tồn tại sau rollback, actor ẩn danh, correlation lookup, cùng runtime role, wrong-secret không thu hồi và logout rollback. Đã cập nhật assertion metadata T07 để kiểm correlation thay vì `{}`.
- Đã chạy PostgreSQL trên image mới. [Runtime LOGIN 48/48](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/runtime-privileges-70488ce7aad4/results.json) xác nhận audit lỗi còn sau rollback, correlation tra được, quyền runtime ngăn sửa/xóa audit và log API không chứa credential của fixture.
- Các cổng còn mở của lượt 06/11 được cập nhật ở các mục bên dưới.

[Runner DB](tools/testing/runtime-privileges-runner.cjs), [ảnh chụp hash nguồn/build](tools/test-artifacts/audit-correlation-20261106/source-snapshot.json).

## T22 — Tra cứu sự kiện trên ứng viên ngày 07/11/2026

Security Admin có thể dùng bộ lọc nhanh hoặc mở bộ lọc theo người thực hiện, hành động, đối tượng, mã truy vết và thời gian Việt Nam. Bộ lọc áp dụng được lưu trong URL và dùng chung cho danh sách, đếm dòng và xuất báo cáo X04. [Mẫu đã duyệt](tools/design-previews/audit-investigation/index.html)

Chi tiết dùng mã audit `BIGINT` dưới dạng chuỗi và chỉ trả trường được phép. Thay đổi trạng thái tài khoản mới lưu giá trị trước và sau cùng giao dịch với cập nhật tài khoản và thu hồi phiên. Sự kiện lịch sử chỉ hiện phần đã ghi nhận. Liên kết tài khoản hoặc tài sản xuất hiện khi bản ghi còn tồn tại. Trang đích kiểm quyền theo luồng hiện có.

Kiểm cục bộ đạt backend 498/498, frontend 148/148, build, lint và OpenAPI. Chromium trên bản build với API fixture đạt hai viewport sáng/tối, gồm nhập sai mã, giữ URL sau tải lại, trả focus, chuyển đến tài khoản và giữ bộ lọc trong yêu cầu xuất báo cáo. Năm nhóm hồi quy tải, lỗi và phân trang Audit Log đều đạt. Bộ kiểm PostgreSQL/Chromium trong CI có ca T22 riêng.

Audit Log tiếp tục chỉ đọc trên giao diện. Kho lưu dài hạn, thời hạn giữ và quyền truy cập bản lưu cần xác nhận ở môi trường đích. Các checkpoint đã ký của X05 phải được lưu độc lập theo chính sách của môi trường. [X05](docs/X05_AUDIT_ANCHOR.md)

## Thông báo trạng thái và bàn phím ngày 08/11/2026

Audit Log đặt vùng thông báo bên ngoài bảng đang `aria-busy` để công nghệ hỗ trợ có thể nhận cập nhật trong lúc tải. Cùng một vùng báo khi tải chậm, báo số kết quả hoặc xác nhận danh sách rỗng. Hộp chi tiết báo tải và hoàn tất qua một vùng riêng. Khi thử lại lỗi, focus về nút Đóng. Escape trả focus về sự kiện vừa mở. [Quy tắc aria-busy](https://www.w3.org/TR/wai-aria-1.2/#aria-busy)

Ca hồi quy phát hiện vùng bị lồng trên bản trước. Chromium và Firefox đạt trên bản sửa, gồm kiểm cây trợ năng, dữ liệu rỗng, lỗi và thử lại. Chromium qua Nginx/PostgreSQL kiểm trạng thái và chi tiết ở 1440 px sáng và 390 px tối. Lượt này kiểm ngữ nghĩa và focus của trình duyệt. Phần đọc thành tiếng bằng trình đọc màn hình vẫn cần nghiệm thu riêng. [Ca trước sửa](tools/test-artifacts/n6-focus-layout-scoped/chromium-audit-status-baseline/results-filtered.json) · [Chromium](tools/test-artifacts/audit-live-status/chromium-audit-status-fixed/results-filtered.json) · [Firefox](tools/test-artifacts/audit-live-status/firefox-audit-status-fixed/results-filtered.json) · [Stack thật](tools/test-artifacts/integration/crypta-t30-test-fbd7f05ec598/real-chromium-1794074548955/results.json)

## Tra cứu chính xác mã truy vết ngày 08/11/2026

Migration `026_audit_correlation_index` thêm chỉ mục cho truy vấn theo mã truy vết đầy đủ. PostgreSQL dùng chỉ mục cho cả truy vấn đếm và trang có thứ tự theo thời gian, rồi theo ID nếu trùng thời gian. Ca kiểm xác nhận phân trang ổn định, quyền Security Admin và khả năng giữ các giá trị JSON lịch sử quá dài để đưa vào chỉ mục. [Ca kiểm PostgreSQL](tools/testing/runtime-privileges-runner.cjs)

Trên stack cục bộ với 75.000 dòng thử và 12 dòng khớp, cả hai truy vấn giảm từ 1.353 xuống 4 khối dữ liệu truy cập. Thời gian thực thi của truy vấn đếm giảm từ 12,465 xuống 0,066 ms. Truy vấn lấy trang hai giảm từ 19,036 xuống 0,232 ms. Bộ kiểm quyền runtime đạt 51/51. [Kết quả cục bộ](tools/test-artifacts/integration/crypta-t30-test-4a973c3c2c01/runtime-privileges-ca98387bac11/results.json)

## Log qua proxy và khi mất PostgreSQL ngày 08/11/2026

Ca hồi quy tái hiện dữ liệu giả trong log Nginx của image cũ. Định dạng JSON mới ghi mã proxy, mã truy vết do backend tạo nếu hợp lệ, nhóm API/web, method, trạng thái và thời gian xử lý. Log lỗi thô ở cấp server được tắt vì có thể chứa URL và referrer. Nginx tiếp tục ghi chẩn đoán khởi động ở cấp tiến trình. [Ca trước sửa](tools/test-artifacts/integration/crypta-t30-test-d03b0681af37/real-chromium-1794130485288/results.json) · [Tài liệu log Nginx](https://nginx.org/en/docs/http/ngx_http_log_module.html)

Trên Nginx/PostgreSQL cách ly, HTTP 401 có cùng mã truy vết ở phản hồi, log proxy và audit DB. Log loại dữ liệu giả chèn vào đường dẫn tệp, query, referrer, cookie và Authorization. Quyết định từ chối lên lịch gửi lại SMTP ghi route mẫu và mã truy vết vào audit. Khi tắt PostgreSQL, API phát `audit.http_failure_not_persisted` với cùng mã truy vết và trường an toàn. Monitor báo lỗi và xác nhận phục hồi sau khi khởi động lại PostgreSQL. [T21](tools/test-artifacts/integration/crypta-t30-test-4e11453051ca/real-chromium-1794130608026/results.json) · [T28](tools/test-artifacts/integration/crypta-t30-test-4e11453051ca/real-chromium-1794130627878/results.json) · [Mất DB](tools/test-artifacts/integration/crypta-t30-test-4e11453051ca/operations-monitor.json)

Diễn tập SIGTERM đạt 2/2. Sau khi backend thoát, Nginx ghi HTTP 502 và mã proxy. Cả hai luồng log của container đều loại dữ liệu giả trong query và referrer của probe. Stack được dọn sau kiểm. [Báo cáo](tools/test-artifacts/integration/crypta-t30-test-69e83aa8549e/shutdown-916ccdd8edd4/results.json)

Nghiệm thu môi trường đích còn cần kiểm log khởi động với cấu hình đích, dữ liệu SMTP lịch sử, log của ingress TLS và nơi thu thập fallback độc lập với PostgreSQL. Vận hành cần chốt thời hạn lưu, quyền đọc và thử truy xuất sau diễn tập mất DB. [Runbook](RELEASE_RUNBOOK.md#cấu-hình-docker-production)

## Log khởi động ngày 10/11/2026

Trên Compose production cách ly với PostgreSQL TLS, image `51c9a4a` in nguyên một giá trị giả lấy từ dòng migration lạ. Image `02023a4` thoát mã 1 và ghi `application.startup_failed` cùng mã `UNKNOWN_DATABASE_MIGRATION` trong log JSON. Giá trị thử và stack trace vắng mặt trong cả stdout lẫn stderr. Khi bỏ dòng thử, log khởi động Nest và xác minh SMTP xuất hiện, smoke HTTPS đạt 10/10. Cả hai stack đã dọn và ID của 15 container bên ngoài được giữ nguyên. [Đối chứng trước sửa](tools/test-artifacts/crypta-ca-test-f8f73d6a3188/report.json) · [Sau sửa](tools/test-artifacts/crypta-ca-test-8bf764b84c4d/report.json)

Job tích hợp CI chạy API đã biên dịch với một dòng migration lạ trong cơ sở dữ liệu thử riêng. Ca kiểm xác nhận mã thoát, trường JSON an toàn, giá trị thử vắng mặt trên cả hai luồng log và ledger giữ nguyên. Lượt chạy cục bộ trên WSL đạt 11/11 ca ledger và giữ nguyên ID của 15 container bên ngoài. [Ca kiểm](tools/testing/runtime-ledger-runner.cjs) · [Báo cáo cục bộ](tools/test-artifacts/integration/crypta-t30-test-dbdf2644b237/runtime-ledger-1fbaa0f34898/results.json)
