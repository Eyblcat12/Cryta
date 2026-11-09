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

### Đối chiếu bằng chứng theo commit

Ngày 09/11/2026, `ef4c55750592ab88ad0b846897e5437ffa53e662` đạt 65/65 nhóm Chromium qua Nginx và PostgreSQL trên stack cách ly. Bảng dùng artifact `integration-results` ID `13642735838`. Ca Chromium nằm trong `real-chromium-1794185650024/results.json`. Đã kiểm các ca đối chiếu từ bản ngày 08/11 và ca UC10 mới kiểm cấp rồi thu hẹp phạm vi qua UI. Báo cáo cùng lượt xác nhận runtime 51/51, worker 37/37, hết hạn 21/21 và giao thư 20/20. Provider dùng MOCK trong luồng chính và các ca email chạy loopback riêng. [Lượt GitHub Actions](https://github.com/Eyblcat12/Cryta/actions/runs/42542216461) · [Digest artifact](CI_REMOTE_2026-11-07.md#đối-chiếu-phiên-https-và-phục-hồi-nginx-ngày-0911)

| UC | Bằng chứng đã đối chiếu trong artifact | Điều kiện cần xác nhận khi nghiệm thu |
| --- | --- | --- |
| UC1 | `T49 real UI: issue, renew and revoke` kiểm lưu và mở lại nháp, gửi cấp mới, duyệt và đối chiếu một lần xử lý. Ca T32 kiểm phiên bản policy TLS trong yêu cầu chứng thư. | Đại diện User và Approver chạy với policy đích, đối chiếu biên nhận provider. |
| UC2 | Cùng nhóm T49 kiểm gia hạn. Ca T18 kiểm liên kết tài sản, lịch sử provider và giới hạn scope. Bộ worker kiểm tài sản cũ đổi trạng thái khi gia hạn. | Chạy gia hạn và ca lỗi với sandbox provider đã chọn. |
| UC3 | Cùng nhóm T49 kiểm thu hồi thường và khẩn. Ca T10 kiểm cạnh tranh giữa gia hạn và thu hồi, chỉ có một lần gọi provider. | Đối chiếu trạng thái thu hồi và lần gửi lặp trong sandbox đích. |
| UC4 | `owner/scope filters apply before count and paging`, các ca T18 và NAV-03 kiểm tổng, chi tiết, lịch sử, F5 và link ngoài scope. | Chạy với các đơn vị và dữ liệu đại diện. |
| UC5 | `UC5 approval queue` kiểm ưu tiên khẩn, tìm kiếm, phân trang và đồng nhất phạm vi giữa UI và API. | Chạy với tài khoản được giao nhiều đơn vị và các bộ lọc nghiệp vụ. |
| UC6 | Ca SoD và hai Approver đồng thời kiểm quyết định duy nhất. Hai ca T49 từ chối kiểm người duyệt, lý do và trạng thái hiển thị trên desktop và mobile. | Đại diện nghiệp vụ xác nhận luồng từ chối và xử lý xung đột. |
| UC7 | Ca T18 kiểm Admin thấy liên kết tài sản trong toàn hệ thống. `Large list fixtures` trong `runtime-privileges` kiểm thứ tự và tổng trên dữ liệu vượt giới hạn cũ. | Đối chiếu danh mục và phân trang với tập dữ liệu đích. |
| UC8 | Hai ca T20 kiểm vòng đời policy và phục hồi xung đột trên UI. Ca `Policy append concurrency` kiểm bất biến phiên bản đã phát hành bằng role runtime. | Chốt bộ policy đích và kiểm phiên bản được áp dụng sau rollout. |
| UC9 | Ca T21 đối chiếu mã truy vết Nginx với audit PostgreSQL. Ca T22 kiểm tìm kiếm, chi tiết đã lọc và xuất theo cùng phạm vi. Bộ `runtime-privileges` kiểm quyền ghi audit. | Xác nhận lưu log, tra cứu và quyền trên môi trường đích. |
| UC10 | Admin cấp rồi thu hẹp phạm vi qua UI. Hai lần cập nhật thu hồi phiên đang mở và ghi audit. Hàng chờ từ hai yêu cầu còn một, API trả 404 cho yêu cầu ngoài phạm vi sau thu hẹp. Hai ca bảo vệ Admin cuối kiểm cạnh tranh. `runtime-privileges` kiểm chuyển đơn vị và luồng mời/đặt lại qua SMTP loopback. | Chạy với cơ cấu quyền đích và hộp thư thử. |
| UC11 | `UC11–UC12: expiry job catches up` kiểm thông báo theo phạm vi. Bộ `expiry-scan` đạt 21/21, gồm policy gắn với tài sản, ngưỡng 24 giờ và khử trùng theo người nhận/kênh. `email-delivery-after` kiểm bỏ gửi khi scope đã bị thu hồi. | Xác nhận thư đến hộp thư thử và link sau khi thay đổi quyền. |
| UC12 | Cùng ca UC11–UC12 kiểm vượt mốc trong downtime, audit, thông báo và chạy lại. Bộ `expiry-scan` kiểm thêm các trạng thái đã thu hồi và đã thay thế. | Kiểm chu kỳ trên môi trường đích cùng các replica vận hành. |

### Các lượt chuẩn bị trước đó

| Phạm vi | Bằng chứng kỹ thuật hiện có | Điều kiện còn mở |
| --- | --- | --- |
| UC1–UC3 | Ngày 08/11, User lưu nháp chưa đủ nội dung, tải lại, mở nháp và gửi bằng cùng mã. Approver không đọc được trước khi gửi. Bộ kiểm chạy năm yêu cầu gồm hai lần cấp, một lần gia hạn, thu hồi khẩn và thu hồi thường trên hai tài sản khác nhau. Mỗi yêu cầu ghi một audit gửi, một quyết định, một lần gọi worker MOCK và một biên nhận. Hàng chờ hiện đúng mức độ. [Runner](../tools/test-real-integration.cjs) · [Báo cáo Chromium/PostgreSQL](../tools/test-artifacts/integration/crypta-t30-test-0e79bb65f1e0/real-chromium-1794073415266/results.json) | Kiểm biên nhận với sandbox provider đã chọn và người dùng chạy lại luồng chính. |
| UC4, UC6 và UC7 | Bộ tích hợp trình duyệt với PostgreSQL trên stack cách ly, kiểm phạm vi danh mục, F5, SoD và quyết định đồng thời. Ca từ chối chạy bàn phím trên desktop sáng và mobile tối. [Runner](../tools/test-real-integration.cjs) | Rà chức năng bằng bộ dữ liệu nghiệp vụ đại diện, biểu đồ, bàn phím và trạng thái lỗi. |
| UC5 · Hàng chờ | Chromium và PostgreSQL dùng 11 yêu cầu trong đơn vị được giao và một yêu cầu khẩn ngoài phạm vi. Kiểm tổng, thứ tự ưu tiên, tìm kiếm, trang hai, bộ lọc khẩn và đối chiếu tổng với bản xem trước báo cáo. API dùng `departmentId`, `from` và `to` để lọc theo đơn vị và thời điểm gửi. Hai mốc được tính cả biên và phải có múi giờ. Lượt hồi quy 08/11 đạt 45/45 nhóm. [Báo cáo](../tools/test-artifacts/integration/crypta-t30-test-ca44acaef0fd/real-chromium-1794073985376/results.json) | Lặp với tài khoản nhiều đơn vị và dữ liệu đại diện ở môi trường đích. |
| UC8–UC10 | Luồng tạo/ngừng policy đã được duyệt và kiểm qua giao diện trên PostgreSQL. Audit correlation, quyền runtime, quản trị tài khoản và chuyển đơn vị có kiểm riêng. [Policy](../T20_POLICY_LIFECYCLE_2026-11-06.md) · [Audit](../T21_AUDIT_CORRELATION_2026-11-06.md) · [Quyền DB](../T43_RUNTIME_LOGIN_2026-11-06.md) · [Chuyển đơn vị](../T08_DEPARTMENT_ADMINISTRATION_2026-11-06.md) | Rà với cơ cấu đơn vị thử, các vai trò nghiệp vụ và chính sách của môi trường đích. |
| UC11–UC12 | 20 ca PostgreSQL về ngưỡng, scope, thu hồi và restart. Chromium qua Nginx xác nhận UI cho ba vai trò nhận và loại Approver ngoài phạm vi sau khi job catch-up. SMTP loopback kiểm thư và người nhận ở lượt riêng. [Cảnh báo hết hạn](../T27_HARDENING_2026-11-06.md) | Xác minh hộp thư ngoài, lịch quét định kỳ và giám sát trên môi trường đích. |

### UC10 — Cấp và thu hẹp phạm vi qua màn Phân quyền

Ngày 08/11, Admin dùng màn Phân quyền để chuyển một User thử thành Approver của hai đơn vị, rồi bỏ một đơn vị. Hai lần lưu yêu cầu xác nhận. Sau mỗi lần, bearer cũ trả 401 và PostgreSQL ghi 0 phiên refresh còn hiệu lực cho tài khoản đó. Trình duyệt yêu cầu đăng nhập lại. Hàng chờ sau đăng nhập đổi từ hai yêu cầu còn một. Link trực tiếp thuộc đơn vị đã bỏ trả 404, còn yêu cầu trong phạm vi vẫn mở được. Audit ghi đúng hai lần đổi phạm vi với Admin thực hiện. Chromium đạt 65/65 nhóm trong bộ đầy đủ và Edge đạt ca UC10 riêng. [Chromium](../tools/test-artifacts/integration/crypta-t30-test-9f333c0a3885/real-chromium-1794151378023/results.json) · [Edge](../tools/test-artifacts/integration/crypta-t30-test-9f333c0a3885/real-msedge-1794151701987/results.json)

### T10 — Kiểm lại tài sản khi duyệt

Ca đối chứng cho thấy bản cũ vẫn duyệt yêu cầu sau khi tài sản đổi chủ. Bản sửa khóa và kiểm lại chủ sở hữu, trạng thái, ngày hết hạn, policy gắn với tài sản và tham chiếu provider trước khi ghi phê duyệt gia hạn hoặc thu hồi. Bước gửi và worker cùng kiểm mốc hết hạn, kể cả khi bộ quét chưa đổi trạng thái. Nếu phê duyệt bị chặn, Approver vẫn có thể từ chối yêu cầu.

Hai nhóm qua Nginx và PostgreSQL kiểm đổi chủ, hết hạn, mất tham chiếu và hai lượt gửi đồng thời cho một tài sản. Khi bị chặn, yêu cầu giữ `PENDING` và phiên bản cũ, chưa có quyết định duyệt, audit duyệt, thông báo duyệt hoặc lượt gửi provider. Trong ca cạnh tranh, chỉ một yêu cầu được gửi và một lần gọi provider hoàn tất. [Ca trước sửa](../tools/test-artifacts/integration/crypta-t30-test-8bf8ed325be8/real-chromium-1794134427898/results.json) · [Kết quả T10](../tools/test-artifacts/integration/crypta-t30-test-2264bcb9688a/real-chromium-1794134552926/results.json)

Trên cùng image, Chromium đạt 3/3 nhóm T49. Bộ worker/PostgreSQL đạt 36/36 và xác nhận cả gia hạn lẫn thu hồi bị chặn trước lần gửi khi đã đến `expires_at` nhưng trạng thái tài sản vẫn là `ACTIVE`. [T49](../tools/test-artifacts/integration/crypta-t30-test-2264bcb9688a/real-chromium-1794134565572/results.json) · [Worker](../tools/test-artifacts/integration/crypta-t30-test-2264bcb9688a/worker-recovery-after-2a2254037788/results.json)

### T32 — Chọn policy khi cấp chứng thư

Form cấp mới lọc policy theo loại tài sản. Khi chuyển sang chứng thư, policy dành cho khóa biến mất khỏi danh sách và lý do vẫn giữ. Chromium ở 390 px giao diện tối gửi bằng bàn phím qua Nginx/PostgreSQL, nhận HTTP 201 và lưu đúng loại tài sản cùng mã phiên bản TLS. Hai ca fixture kiểm trạng thái thiếu policy, giữ lý do, còn nút lưu nháp và tự chọn policy khi form chưa chỉnh. [Ca trước sửa](../tools/test-artifacts/integration/crypta-t30-test-a9af3805cbb6/real-chromium-1794136306611/results.json) · [Kết quả](../tools/test-artifacts/integration/crypta-t30-test-3d0c19ce367c/real-chromium-1794136404167/results.json) · [Ảnh 390 px](../tools/test-artifacts/integration/crypta-t30-test-3d0c19ce367c/real-chromium-1794136404167/certificate-policy-390-dark.png)

### Lỗi phát hiện trong lúc chuẩn bị UC6

**UAT-01 · P1 · FE/BE.** User gửi yêu cầu, Approver từ chối có lý do rồi User tải lại chi tiết. Bản trước thiếu người duyệt và lý do, đồng thời vẫn có mốc **Chờ kết quả xử lý**. Chrome tái hiện ở cả 1440 px sáng và 390 px tối dù PostgreSQL đã có quyết định, audit và thông báo.

Chi tiết nay đọc trạng thái và quyết định trong cùng truy vấn. Khi tải lại, User thấy người duyệt, thời điểm và lý do. Tiến trình kết thúc ở **Đã từ chối**. PostgreSQL ghi đúng một quyết định, một audit, một thông báo trong ứng dụng và không ghi thao tác provider. [Ảnh màn hình](images/user-request.png)

Lượt 06/11/2026 đạt **35/35 nhóm trên mỗi Chrome và Edge** với Docker, PostgreSQL và Nginx. Bản chạy dùng `index-BDI-K94F.js` và `index-DIi5GvX9.css`. Kết quả gồm hai ca từ chối và một chuỗi cấp, gia hạn, thu hồi trên mỗi trình duyệt. SMTP tắt trong lượt này và provider ở chế độ MOCK. [Bản trước 0/2](../tools/test-artifacts/integration/crypta-t30-test-5b81b4ed4304/real-chrome-1793968748844/results.json) · [Chrome 35/35](../tools/test-artifacts/integration/crypta-t30-test-5d0d668865e7/real-chrome-1793968842796/results.json) · [Edge 35/35](../tools/test-artifacts/integration/crypta-t30-test-5d0d668865e7/real-msedge-1793968976613/results.json)
