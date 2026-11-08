# Kịch bản nghiệm thu Crypta

## Chuẩn bị

Chạy bản thử từ đúng revision cần bàn giao và ghi lại tên image, thời điểm, trình duyệt, thiết bị và vai trò của người chạy. Dùng dữ liệu giả trong PostgreSQL cách ly và các tài khoản theo [hướng dẫn sử dụng](HUONG_DAN_CRYPTA.md). Tạo thêm User và Approver ở đơn vị thứ hai để kiểm tra truy cập chéo. Cần một người có quyền vận hành môi trường thử để chuẩn bị dữ liệu hết hạn và đối chiếu worker.

Bản local dùng adapter `MOCK`. Người kiểm tra lặp các ca liên quan email ở môi trường có hộp thư thử, và lặp các ca liên quan provider với sandbox đã chọn. Người phụ trách nghiệm thu ghi kết quả riêng cho từng môi trường. [Điều kiện tích hợp](../CAU_HINH_DICH_VU_THAT.md)

## Mười hai ca nghiệp vụ

| Ca | Người chạy và thao tác | Kết quả cần quan sát |
| --- | --- | --- |
| UC1 · Cấp mới | User tạo yêu cầu cấp khóa theo policy, lưu nháp, mở lại và gửi. Approver trong đơn vị duyệt. | Tham số và policy đúng. Chỉ có một quyết định và một lần cấp. Yêu cầu hoàn tất và tài sản mới xuất hiện trong danh mục của User. |
| UC2 · Gia hạn | User mở tài sản UC1 và gửi gia hạn. Approver duyệt. Mở lịch sử tài sản cũ và mới. | Tài sản mới liên kết với tài sản cũ. Tài sản cũ chuyển **Đã thay thế**. Người xem chỉ thấy liên kết trong quyền đã cấp. |
| UC3 · Thu hồi | User chọn tài sản mới từ UC2 và đọc xác nhận cuối. Kiểm tra chế độ thường và khẩn trên hai tài sản thử khác nhau. Approver duyệt. | Cả hai đi qua quyết định. Cờ khẩn có trong hàng chờ. Tài sản chuyển **Đã thu hồi** và không còn cho gửi gia hạn. Xác nhận ledger giữ một lần gửi cho mỗi thao tác. |
| UC4 · Tài sản theo quyền | User và Approver lọc danh mục, mở chi tiết và lịch sử, đổi trang, tải lại. Thử một link tài sản ngoài quyền. | Tổng khớp dữ liệu được phép xem. Link ngoài quyền bị từ chối và thông tin tài sản không hiển thị. |
| UC5 · Hàng chờ theo phạm vi | Tạo yêu cầu ở hai đơn vị, gồm một yêu cầu khẩn. Approver lọc, tìm và đổi trang. | Ưu tiên khẩn đúng, không có yêu cầu ngoài đơn vị được giao, số lượng khớp bộ lọc. |
| UC6 · Duyệt và từ chối | Hai Approver đủ quyền mở cùng yêu cầu. Một người từ chối với lý do, người còn lại gửi quyết định từ bản đang mở. User mở lại chi tiết. Thử tự duyệt và duyệt chéo đơn vị. | Chỉ một quyết định ghi thành công. User đọc được tên người duyệt, thời điểm, lý do và mốc **Đã từ chối**. Yêu cầu từ chối không đi tới worker. Các quyết định ngoài quyền bị chặn. |
| UC7 · Danh mục toàn hệ thống | Admin mở **Tài sản toàn hệ thống**, so tổng với tập dữ liệu, lọc trạng thái và tìm theo mã ở hai đơn vị. | Tổng và phân trang chính xác. Chi tiết khớp vòng đời, policy và owner. |
| UC8 · Quản trị policy | Admin tạo policy, phát hành phiên bản kế tiếp, đối chiếu lịch sử và xác nhận ngừng áp dụng từ trang Chính sách. | Yêu cầu mới dùng phiên bản phù hợp thời điểm gửi. Bản đã phát hành và tài sản đã cấp giữ tham chiếu cũ. Policy ngừng áp dụng không còn trong danh sách cấp mới hoặc gia hạn. |
| UC9 · Audit | Admin tìm quyết định UC6 theo mã nghiệp vụ, sau đó truy một lần gọi API theo mã `req_…`. Người vận hành kiểm quyền DB runtime trong stack thử. | Đủ sự kiện, đúng người và kết quả. Phản hồi đã lọc dữ liệu nhạy cảm. Runtime bị từ chối khi sửa hoặc xóa audit. |
| UC10 · Quản lý quyền | Admin cấp scope cho Approver, kiểm một yêu cầu có thể xem, rồi thu hồi khi phiên Approver đang mở. Kiểm các bước mời, đặt lại và chuyển đơn vị theo cấu hình thử. | Phiên cũ bị thu hồi. Scope mới có hiệu lực. Lịch sử nghiệp vụ giữ đúng đơn vị. Có Admin hoạt động sau thao tác. |
| UC11 · Sắp hết hạn | Người vận hành chuẩn bị tài sản ở sát mốc cảnh báo policy, chạy bộ quét rồi kiểm lại khi quét lần hai. Mở thông báo bằng owner, Approver đúng scope, Admin và một Approver ngoài scope. | Chỉ đúng đối tượng nhận thông báo. Số sự kiện giữ nguyên sau lần quét lại. Xác nhận thư tại hộp thư thử và thử mở link sau khi thu hồi scope. |
| UC12 · Hết hạn | Người vận hành chuẩn bị tài sản ngay trước và đúng mốc UTC, dừng/khởi động worker qua mốc. User tải lại danh mục và xem thông báo. | Tài sản tới mốc chuyển hết hạn, audit và thông báo ghi một lần. Tài sản đã thu hồi hoặc thay thế giữ trạng thái của chúng. |

## Review giao diện và phục hồi

- Với mỗi vai trò, kiểm trang Tổng quan, giá trị biểu đồ và chi tiết đi từ biểu đồ hoặc bảng. So kết quả với cùng tập dữ liệu. Kiểm loading, dữ liệu rỗng và lỗi đọc khi dừng riêng backend trong môi trường thử.
- Dùng desktop và màn hình nhỏ ở cả hai giao diện sáng/tối. Đi bằng Tab, Shift+Tab, Enter và Escape qua form, xác nhận và lỗi. Kiểm vị trí focus khi đóng hộp xác nhận, khi tải lại và khi mất quyền. Xác minh chữ và hành động quan trọng vẫn đọc được khi phóng to.
- Trong bài phục hồi, dùng ca xung đột phiên bản của UC6 và bản ghi đối soát provider đã chuẩn bị. Sau khi mất phản hồi, đọc lại trạng thái, kiểm tra log rồi chỉ xác nhận thao tác được phép. Ghi lại số lần gửi và kết quả cuối.
- Kiểm riêng vận hành email, backup/restore và hướng dẫn dành cho người lần đầu chạy. [Vận hành email](../EMAIL_OPERATIONS.md) · [Quy trình release](../RELEASE_RUNBOOK.md)

## Ghi nhận nghiệm thu

Mỗi ca có một dòng ghi revision, môi trường, vai trò và người chạy, dữ liệu thử, kết quả `Đạt`, `Không đạt` hoặc `Chờ điều kiện`, và đường dẫn bằng chứng. Với lỗi, ghi mức độ, bước tái hiện, kết quả mong đợi, kết quả thực tế, người xử lý và kết quả chạy lại. Che mật khẩu, token, cookie và định danh nhạy cảm trong ảnh hoặc log. Người phụ trách nghiệp vụ xác nhận 12 ca sau khi các lỗi chặn sử dụng được xử lý.

Các kết quả dưới đây là kiểm thử kỹ thuật hỗ trợ nghiệm thu. Biên bản xác nhận của người dùng vẫn chờ phiên UAT.

| Phạm vi | Bằng chứng kỹ thuật hiện có | Điều kiện còn mở |
| --- | --- | --- |
| UC1–UC3 | Ngày 08/11, User lưu nháp chưa đủ nội dung, tải lại, mở nháp và gửi bằng cùng mã. Approver không đọc được trước khi gửi. Bộ kiểm chạy năm yêu cầu gồm hai lần cấp, một lần gia hạn, thu hồi khẩn và thu hồi thường trên hai tài sản khác nhau. Mỗi yêu cầu ghi một audit gửi, một quyết định, một lần gọi worker MOCK và một biên nhận. Hàng chờ hiện đúng mức độ. [Runner](../tools/test-real-integration.cjs) · [Báo cáo Chromium/PostgreSQL](../tools/test-artifacts/integration/crypta-t30-test-0e79bb65f1e0/real-chromium-1794073415266/results.json) | Kiểm biên nhận với sandbox provider đã chọn và người dùng chạy lại luồng chính. |
| UC4, UC6 và UC7 | Bộ tích hợp trình duyệt với PostgreSQL trên stack cách ly, kiểm phạm vi danh mục, F5, SoD và quyết định đồng thời. Ca từ chối chạy bàn phím trên desktop sáng và mobile tối. [Runner](../tools/test-real-integration.cjs) | Rà chức năng bằng bộ dữ liệu nghiệp vụ đại diện, biểu đồ, bàn phím và trạng thái lỗi. |
| UC5 · Hàng chờ | Chromium và PostgreSQL dùng 11 yêu cầu trong đơn vị được giao và một yêu cầu khẩn ngoài phạm vi. Kiểm tổng, thứ tự ưu tiên, tìm kiếm, trang hai, bộ lọc khẩn và đối chiếu tổng với bản xem trước báo cáo. API dùng `departmentId`, `from` và `to` để lọc theo đơn vị và thời điểm gửi. Hai mốc được tính cả biên và phải có múi giờ. Lượt hồi quy 08/11 đạt 45/45 nhóm. [Báo cáo](../tools/test-artifacts/integration/crypta-t30-test-ca44acaef0fd/real-chromium-1794073985376/results.json) | Lặp với tài khoản nhiều đơn vị và dữ liệu đại diện ở môi trường đích. |
| UC8–UC10 | Luồng tạo/ngừng policy đã được duyệt và kiểm qua giao diện trên PostgreSQL. Audit correlation, quyền runtime, quản trị tài khoản và chuyển đơn vị có kiểm riêng. [Policy](../T20_POLICY_LIFECYCLE_2026-11-06.md) · [Audit](../T21_AUDIT_CORRELATION_2026-11-06.md) · [Quyền DB](../T43_RUNTIME_LOGIN_2026-11-06.md) · [Chuyển đơn vị](../T08_DEPARTMENT_ADMINISTRATION_2026-11-06.md) | Rà với cơ cấu đơn vị thử, các vai trò nghiệp vụ và chính sách của môi trường đích. |
| UC11–UC12 | 20 ca PostgreSQL về ngưỡng, scope, thu hồi và restart. Chromium qua Nginx xác nhận UI cho ba vai trò nhận và loại Approver ngoài phạm vi sau khi job catch-up. SMTP loopback kiểm thư và người nhận ở lượt riêng. [Cảnh báo hết hạn](../T27_HARDENING_2026-11-06.md) | Xác minh hộp thư ngoài, lịch quét định kỳ và giám sát trên môi trường đích. |

### T10 — Kiểm lại tài sản khi duyệt

Ca đối chứng cho thấy bản cũ vẫn duyệt yêu cầu sau khi tài sản đổi chủ. Bản sửa khóa và kiểm lại chủ sở hữu, trạng thái, ngày hết hạn, policy gắn với tài sản và tham chiếu provider trước khi ghi phê duyệt gia hạn hoặc thu hồi. Bước gửi và worker cùng kiểm mốc hết hạn, kể cả khi bộ quét chưa đổi trạng thái. Nếu phê duyệt bị chặn, Approver vẫn có thể từ chối yêu cầu.

Hai nhóm qua Nginx và PostgreSQL kiểm đổi chủ, hết hạn, mất tham chiếu và hai lượt gửi đồng thời cho một tài sản. Khi bị chặn, yêu cầu giữ `PENDING` và phiên bản cũ, chưa có quyết định duyệt, audit duyệt, thông báo duyệt hoặc lượt gửi provider. Trong ca cạnh tranh, chỉ một yêu cầu được gửi và một lần gọi provider hoàn tất. [Ca trước sửa](../tools/test-artifacts/integration/crypta-t30-test-8bf8ed325be8/real-chromium-1794134427898/results.json) · [Kết quả T10](../tools/test-artifacts/integration/crypta-t30-test-2264bcb9688a/real-chromium-1794134552926/results.json)

Trên cùng image, Chromium đạt 3/3 nhóm T49. Bộ worker/PostgreSQL đạt 36/36 và xác nhận cả gia hạn lẫn thu hồi bị chặn trước lần gửi khi đã đến `expires_at` nhưng trạng thái tài sản vẫn là `ACTIVE`. [T49](../tools/test-artifacts/integration/crypta-t30-test-2264bcb9688a/real-chromium-1794134565572/results.json) · [Worker](../tools/test-artifacts/integration/crypta-t30-test-2264bcb9688a/worker-recovery-after-2a2254037788/results.json)

### Lỗi phát hiện trong lúc chuẩn bị UC6

**UAT-01 · P1 · FE/BE.** User gửi yêu cầu, Approver từ chối có lý do rồi User tải lại chi tiết. Bản trước thiếu người duyệt và lý do, đồng thời vẫn có mốc **Chờ kết quả xử lý**. Chrome tái hiện ở cả 1440 px sáng và 390 px tối dù PostgreSQL đã có quyết định, audit và thông báo.

Chi tiết nay đọc trạng thái và quyết định trong cùng truy vấn. Khi tải lại, User thấy người duyệt, thời điểm và lý do. Tiến trình kết thúc ở **Đã từ chối**. PostgreSQL ghi đúng một quyết định, một audit, một thông báo trong ứng dụng và không ghi thao tác provider. [Ảnh màn hình](images/user-request.png)

Lượt 06/11/2026 đạt **35/35 nhóm trên mỗi Chrome và Edge** với Docker, PostgreSQL và Nginx. Bản chạy dùng `index-BDI-K94F.js` và `index-DIi5GvX9.css`. Kết quả gồm hai ca từ chối và một chuỗi cấp, gia hạn, thu hồi trên mỗi trình duyệt. SMTP tắt trong lượt này và provider ở chế độ MOCK. [Bản trước 0/2](../tools/test-artifacts/integration/crypta-t30-test-5b81b4ed4304/real-chrome-1793968748844/results.json) · [Chrome 35/35](../tools/test-artifacts/integration/crypta-t30-test-5d0d668865e7/real-chrome-1793968842796/results.json) · [Edge 35/35](../tools/test-artifacts/integration/crypta-t30-test-5d0d668865e7/real-msedge-1793968976613/results.json)
