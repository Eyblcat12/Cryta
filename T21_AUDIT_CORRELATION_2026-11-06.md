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

API audit thêm bộ lọc chính xác `correlationId=req_UUID`, dùng tham số SQL cho count và page, trả scalar correlationId. Mã yêu cầu nghiệp vụ UUID ở `requestId` vẫn có nghĩa riêng.

## Bằng chứng và phần còn mở

- Backend [344/344 unit](tools/test-artifacts/audit-correlation-20261106/backend-unit.json) và build đạt. Có kiểm concurrent context, audit secret/redaction, filter đợi ghi, wrong-secret/replay, rollback logout/refresh/nháp và retry nháp không lặp audit.
- Runner runtime LOGIN đã bổ sung hai nhóm HTTP/DB và mở rộng ca rollback yêu cầu; tổng dự kiến 42 nhóm. Kiểm failure audit tồn tại sau rollback, actor ẩn danh, correlation lookup, cùng runtime role, wrong-secret không thu hồi và logout rollback. Đã cập nhật assertion metadata T07 để kiểm correlation thay vì `{}`.
- Đã chạy PostgreSQL trên image mới. [Runtime LOGIN 48/48](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/runtime-privileges-70488ce7aad4/results.json) xác nhận audit lỗi còn sau rollback, correlation tra được, quyền runtime ngăn sửa/xóa audit và log API không chứa credential của fixture.
- Còn kiểm log Nginx/startup, dữ liệu SMTP lịch sử, đường lưu fallback bền vững, tra cứu correlation qua proxy. T21/T22 tiếp tục trạng thái một phần.

[Runner DB](tools/testing/runtime-privileges-runner.cjs), [ảnh chụp hash nguồn/build](tools/test-artifacts/audit-correlation-20261106/source-snapshot.json).

## T22 — Tra cứu sự kiện trên ứng viên ngày 07/11/2026

Security Admin có thể dùng bộ lọc nhanh hoặc mở bộ lọc theo người thực hiện, hành động, đối tượng, mã truy vết và thời gian Việt Nam. Bộ lọc áp dụng được lưu trong URL và dùng chung cho danh sách, đếm dòng và xuất báo cáo X04. [Mẫu đã duyệt](tools/design-previews/audit-investigation/index.html)

Chi tiết dùng mã audit `BIGINT` dưới dạng chuỗi và chỉ trả trường được phép. Thay đổi trạng thái tài khoản mới lưu giá trị trước và sau cùng giao dịch với cập nhật tài khoản và thu hồi phiên. Sự kiện lịch sử chỉ hiện phần đã ghi nhận. Liên kết tài khoản hoặc tài sản xuất hiện khi bản ghi còn tồn tại. Trang đích kiểm quyền theo luồng hiện có.

Kiểm cục bộ đạt backend 498/498, frontend 148/148, build, lint và OpenAPI. Chromium trên bản build với API fixture đạt hai viewport sáng/tối, gồm nhập sai mã, giữ URL sau tải lại, trả focus, chuyển đến tài khoản và giữ bộ lọc trong yêu cầu xuất báo cáo. Năm nhóm hồi quy tải, lỗi và phân trang Audit Log đều đạt. Bộ kiểm PostgreSQL/Chromium trong CI có ca T22 riêng.

Audit Log tiếp tục chỉ đọc trên giao diện. Kho lưu dài hạn, thời hạn giữ và quyền truy cập bản lưu cần xác nhận ở môi trường đích. Các checkpoint đã ký của X05 phải được lưu độc lập theo chính sách của môi trường. [X05](docs/X05_AUDIT_ANCHOR.md)
