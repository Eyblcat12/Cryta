# CRYPTA — Kế hoạch hoàn thiện và nghiệm thu toàn bộ dự án

> Cập nhật06/11/2026: [tiến độ và các pha kiểm chứng](PROJECT_PROGRESS_2026-11-05.md), [54+6 task](TASK_STATUS_2026-11-05.md). Worker, dependency/parser, runtime LOGIN19, delayed GET26 mỗi Edge/Chrome, focus fix96/full180 mỗi browser và CSS focus contrast600/radio keyboard12 đã có bằng chứng riêng từng pha; N6, rollout, nghiệp vụ và các cổng release còn mở. T30 vẫn ưu tiên đầu.

Ngày lập: 27/09/2026. Phạm vi: kế hoạch công việc, chưa phải biên bản nghiệm thu.

**Điều chỉnh ưu tiên ngày 28/09/2026 theo yêu cầu chủ dự án:** thực hiện **T30 — chuyển dashboard sang điều hướng theo trang — đầu tiên**, trước khi tiếp tục backlog chức năng còn lại. Router và motion đã có lát cắt đầu tiên nhưng chưa nghiệm thu; bằng chứng cập nhật ngày 06/10 ở [tracker](IMPLEMENTATION_TRACKER.md), [T30](T30_PROGRESS_2026-10-06.md) và [54+6 task](TASK_STATUS_2026-10-06.md). T30 có thứ tự thực hiện số 1, vẫn thuộc P1; mọi yêu cầu P0 tiếp tục là điều kiện chặn release dữ liệu thật.

Cập nhật 06/10: T30 có fixture 180/180 ba engine, real integration 23/23 mỗi Edge/Chrome và native zoom 12/12. BE 119/119/build, worker 12/12, policy 8/8, expiry 13/13 và migration 7→8 có DB thật; backup 11/11, 17 bảng/sequence khớp và dọn stack test với inventory tám container ngoài test. Danh mục 39 task chính một phần/15 chưa đối chiếu. N6, trợ năng và NAV chưa đủ bằng chứng giữ mở. Provider/SMTP/deployment chưa chọn; tiếp tục phần local theo phụ thuộc.

## 1. Mục tiêu và cách sử dụng

Hoàn thiện Crypta thành sản phẩm quản lý vòng đời khóa/chứng thư có thể triển khai cho một tổ chức: đủ 12 use case, phân quyền đúng, email thật, khởi động thuận tiện, có kiểm thử, giám sát và phục hồi dữ liệu.

Kế hoạch được đối chiếu với `implementation_plan.md`, `IMPLEMENTATION_TRACKER.md`, `PROJECT_STATUS.md` và mã nguồn hiện tại. Các con số test trong tài liệu cũ là bằng chứng lịch sử, không được xem là kết quả chạy lại ngày lập kế hoạch. Không suy ra phần trăm hoàn thành từ số màn hình hoặc số file.

Mỗi task bên dưới gồm **hành động**, **kết quả bàn giao**, **điều kiện nghiệm thu** và **phụ thuộc**. Checkbox chỉ được đánh dấu sau khi có bằng chứng. Việc có API/UI chưa đủ để đóng task.

### Phân loại phạm vi

- **Bản R1 — chức năng và vận hành:** T01–T54. Hoàn thiện 12 UC, email thật, đóng gói, kiểm thử và vận hành. Một số task là yêu cầu bổ sung để dùng thực tế, không phải tính năng đã có trong MVP ban đầu.
- **Cổng provider thật:** adapter HTTP hiện có không đồng nghĩa đã tích hợp KMS/CA thật. Chỉ tuyên bố quản lý tài sản mật mã thật khi T16 được nghiệm thu với nhà cung cấp đã chọn. Nếu chưa có kết nối, phải ghi rõ bản chạy mô phỏng.
- **Bản R2 — nâng cao:** X01–X06 ghi đầy đủ các mục mở rộng trong kế hoạch gốc. Không âm thầm coi các mục này đã hoàn thành hoặc bắt buộc tích hợp mọi hãng cùng lúc.
- **Ngoài phạm vi:** tự viết thuật toán mật mã, tự xây CA hoàn chỉnh, cho tải private key rõ, quản lý phần cứng HSM, thay thế toàn bộ PKI doanh nghiệp.

### Mức ưu tiên và quy tắc đóng task

- **P0:** chặn triển khai dữ liệu thật vì rủi ro mất dữ liệu, sai quyền, sai vòng đời hoặc tác động ngoài hệ thống bị lặp.
- **P1:** bắt buộc để hoàn thiện R1.
- **P2:** hoàn thiện bàn giao hoặc mở rộng; có thể sau bản chạy thử nhưng không được ghi là hoàn thành nếu chưa làm.
- Mỗi task cần người phụ trách, commit/PR, lệnh test, kết quả, ảnh/video nếu liên quan UI và lỗi còn tồn tại. Các vai trò BE/FE/QA/OPS/PO là trách nhiệm cần phân công, không giả định đã có nhân sự.
- Trạng thái dùng thống nhất: Chưa làm → Đang làm → Chờ kiểm thử → Chờ điều kiện ngoài → Đã nghiệm thu. Task đã có một phần mã nguồn vẫn phải đi qua kiểm thử.

## 2. Hiện trạng và những điểm không được bỏ qua

| Nhóm | Đã có nền tảng | Khoảng trống cần xử lý |
| --- | --- | --- |
| Authentication/RBAC | JWT, refresh rotation, scope, bắt buộc đổi mật khẩu | Trạng thái user chưa cập nhật nguyên tử; bảo vệ admin cuối; kiểm thử phiên và scope đầy đủ |
| Yêu cầu/duyệt | Tạo–duyệt–xử lý; kiểm tra SoD; khóa bản ghi | Nháp/submit theo kế hoạch gốc; tham số alias xung đột; kiểm tra lại trạng thái khi thực thi; bộ lọc khẩn |
| Provider/worker | Adapter mô phỏng và HTTP; claim công việc trong PostgreSQL | Idempotency, đối soát kết quả chưa xác định, kiểm tra response và phục hồi sau crash |
| Policy/job | Phiên bản policy; job cảnh báo/hết hạn | Job còn dùng mốc 30 ngày cố định, chưa dùng đầy đủ `warning_days`; kiểm thử nhiều worker/thời gian |
| Tài sản/audit | API theo phạm vi; lịch sử; DB có trigger chống sửa/xóa audit | Danh sách Admin đầy đủ; phân trang; timeline liên kết; lọc audit; quyền DB tối thiểu |
| Email/thông báo | Hàng đợi, retry và SMTP | Xác minh hộp thư thật; xử lý trạng thái gửi chưa xác định; UI thông báo mọi vai trò |
| Frontend | Dashboard, biểu đồ, dark/light, quản lý access/policy | Dữ liệu ghi cứng, trạng thái bất đồng bộ, bảng dữ liệu lớn, bàn phím và trạng thái lỗi |
| Vận hành | Docker và tệp khởi động; workflow CI | Backup/restore; migration an toàn; secrets/bootstrap; CI tích hợp/E2E; giám sát và hướng dẫn máy mới |

Lưu ý: worker gọi provider trước khi hoàn tất transaction DB. Nếu provider thành công nhưng DB hoặc tiến trình lỗi, việc đưa request về hàng chờ có thể gây cấp phát lại. Không thêm nút “thử lại” trước khi giải quyết T13–T15.

Bổ sung kiểm kê frontend ngày 28/09: menu gọi `scrollIntoView`, các màn hình được ghép trong dashboard theo vai trò; chưa có React Router. Mục Tổng quan đang active cố định. Đây là baseline để làm T30, không phải kiến trúc đích. Các mô tả khoảng trống ngày 27/09 ở bảng trên cần đối chiếu tiến độ mới trong `IMPLEMENTATION_TRACKER.md` trước khi lập trình.

## 3. Danh sách task chi tiết

### Nhóm A — Chốt nền tảng và hợp đồng nghiệp vụ

#### T01 — Lập baseline có thể kiểm chứng · P1 · BE/FE/QA

- [ ] Kiểm kê thay đổi Git hiện có, tách thay đổi của dự án khỏi file ngoài phạm vi; không ghi đè hoặc đưa tất cả file vào commit máy móc.
- [ ] Ghi phiên bản runtime, cấu hình không chứa secret, cấu trúc dịch vụ và các lệnh build/test thực sự đang dùng.
- [ ] Chạy lại build, unit test và smoke trên môi trường kiểm thử riêng; ghi ngày chạy, commit, số test và lỗi.
- **Kết quả:** baseline kỹ thuật và danh sách lỗi tái hiện được.
- **Nghiệm thu:** một người khác chạy lại được; kết quả cũ và kết quả mới được phân biệt rõ.
- **Phụ thuộc:** không; không dùng DB đang chứa dữ liệu thật để seed/test phá hủy.

#### T02 — Chốt ma trận yêu cầu và trạng thái · P1 · PO/BE/QA

- [ ] Ánh xạ 12 UC sang route, màn hình, bảng dữ liệu, job và test; ghi rõ phần có/thiếu/chưa kiểm chứng.
- [ ] Viết bảng chuyển trạng thái request/asset, điều kiện chuyển, tác nhân và sự kiện audit; chốt tên trạng thái thực tế.
- [ ] Chốt quy tắc nháp, khẩn cấp, gia hạn policy cũ, tài sản hết hạn và quyền trên tài sản thuộc đơn vị khác.
- **Kết quả:** đặc tả nghiệp vụ ngắn gọn làm chuẩn cho BE/FE/test; danh sách quyết định chưa chốt có chủ sở hữu.
- **Nghiệm thu:** mỗi thao tác có điều kiện cho phép/từ chối; không có nhánh trạng thái không có cách phục hồi.
- **Phụ thuộc:** T01. Quyết định thay đổi nghiệp vụ phải được chủ dự án xác nhận trước triển khai.

#### T03 — Chuẩn hóa hợp đồng API và validation · P0 · BE/FE

- [ ] Quy định một kiểu đặt tên tham số; chuẩn hóa alias tại biên API, từ chối alias trùng nhưng khác giá trị.
- [ ] Dùng cùng dữ liệu đã kiểm tra từ lúc tạo yêu cầu đến lúc worker thực thi; không để validator và worker ưu tiên alias khác nhau.
- [ ] Chuẩn hóa UUID, ngày, enum, giới hạn chuỗi, pagination và mã lỗi; cập nhật OpenAPI/type frontend.
- **Kết quả:** DTO và cấu hình cấp phát chuẩn hóa, hợp đồng API nhất quán.
- **Nghiệm thu:** input không hợp lệ bị từ chối trước khi lưu/gọi provider; giá trị hiển thị và thực thi trùng nhau.
- **Phụ thuộc:** T02.

#### T04 — Migration và dữ liệu ban đầu an toàn · P0 · BE/OPS

- [ ] Tách schema khởi tạo, migration nâng cấp và seed demo; không chạy `DROP`/`TRUNCATE` lên DB vận hành.
- [ ] Bổ sung khóa chống chạy migration đồng thời, kiểm tra phiên bản/checksum và xử lý migration thất bại.
- [ ] Chuẩn bị fixture riêng cho test và quy trình tạo quản trị viên đầu tiên không dùng mật khẩu mặc định công khai.
- **Kết quả:** quy trình cài mới/nâng cấp lặp lại được mà không mất dữ liệu.
- **Nghiệm thu:** cài mới, nâng cấp từ baseline và hai instance khởi động đồng thời đều có test; phục hồi thất bại có hướng dẫn.
- **Phụ thuộc:** T01–T02; mọi migration mới của các task sau tuân theo task này.

### Nhóm B — Tài khoản, phiên và phân quyền

#### T05 — Cập nhật trạng thái/quyền user nguyên tử · P0 · BE

Lượt T05 tiếp ngày 06/11 sửa request quản trị đã qua guard nhưng chờ khóa: sau khi người gửi bị thu hồi quyền hoặc khóa, transaction đọc lại actor và từ chối trước khi ghi. Đối chứng 2/8 → 8/8 nhóm API/DB; backend202/202/build, runtime LOGIN23/23, Edge integration26/26. [Bằng chứng T05](T05_USER_ADMINISTRATION_2026-11-06.md).

- [ ] Đưa cập nhật trạng thái, tăng token version, thu hồi phiên và audit vào cùng transaction.
- [ ] Bảo vệ quản trị viên đang hoạt động cuối cùng cả khi đổi role và vô hiệu hóa; dùng cơ chế khóa phù hợp cho thao tác đồng thời.
- [ ] Giữ ràng buộc Admin không kiêm Approver; kiểm tra scope hợp lệ, đơn vị còn hoạt động và thao tác tự thay đổi quyền.
- **Kết quả:** không có trạng thái user đã khóa nhưng phiên còn sử dụng được hoặc hệ thống mất toàn bộ admin.
- **Nghiệm thu:** test cập nhật đồng thời, rollback khi audit lỗi, token cũ và thay đổi scope đều đúng.
- **Phụ thuộc:** T02, T04.

#### T06 — Hoàn thiện đăng nhập và vòng đời phiên · P0 · BE/FE

- [ ] Kiểm thử bắt buộc đổi mật khẩu trên server, refresh rotation, logout và session hết hạn.
- [ ] Xử lý nhiều tab refresh đồng thời; xóa cache/dữ liệu người cũ khi đổi tài khoản và bỏ response đến muộn.
- [ ] Rà giới hạn thử đăng nhập, thời gian khóa, thông báo lỗi không tiết lộ tài khoản; cookie/origin theo từng môi trường.
- **Kết quả:** phiên ổn định, UI và backend thống nhất trạng thái đăng nhập.
- **Nghiệm thu:** tài khoản bị khóa/đổi quyền không tiếp tục thao tác; refresh không tạo vòng lặp hoặc làm lộ dữ liệu người trước.
- **Phụ thuộc:** T03, T05.

#### T07 — Cấp tài khoản và phục hồi truy cập · P1 · BE/FE/PO

Chủ dự án đã chọn người dùng tự yêu cầu đặt lại mật khẩu qua email. Security Admin thực hiện mời tài khoản.

Đã nối API, màn hình và hàng đợi email cho cả hai luồng. Link dùng một lần, có hạn và thu hồi phiên sau khi đổi mật khẩu. Còn cấu hình SMTP và nghiệm thu hộp thư tại môi trường triển khai. [Bằng chứng T07](T07_ACCOUNT_ACTIONS_2026-11-06.md).

- [ ] Chọn quy trình mời user/đặt mật khẩu ban đầu; không hiển thị hoặc gửi mật khẩu hiện có.
- [ ] Xây cơ chế đặt lại mật khẩu bằng token một lần, có hạn dùng, lưu dạng hash và thu hồi phiên sau khi đổi.
- [ ] Tạo màn hình nhận lời mời/đặt lại, chống dùng lại token, giới hạn tần suất và audit không chứa token.
- **Kết quả:** người dùng thật có thể nhận tài khoản và khôi phục truy cập; đây là bổ sung vận hành so với MVP.
- **Nghiệm thu:** link hết hạn/đã dùng không hoạt động; phản hồi không tiết lộ email có tồn tại; gửi qua T23–T25.
- **Phụ thuộc:** T05–T06, T23–T25; chủ dự án chốt ai được khởi tạo reset.

#### T08 — Quản lý đơn vị và phạm vi phụ trách · P1 · BE/FE

Đã tích hợp giao diện và API quản lý đơn vị, chuyển tài khoản, thu hồi phiên và bảo toàn phạm vi lịch sử. Đã kiểm trên stack cách ly. Còn rollout và UAT với dữ liệu tổ chức. [Bằng chứng T08](T08_DEPARTMENT_ADMINISTRATION_2026-11-06.md).

- [ ] Bổ sung tạo/sửa/ngừng hoạt động đơn vị nếu cần quản trị qua UI; không xóa đơn vị còn liên kết lịch sử.
- [ ] Chốt cách chuyển user giữa đơn vị và quyền với tài sản/yêu cầu đã tạo trước khi chuyển.
- [ ] Cập nhật scope Approver có kiểm soát; reset xác nhận trên form khi đổi user hoặc thay đổi nội dung.
- **Kết quả:** dữ liệu tổ chức không phụ thuộc seed thủ công; màn hình access phản ánh đúng quyền.
- **Nghiệm thu:** Approver không bị gán scope rỗng/vô hiệu; chuyển đơn vị không làm lộ dữ liệu hay mất audit.
- **Phụ thuộc:** T02, T05; đây là bổ sung để vận hành tổ chức thật.

### Nhóm C — Yêu cầu, xét duyệt và tính đúng đắn nghiệp vụ

#### T09 — Hoàn thiện nháp, gửi và hủy yêu cầu · P1 · BE/FE

06/11 đã có migration 009, API nháp theo owner và UI lưu/sửa/gửi/hủy. PostgreSQL runtime 23/23, Edge/Chrome UI mới 24/24 nhóm. Còn ma trận đầy đủ và nghiệm thu nghiệp vụ. [Bằng chứng T09](T09_REQUEST_DRAFTS_2026-11-06.md).

- [ ] Bổ sung DRAFT/save/edit/submit theo kế hoạch gốc, migration và quyền chủ sở hữu; chỉ submit mới vào hàng duyệt.
- [ ] Validation đầy đủ khi submit; lưu form khi lỗi có thể phục hồi; xử lý nhấn gửi hai lần.
- [ ] Làm rõ điều kiện hủy, lịch sử hủy và lý do; không hủy ngầm thao tác provider đã bắt đầu.
- **Kết quả:** vòng đời trước duyệt đầy đủ, người dùng không mất công nhập liệu.
- **Nghiệm thu:** nháp không được worker xử lý; user khác không đọc/sửa nháp; submit/hủy trùng không tạo tác động lặp.
- **Phụ thuộc:** T02–T04, T06. Nếu bỏ nháp khỏi R1 phải ghi quyết định giảm phạm vi, không đánh dấu đã làm.

#### T10 — Hoàn thiện tạo mới, gia hạn và thu hồi · P0 · BE/FE

- [ ] Áp validation tham số nhất quán cho tạo mới và gia hạn; xác định policy dùng cho gia hạn tài sản theo version cũ.
- [ ] Kiểm tra lại quyền, ownership, trạng thái và yêu cầu đang mở tại thời điểm tạo, duyệt và thực thi.
- [ ] Phân biệt thu hồi thường/khẩn; không mặc định mọi yêu cầu thu hồi là khẩn. Xác định lý do bắt buộc.
- **Kết quả:** ba luồng nghiệp vụ sử dụng cùng quy tắc rõ ràng, không thực thi trên tài sản không còn hợp lệ.
- **Nghiệm thu:** gia hạn/thu hồi cạnh tranh không gây kết quả trái nhau; lineage được giữ; không có bí mật trong payload/UI.
- **Phụ thuộc:** T02–T03, T09, T19; kiểm chứng cuối cùng sau T13–T16.

#### T11 — Hàng chờ và quyết định phê duyệt · P0 · BE/FE

- [ ] Hoàn thiện lọc khẩn, loại yêu cầu, đơn vị, trạng thái và thời gian bằng API; quy định sắp xếp ưu tiên.
- [ ] Bắt buộc lý do từ chối, kiểm tra phiên bản khi quyết định; hiển thị xung đột và tải lại dữ liệu khi người khác đã xử lý.
- [ ] Kiểm tra SoD/scope trên backend trong cùng transaction quyết định; thông báo và audit nhất quán.
- **Kết quả:** Approver thấy đúng hàng chờ và chỉ tạo được một quyết định hợp lệ.
- **Nghiệm thu:** hai người duyệt cùng lúc chỉ một quyết định thắng; tự duyệt/ngoài scope bị từ chối; filter không chỉ lọc một trang dữ liệu.
- **Phụ thuộc:** T05, T10, T17.

#### T12 — Chi tiết và theo dõi yêu cầu xuyên suốt · P1 · BE/FE

- [ ] Màn hình chi tiết lấy dữ liệu đầy đủ: người gửi, policy version, tham số, quyết định, tiến trình và tài sản kết quả.
- [ ] Hiển thị thời gian chính xác theo timezone, mã ngắn dễ đọc và UUID đầy đủ khi cần; bỏ nội dung xác nhận ghi cứng.
- [ ] Phân biệt chờ duyệt, đang xử lý, lỗi, cần đối soát và hoàn tất; hướng dẫn thao tác tiếp theo phù hợp quyền.
- **Kết quả:** người dùng hiểu yêu cầu đang ở đâu mà không cần đọc log backend.
- **Nghiệm thu:** reload/link trực tiếp giữ đúng ngữ cảnh; trạng thái UI khớp server; không hiển thị nút retry trước khi an toàn.
- **Phụ thuộc:** T09–T11, T15, T30.

### Nhóm D — Worker và provider an toàn

#### T13 — Sổ thao tác và idempotency provider · P0 · BE

- [ ] Tạo operation ID ổn định, bản ghi lần thực thi và kết quả; cùng thao tác luôn dùng cùng idempotency key.
- [ ] Chốt hợp đồng provider: cấp phát/thu hồi, tra cứu trạng thái bằng operation ID, timeout, mã lỗi và tham chiếu tài sản.
- [ ] Nếu provider không hỗ trợ chống lặp/tra cứu, thiết kế đường xử lý thủ công cho kết quả chưa rõ; không tự retry mù.
- **Kết quả:** có cách biết tác động ngoài hệ thống đã xảy ra hay chưa.
- **Nghiệm thu:** mô phỏng provider thành công nhưng phản hồi mất hoặc DB commit lỗi không tạo thêm tài sản khi phục hồi.
- **Phụ thuộc:** T03–T04, T10; cần hợp đồng nhà cung cấp cho chế độ thật.

#### T14 — Claim công việc, lease và phục hồi nhiều worker · P0 · BE

- [ ] Bổ sung lease/heartbeat và fencing hoặc cơ chế tương đương để worker cũ không ghi đè kết quả worker mới.
- [ ] Thay quy tắc đưa mọi Processing cũ về Approved bằng quy trình kiểm tra operation và đối soát trước khi nhận lại.
- [ ] Xử lý shutdown, lỗi kết nối DB, lỗi trước/sau claim; bảo đảm cờ chạy không bị kẹt khi lấy connection thất bại.
- **Kết quả:** worker phục hồi có kiểm soát khi restart hoặc chạy nhiều instance.
- **Nghiệm thu:** test crash tại các điểm trước gọi provider/sau provider/trước commit; kết quả cuối duy nhất và truy vết được.
- **Phụ thuộc:** T13.

#### T15 — Retry, lỗi cuối và đối soát thủ công · P0 · BE/FE

- [ ] Phân loại lỗi tạm thời, vĩnh viễn và kết quả chưa xác định; retry có giới hạn/backoff chỉ trên thao tác an toàn.
- [ ] Cập nhật trạng thái lỗi và audit nguyên tử; che chi tiết nhạy cảm từ response provider.
- [ ] Xây danh sách cần can thiệp, chi tiết lần thử và hành động đối soát/retry có phân quyền, xác nhận và lý do.
- **Kết quả:** request lỗi không bị bỏ quên hoặc được xử lý lại tùy tiện.
- **Nghiệm thu:** lỗi vĩnh viễn không retry vô hạn; tác vụ chưa rõ kết quả phải đối soát; hành động vận hành có audit.
- **Phụ thuộc:** T13–T14, T21.

#### T16 — Tích hợp một provider thật đã chọn · P0 khi dùng tài sản thật · BE/OPS

- [ ] Chọn một KMS/key provider và, nếu triển khai chứng thư thật, một CA phù hợp; ghi rõ loại tài sản được hỗ trợ.
- [ ] Runtime-validate response, tham chiếu, thuật toán, trạng thái và thời hạn thực tế; không dùng thời hạn tự tính thay chứng thư trả về.
- [ ] Cấu hình secret phía server, quyền tối thiểu và kiểm tra kết nối thực; thử tạo/gia hạn/thu hồi trong môi trường thử của provider.
- [ ] Chốt việc chuyển đổi/retire tài sản cũ sau gia hạn và trách nhiệm ứng dụng sử dụng khóa; không hứa tự chuyển mọi consumer.
- **Kết quả:** adapter đã kiểm chứng với dịch vụ thật; chế độ mock được gắn nhãn rõ và không âm thầm fallback.
- **Nghiệm thu:** đối chiếu tài sản/reference/trạng thái giữa Crypta và provider; không lưu/log private key; T13–T15 pass với adapter thật.
- **Phụ thuộc:** T13–T15, T19, T43; cần endpoint, quyền và ngân sách do chủ dự án cung cấp an toàn.

### Nhóm E — Tài sản, policy và audit

#### T17 — Danh sách phía server và phân trang · P1 · BE

- [ ] Thêm phân trang ổn định, tìm kiếm, sắp xếp và filter cho assets, requests, users, audit, notifications; giới hạn page size hợp lệ.
- [ ] Áp scope trước đếm/lọc/phân trang; bổ sung index theo truy vấn và kiểm tra query plan với fixture lớn.
- [ ] Tách thống kê tổng khỏi danh sách bị giới hạn; không tính tổng hệ thống từ 100/250 bản ghi mới nhất.
- **Kết quả:** hợp đồng danh sách thống nhất, không bỏ sót dữ liệu do giới hạn cố định.
- **Nghiệm thu:** tổng/filter đúng với fixture vượt giới hạn hiện tại; không trùng/mất bản ghi do thứ tự không ổn định; truy vấn trong ngân sách hiệu năng T50.
- **Phụ thuộc:** T03–T05.

#### T18 — Danh mục tài sản và lineage đầy đủ · P1 · BE/FE

- [ ] Bổ sung danh sách toàn hệ thống cho Admin và danh sách theo quyền cho User/Approver; phân biệt quyền xem với quyền yêu cầu thao tác.
- [ ] Kết nối timeline tài sản với request, quyết định, provider operation, gia hạn và tài sản tiền nhiệm/kế nhiệm.
- [ ] Thống nhất tên sự kiện giữa backend/UI, gồm sự kiện hết hạn; phân trang lịch sử thay vì âm thầm cắt 100 dòng.
- **Kết quả:** tài sản được truy vết từ yêu cầu ban đầu đến trạng thái hiện tại, không chỉ thấy các tài sản cần chú ý.
- **Nghiệm thu:** tạo → gia hạn → thu hồi/hết hạn hiển thị đúng chuỗi; kiểm tra quyền cho cả chi tiết và timeline.
- **Phụ thuộc:** T10, T12–T13, T17.

#### T19 — Quy tắc policy và phiên bản bất biến · P0 · BE

- [ ] Xác định tổ hợp loại tài sản/thuật toán/kích thước hoặc curve/mục đích sử dụng hợp lệ; không dùng cùng quy tắc kích thước cho mọi thuật toán.
- [ ] Kiểm tra validity, warning days, ngày hiệu lực; bảo đảm request giữ đúng snapshot/version đã được duyệt.
- [ ] Bảo vệ version đã sử dụng khỏi sửa/xóa; kiểm thử tạo version đồng thời và quy tắc policy hết hiệu lực.
- **Kết quả:** policy thực sự chi phối dữ liệu và cấp phát, không chỉ là form cấu hình.
- **Nghiệm thu:** tổ hợp không hỗ trợ bị từ chối; worker dùng đúng version; request cũ không tự đổi theo version mới.
- **Phụ thuộc:** T02–T04; dùng tài liệu chính thức của provider khi xác định tổ hợp hỗ trợ.

#### T20 — Quản trị vòng đời policy trên UI · P1 · BE/FE

- [ ] Hoàn thiện tạo policy gốc, tạo version, xem lịch sử/so sánh và ngừng áp dụng cho yêu cầu mới.
- [ ] Hiển thị version đang hiệu lực và thời điểm hiệu lực; nếu dùng hiệu lực tương lai, kiểm thử chuyển mốc thời gian.
- [ ] Cảnh báo ảnh hưởng tới yêu cầu mới và tài sản hiện có; không cho chỉnh trực tiếp version lịch sử.
- **Kết quả:** Admin quản lý policy không cần sửa SQL; số lượng policy không bị đếm thành số version.
- **Nghiệm thu:** hai Admin sửa đồng thời được báo xung đột; deactivate không làm mất lịch sử; UI phản ánh đúng effective version.
- **Phụ thuộc:** T19, T30.

#### T21 — Bao phủ audit và chống lộ thông tin · P0 · BE/OPS

- [ ] Lập danh mục sự kiện auth, request, decision, asset, policy, user, scope, job và thao tác vận hành; bổ sung phần thất bại/từ chối còn thiếu.
- [ ] Với thao tác thành công, ghi audit cùng transaction; với từ chối/rollback, có đường ghi bền vững phù hợp, không dựa vào transaction bị rollback.
- [ ] Thêm correlation ID và redaction; giữ trigger bất biến đã có, kết hợp quyền DB tối thiểu thay vì chỉ dựa trigger.
- **Kết quả:** truy vết đầy đủ nhưng không chứa mật khẩu, token, secret hoặc private key.
- **Nghiệm thu:** thử lỗi/rollback có dấu vết phù hợp; tài khoản runtime không sửa/xóa audit; kiểm tra metadata và log bằng fixture nhạy cảm giả.
- **Phụ thuộc:** T03–T05, T43.

#### T22 — Tra cứu audit phục vụ điều tra · P1 · BE/FE

- [ ] Thêm filter server theo actor, action, entity, kết quả, correlation ID và khoảng thời gian; sắp xếp/phân trang ổn định.
- [ ] Xây trang chi tiết sự kiện, thay đổi trước/sau đã lọc nhạy cảm và liên kết đối tượng còn được phép xem.
- [ ] Quy định retention, quyền truy cập và cách lưu trữ lâu dài; audit thao tác xuất ở X04 nếu bật.
- **Kết quả:** Admin tìm được toàn bộ diễn biến một sự cố mà không đọc log thô.
- **Nghiệm thu:** tìm thấy sự kiện ngoài trang đầu; dữ liệu không vượt scope/quyền; không có chức năng sửa/xóa audit trên UI.
- **Phụ thuộc:** T17, T21.

### Nhóm F — Email, thông báo và mốc hết hạn

#### T23 — Hoàn thiện hàng đợi email · P0 · BE

- [ ] Rà enqueue cùng transaction nghiệp vụ, dedup theo người nhận/sự kiện/kênh và claim nhiều worker.
- [ ] Phục hồi bản ghi Sending bị kẹt cả khi hệ thống đang chạy; phân biệt lỗi gửi chắc chắn với gửi xong nhưng chưa cập nhật DB.
- [ ] Dùng Message-ID ổn định khi phù hợp; mô tả giới hạn SMTP: không cam kết gửi đúng một lần tuyệt đối khi kết quả không xác định.
- **Kết quả:** thư không âm thầm mất; nguy cơ gửi lại được quản lý và quan sát.
- **Nghiệm thu:** test timeout/restart/hết lượt thử; không lấy dedup DB làm bằng chứng nhà cung cấp không gửi lặp.
- **Phụ thuộc:** T04, T21.

#### T24 — Mẫu thư và đường dẫn hành động · P1 · BE/FE

Lượt T24 tiếp ngày06/11 thêm tám mẫu thư nghiệp vụ có link/múi giờ và hai mẫu tài khoản chờ T07; worker enqueue kết quả cùng transaction qua migration010. Backend233/233, FE133/133/hai build, SMTP loopback10/10, preview20/20, link thật3/3, worker23/23, runtime LOGIN23/23, ledger10/10 và Edge26/26. [Bằng chứng T24](T24_EMAIL_TEMPLATES_2026-11-06.md).

- [ ] Viết HTML và plain-text cho yêu cầu, quyết định, kết quả xử lý, cảnh báo hết hạn và tài khoản.
- [ ] Cá nhân hóa đúng người nhận, escape nội dung người dùng, hiển thị timezone; link dùng APP_URL cấu hình và yêu cầu đăng nhập/phân quyền.
- [ ] Không đưa token phiên/private key vào thư; token mời/reset chỉ dùng cho đúng mục đích và có hạn dùng.
- **Kết quả:** thư rõ ai gửi, sự kiện gì, cần làm gì và liên kết tới đúng màn hình.
- **Nghiệm thu:** đọc được trên desktop/mobile, link đúng môi trường, thư không lẫn dữ liệu người khác; có preview kiểm thử.
- **Phụ thuộc:** T02, T12, T23.

#### T25 — Cấu hình và nghiệm thu SMTP thật · P1 · OPS/PO/QA

- [ ] Chủ dự án chọn dịch vụ, địa chỉ gửi và hộp thư thử; cung cấp credential qua cấu hình bí mật, không gửi vào chat/Git.
- [ ] Cấu hình TLS, danh tính gửi và các bản ghi domain theo yêu cầu nhà cung cấp; quyết định email lỗi làm readiness fail hay chạy suy giảm có cảnh báo.
- [ ] Với người nhận đã đồng ý, thử gửi, kiểm tra inbox/spam/header, link và log; nếu nhà cung cấp hỗ trợ bounce/webhook thì xác thực và ghi nhận.
- **Kết quả:** bằng chứng thư thực sự tới hộp thư, không chỉ API trả thành công hoặc SMTP nhận thư.
- **Nghiệm thu:** ít nhất luồng duyệt, cảnh báo và mời/reset đến đúng người; lỗi cấu hình được phát hiện; credential không xuất hiện trong bằng chứng.
- **Phụ thuộc:** T23–T24, T40, T43; chờ cấu hình ngoài không ngăn hoàn thiện phần khác.

#### T26 — Thông báo trong ứng dụng cho mọi vai trò · P1 · BE/FE

- [ ] Tạo trung tâm thông báo truy cập được ở User, Approver và Admin; sửa chuông không có đích tới phù hợp.
- [ ] Phân trang, unread count, đọc một/đọc tất cả và link tới đối tượng; xử lý đối tượng không còn quyền xem.
- [ ] Tách trạng thái đọc của in-app khỏi gửi email; cập nhật dữ liệu không gây reload toàn màn hình.
- **Kết quả:** mọi người nhận biết và theo dõi được sự kiện liên quan.
- **Nghiệm thu:** không đọc/đánh dấu thông báo người khác; count đúng sau tải lại; thông báo cũ vẫn truy cập được qua phân trang.
- **Phụ thuộc:** T06, T17, T23, T30.

#### T27 — Cảnh báo theo policy và cập nhật hết hạn · P0 · BE

- [ ] Thay mốc 30 ngày cố định bằng các ngưỡng `warning_days` của đúng policy version; chốt thông báo cho owner/Approver/Admin.
- [ ] Tách trạng thái ExpiringSoon khỏi lịch gửi từng ngưỡng; chống lặp theo tài sản/ngưỡng/người nhận/kênh.
- [ ] Xử lý UTC, đúng thời điểm hết hạn, downtime bỏ lỡ nhiều mốc và nhiều worker; không cảnh báo tài sản đã thu hồi/superseded sai quy tắc.
- **Kết quả:** cấu hình 30/7/1 ngày hoặc ngưỡng khác thực sự được áp dụng; trạng thái Expired đúng hạn.
- **Nghiệm thu:** fake clock kiểm tra trước/tại/sau mốc, chạy lặp và chạy đồng thời; downtime có hành vi catch-up được đặc tả, không bắn hàng loạt thư vô ích.
- **Phụ thuộc:** T02, T19, T23; nghiệm thu UC11–UC12 sau T48.

#### T28 — Màn hình vận hành email/job · P1 · BE/FE/OPS

- [ ] Hiển thị pending, đang chạy, thành công, lỗi cuối, tuổi công việc và lần chạy gần nhất; thống kê email chỉ đếm kênh EMAIL.
- [ ] Thêm tra cứu lần thử, chẩn đoán đã redaction và retry được kiểm soát; cảnh báo backlog hoặc worker không hoạt động.
- [ ] Giới hạn tần suất và audit chức năng gửi email thử; chỉ vai trò phù hợp được thao tác.
- **Kết quả:** quản trị phát hiện và xử lý lỗi gửi/xử lý mà không sửa DB trực tiếp.
- **Nghiệm thu:** gây lỗi giả có cảnh báo đúng; retry không vượt quy tắc T15/T23; UI không ghi “đã kết nối” chỉ dựa vào cấu hình.
- **Phụ thuộc:** T15, T23, T25–T27, T44.

### Nhóm G — Hoàn thiện giao diện và trải nghiệm

Nhóm này dùng checklist enterprise UI/UX: ưu tiên hoàn thành công việc, trạng thái phục hồi, khả năng truy cập và dữ liệu thật. Giữ hướng giao diện đã được duyệt; thay đổi lớn về điều hướng/ngôn ngữ thiết kế cần preview riêng và chủ dự án duyệt trước khi tích hợp.

#### T29 — Dashboard và biểu đồ đúng dữ liệu · P1 · BE/FE

- [ ] Loại tên, đơn vị, xác nhận và chỉ số ghi cứng; tính thống kê từ truy vấn tổng hợp theo role/scope.
- [ ] Hoàn thiện biểu đồ đường theo thời gian, cột theo nhóm và tròn/phân bổ khi có ý nghĩa; thống nhất khoảng ngày, nhãn, đơn vị và tooltip.
- [ ] Quy định chỉ số SoD và sức khỏe dịch vụ: không hiển thị “0 phát hiện”/“đã kết nối” khi chưa có dữ liệu kiểm chứng.
- **Kết quả:** tổng quan giúp quyết định việc cần làm, không chỉ trang trí.
- **Nghiệm thu:** đối chiếu số tổng với fixture và bảng chi tiết; có trạng thái 0 dữ liệu/lỗi/một phần; không suy tổng từ trang đầu.
- **Phụ thuộc:** T17, T21, T27, T44.

#### T30 — Dashboard theo trang với client-side routing · P1 · ƯU TIÊN THỰC HIỆN SỐ 1 · FE/QA, BE hỗ trợ hợp đồng

**Trạng thái ngày 28/09/2026:** đang triển khai. Lát cắt router/menu/page đầu tiên, route guard, deep link, data ownership bước đầu, test route và browser review Admin đã có; chưa đủ Definition of Done. Các khoảng trống còn lại và bằng chứng chạy được ghi trong `IMPLEMENTATION_TRACKER.md`. Đây là phần mở rộng của T30 hiện có, không tạo một task cạnh tranh hoặc đánh lại số T01–T54.

**Hành vi đích đã được chủ dự án chấp nhận:** bấm menu → URL và vùng nội dung chính chuyển sang màn hình tương ứng; sidebar/header giữ cùng khung. Bấm Người dùng chỉ thấy màn hình người dùng; bấm Chính sách chỉ thấy màn hình policy. Trang danh sách vẫn được cuộn nếu nội dung dài, nhưng chuyển menu không cuộn tới section của một dashboard dài. Giữ theme sáng/tối, lớp bóng, typography và accent dark đã duyệt.

##### T30.0 — Căn cứ và quyết định kiến trúc

| Căn cứ đã đọc trong mã nguồn | Ý nghĩa đối với triển khai |
| --- | --- |
| `frontend/src/main.tsx` chỉ render `App`; `frontend/package.json` chưa có router/test runner frontend | Cần thiết lập router và công cụ test phù hợp, kiểm tra phiên bản tương thích React 18/Node đang dùng trước khi cài |
| `App.tsx`: `scrollTo`, `scrollToElement`, sidebar active cố định | Chuyển menu/liên kết nội bộ sang route; giữ anchor skip-link cho trợ năng |
| `App.tsx`: `loadData()` gom assets/requests/policies/dashboard/notifications trong `Promise.all` | Tách tải dữ liệu theo trang và dữ liệu chung; lỗi một trang không làm toàn ứng dụng báo lỗi |
| `AdminDashboard` ghép PolicyManager, AccessManager, email, assets, users, audit | Tách từng nhóm ra page; dashboard chỉ còn tổng quan và liên kết tác vụ |
| `ApproverDashboard` ghép tổng quan, queue, chi tiết và lịch sử ngắn | Tách queue và lịch sử; quyết định lấy version từ chi tiết hiện tại, không phụ thuộc mảng requests tổng |
| User assets còn lọc danh sách tải ban đầu; các bảng Admin đã có API phân trang | Dùng API phân trang hiện có cho trang mới; không coi chuyển router là đã hoàn thành T17/T31 |
| `api.ts` có access token trong bộ nhớ, refresh dùng promise chung; chưa truyền signal qua các hàm nghiệp vụ | Giữ cơ chế phiên; bổ sung khả năng hủy GET và loại response cũ, kiểm tra không hủy refresh chung do một page unmount |
| `frontend/nginx.conf`: `/api/` proxy riêng; `/` có `try_files ... /index.html` | Có nền tảng cho deep link; phải kiểm chứng F5/link trực tiếp trên bản build phục vụ qua Nginx |

**Lựa chọn kỹ thuật cho đợt này:** React Router Data Mode (`createBrowserRouter` + `RouterProvider`), layout lồng nhau với `Outlet`, `NavLink` cho menu. Dùng route objects trong dự án Vite hiện tại; không cần đổi sang SSR hoặc React Router Framework Mode. Data Mode phù hợp nhu cầu route error, loader và chặn chuyển trang khi form chưa lưu. Đây là lựa chọn thiết kế của Crypta; phiên bản package/import cụ thể phải được đối chiếu engine/peer dependencies và khóa trong lockfile khi triển khai. Không nâng React/Vite/Node đồng loạt chỉ để thêm router.

Phân biệt router với API: URL `/users` là trang frontend, dữ liệu vẫn lấy từ `/api/v1/users`. Backend tiếp tục quyết định quyền thật và scope. Chưa cần migration database cho riêng việc chuyển điều hướng.

##### T30.1 — Ma trận trang, quyền và chuyển tiếp

Quyền dưới đây là dự kiến hiển thị theo quyền hiện có, không mở rộng quyền nghiệp vụ. T30-B phải đối chiếu endpoint thực tế và ghi rõ sai khác trước khi nối page; không giả định frontend đổi role sẽ đổi scope backend.

| URL đích | Vai trò / điều kiện | Nội dung và nguồn tái sử dụng | Hành động chính |
| --- | --- | --- | --- |
| `/login` | Chưa đăng nhập | LoginScreen, thông báo hết phiên | Đăng nhập; trở lại URL nội bộ hợp lệ sau xác minh phiên |
| `/change-password` | Phiên có `mustChangePassword` | Form đổi mật khẩu bắt buộc | Đổi mật khẩu hoặc đăng xuất; chưa tải page nghiệp vụ |
| `/` | Theo trạng thái phiên | Redirect bằng replace | Guest → login; bắt buộc đổi mật khẩu → change-password; còn lại → dashboard |
| `/dashboard` | USER / APPROVER / ADMIN hợp lệ | Tổng quan riêng theo vai trò, biểu đồ, cảnh báo ngắn | Đi tới tác vụ; không ghép toàn bộ bảng quản trị bên dưới |
| `/assets` | Theo quyền API hiện có | User asset list / AdminAssetsTable; scope theo phiên | Tìm/lọc/xem chi tiết; gia hạn/thu hồi chỉ khi được phép |
| `/assets/:assetId` | Người được API cho xem | AssetDrawer + AssetHistory chuyển thành nội dung chi tiết route | Xem lịch sử/lineage; trở lại danh sách giữ query |
| `/requests` | Người được API cho xem | UserRequestHistory và danh sách theo scope | Xem toàn bộ yêu cầu; tạo nếu role cho phép |
| `/requests/new` | Người được phép tạo; Admin bị chặn | RequestModal tái sử dụng form trong page | Tạo yêu cầu, xử lý lỗi, chuyển tới kết quả |
| `/requests/:requestId` | Theo scope API | RequestDrawer lấy bằng ID trực tiếp | Theo dõi; hủy/duyệt/từ chối chỉ khi quyền và trạng thái cho phép |
| `/approvals` | APPROVER, loại trừ ADMIN theo SoD hiện tại | Phần queue của ApproverDashboard | Lọc hàng chờ, mở yêu cầu để quyết định |
| `/approvals/history` | APPROVER | Danh sách xử lý theo scope bằng API requests | Tra cứu vượt giới hạn 3 dòng cũ; nhãn không nhận là “tôi đã xử lý” nếu API chưa lọc decision actor |
| `/users` | ADMIN | AdminUsersTable | Tìm/lọc tài khoản; tạo hoặc đổi trạng thái qua form hiện có |
| `/users/access` | ADMIN | AccessManager | Quản lý role/scope; menu cha Người dùng vẫn active |
| `/policies` | ADMIN | PolicyManager và thông tin phiên bản cần thiết | Xem/phát hành phiên bản; giữ yêu cầu quản trị vòng đời còn thiếu ở T20 |
| `/audit` | ADMIN | AdminAuditTable | Tra cứu nhật ký theo bộ lọc API đang hỗ trợ |
| `/notifications` | Mọi vai trò đăng nhập | NotificationPanel | Đọc/đánh dấu đọc; mở đối tượng qua route kiểm tra quyền |
| `/operations/email` | ADMIN | AdminEmailIssues + thông tin cấu hình/gửi thử hiện có | Tra cứu email lỗi/cần đối soát; không bổ sung retry ngoài quy tắc T23 |
| `/forbidden`, route `*` | Theo trạng thái phiên | Màn hình không có quyền / không tìm thấy | Có đường về trang hợp lệ; không đưa nội dung đối tượng bị từ chối vào lỗi |

Không tạo Products/Reports chỉ vì xuất hiện trong sơ đồ minh họa. Menu “Chính sách” dùng `/policies`, không đổi tên thành Settings chung. Trang Settings tổng hợp chỉ làm khi có phạm vi nghiệp vụ riêng. Help có thể giữ dialog; đổi theme, đăng xuất, gửi thử là action, không bắt buộc biến thành route.

Các route chi tiết dùng màn hình riêng trong đợt đầu để deep link/reload có một hành vi rõ ràng. Component nội dung được tái sử dụng từ drawer; không render đồng thời hai bản form/dialog. Phương án drawer có URL/background location có thể bổ sung sau, không là điều kiện để đóng T30.

##### T30.2 — Quy ước URL, phiên và dữ liệu

- URL là nguồn chuẩn cho trạng thái tra cứu đã áp dụng: `q`, `page`, `pageSize`, `status`; thêm filter chỉ khi endpoint hỗ trợ. Quy định parser có default, giới hạn và enum; loại tham số không hợp lệ theo cùng một quy tắc. Không gửi sort giả xuống API chưa hỗ trợ.
- Chữ đang gõ giữ tại form tìm kiếm; khi áp dụng mới cập nhật URL và đặt page=1. Chọn page/filter tạo history hữu ích; chuẩn hóa URL dùng replace. Không thêm một history entry cho mỗi phím gõ.
- Link từ danh sách sang chi tiết mang `returnTo` nội bộ đã kiểm tra; khi vào chi tiết trực tiếp, nút quay lại dùng danh sách mặc định. Không gọi `navigate(-1)` vô điều kiện vì tab có thể vừa mở từ website khác.
- `returnTo` chỉ cho đường dẫn nội bộ được router nhận diện; chặn URL tuyệt đối, `//host`, scheme và biến thể mã hóa không hợp lệ. Đích quay lại vẫn phải qua kiểm tra phiên/quyền. Không đưa token, mật khẩu hoặc nội dung form vào URL.
- Gia hạn/thu hồi có thể mở `/requests/new?type=RENEW&assetId=...` hoặc `REVOKE`; đọc lại asset từ API, kiểm tra quyền/trạng thái, không tin tham số URL là bằng chứng cho phép thao tác.
- Auth boundary có trạng thái khôi phục phiên → bắt buộc đổi mật khẩu → hợp lệ/guest. API nghiệp vụ và loader phải chờ cùng lời hứa khôi phục phiên; chỉ bọc UI bằng guard không ngăn được loader con chạy sớm.
- Giữ active role chỉ trong tập role server cấp. Với nhiều role, chọn role phù hợp route nếu được cấp; chuyển role tới trang không phù hợp thì replace về dashboard. Không ghi role từ URL/localStorage thành quyền backend. Chính sách API vẫn có thể hợp nhất quyền server; ghi rõ điểm này trong kiểm thử.
- Trạng thái UI như mở menu/theme/toast nằm ở shell; filter ở URL; dữ liệu server thuộc page/resource; trạng thái form thuộc form. Không dùng `assets` array làm tín hiệu reload cho mọi component như hiện tại.
- GET chuyển route nhanh: truyền AbortSignal xuyên lớp API, phân biệt AbortError với lỗi mạng và bỏ response đến muộn. Mutation đã gửi không mặc định bị hủy ở server khi rời trang; giữ trạng thái chưa rõ kết quả và làm mới bằng GET, không tự POST lại.
- Sau mutation, làm mới đúng resource liên quan và badge chung. Ví dụ tạo user → users; đổi role → users/access và phiên nếu liên quan; quyết định → request detail/queue/count/thông báo. Cấp phát chạy nền chỉ cập nhật asset/dashboard khi server xác nhận, không suy ra asset đã có từ việc duyệt thành công.
- Query/cache nếu có phải phân biệt user, role hiển thị, scope và tham số URL; xóa khi logout/đổi tài khoản/mất quyền. Đợt đầu dùng loader/API service hiện có và revalidation có chủ đích; không đưa thêm cache framework nếu chưa cần.

##### T30.3 — Các việc triển khai, đầu ra và điều kiện đóng

**T30-A — Baseline giới hạn và bản đồ phụ thuộc · FE/QA · đầu tiên**

- [ ] Kiểm kê dirty worktree; ghi các thay đổi hiện có và không gộp/sửa ngoài phạm vi. Ghi riêng thay đổi dở `backend/src/requests/request-policy.ts` từ task đã bị dừng: chưa có test/build cho thay đổi đó, không gắn kết quả 61 test cũ vào HEAD hiện tại.
- [ ] Chạy build frontend baseline; ghi lỗi vốn có và môi trường chạy. Chỉ sửa lỗi nền trực tiếp chặn T30 với phạm vi rõ ràng; T19 đang dừng không tự được mở lại bởi task lập kế hoạch này.
- [ ] Liệt kê tất cả `scrollTo`/`scrollToElement`, action trong sidebar/header/dashboard/notification, modal và nơi dùng `loadData`/`refreshKey`/mảng requests cho quyết định.
- **Bàn giao:** bảng nguồn component → page → API → action → test, kèm baseline Git/build.
- **Đạt khi:** mọi điểm điều hướng hiện có được gán đích hoặc được xác định rõ là action; không bỏ quên role nào. **Phụ thuộc:** mã nguồn hiện tại, phần tối thiểu T01.

**T30-B — Chốt ma trận route/quyền/hợp đồng · FE/BE**

- [ ] Đối chiếu bảng T30.1 với guards/scope và response thực tế; bổ sung DTO cần cho page, ID đầy đủ, status và version dùng quyết định.
- [ ] Chốt route mặc định, route chi tiết, ánh xạ menu active và query parser. Request mới phải được phân biệt với `:requestId`.
- [ ] Ghi khoảng trống API hiện hữu thành phụ thuộc cụ thể; không đợi hoàn thành toàn bộ T02/T03/T06 mới bắt đầu router. Chỉ làm adapter/hợp đồng tối thiểu cần cho trang.
- **Bàn giao:** route manifest có path, title, menu group, vai trò được phép, API và lỗi; bảng query có ví dụ URL. **Đạt khi:** từng route có chủ sở hữu dữ liệu/quyền và đường phục hồi. **Phụ thuộc:** A.

**T30-C — Mẫu tương tác để review · FE/QA**

- [ ] Tạo preview tách biệt cho shell + dashboard/users/policies, chuyển main content và active menu; có populated/loading/empty/error để review.
- [ ] Dùng token/component hiện tại, kiểm tra light/dark và menu mobile; giữ bản mặc định hoạt động trong thời gian preview.
- [ ] Ghi kết quả review theo hướng điều hướng đã được chấp nhận; nếu đề xuất thay đổi lớn khác về workflow/visual thì trình riêng trước khi tích hợp. Không yêu cầu duyệt lại nguyên tắc chuyển trang đã được chủ dự án chốt.
- **Bàn giao:** URL/cách mở preview, ảnh các trạng thái và ghi nhận review. **Đạt khi:** bấm menu chỉ đổi main, bố cục/theme giữ đúng hướng hiện tại. **Phụ thuộc:** B.

**T30-D — Router và shell chung · FE**

- [ ] Kiểm tra engine/peer deps, thêm router phù hợp và lockfile; tạo route objects, AppShell/sidebar/header/main/footer, Outlet và error boundary.
- [ ] Đưa theme, menu mobile, profile, toast, help vào cấp sống xuyên route; đăng ký title/breadcrumb từ route manifest.
- [ ] Đổi menu sang NavLink; active đúng route con, có `aria-current`, hỗ trợ mở tab mới. Đóng menu mobile khi chuyển trang thành công; giữ khi điều hướng bị chặn vì form chưa lưu.
- **Bàn giao:** shell và router có page khung; `App.tsx` chỉ còn wiring phù hợp. **Đạt khi:** chuyển menu không reload document hoặc gọi scroll tới section nghiệp vụ; Tổng quan không active cố định. **Phụ thuộc:** B–C.

**T30-E — Phiên và quyền tại route · FE/QA**

- [x] Chuyển restore/login/logout/đổi mật khẩu bắt buộc sang session boundary dùng chung; tránh flash dữ liệu trước xác minh phiên. Bằng chứng: unit API generation/shared refresh và browser guest deep link/password gate/restore outage trên production preview; còn integration server ở M.
- [x] Bổ sung safe returnTo, forbidden/not-found, xử lý 401/403, tài khoản nhiều role và route không phù hợp; kiểm tra loader chờ auth theo T30.2. Bằng chứng local: phiên/deep link/role/blocker, detail 403, personal projections theo user của phiên; SoD xét tập role đã cấp, không chỉ role UI. Browser không tải page nghiệp vụ trước password/auth gate; mock Pool kiểm tra object/list scope. Còn integration JWT/cookie/DB tại M.
- [x] Logout/mất quyền phải xóa dữ liệu, selection và form chứa thông tin nhạy cảm; không để blocker form ngăn người dùng đăng xuất theo ý muốn hoặc ngăn xử lý phiên bị thu hồi. Browser fixture kiểm tra expiry dirty request, logout dirty policy và thu hồi role; API unit xác minh bỏ phản hồi cũ, không retry mutation của scope cũ.
- Tiến độ E ngày 30/09: safe returnTo giữ deep link/query; đổi role được cấp chỉ áp dụng sau blocker, refresh lỗi dịch vụ giữ form và có retry restore. Dashboard kiểm tra role được cấp; list cá nhân dùng ownedOnly/createdByMe; SoD/ownership/creator/department/version điều khiển action. Đã đối chiếu object/list scope và kiểm tra local; còn JWT/cookie rotation/nhiều tab/DB thật. Các hành động E có bằng chứng local, chưa nghiệm thu tích hợp. Chi tiết ở [bằng chứng T30](T30_PROGRESS_2026-09-30.md).
- **Bàn giao:** route/session guards và test hành vi phiên. **Đạt khi:** deep link hợp lệ trở lại đúng trang sau login; URL không cấp thêm quyền và không tạo vòng redirect. **Phụ thuộc:** D, hợp đồng phiên hiện có ở T06.

**T30-F — Tách page và phân phối dữ liệu · FE**

- [x] Tách pages/features/shared hooks/API types theo tính năng; di chuyển component trước rồi sửa hành vi từng lát cắt để dễ đối chiếu. Page/dashboard/policies/request/detail tách khỏi App; hook resource/session/URL riêng; response contracts theo assets/requests/notifications/users/policies/audit/dashboard trong `frontend/src/api/contracts`. Build TypeScript strict đạt; không coi đây là nghiệm thu integration M.
- [x] Chuyển tải dữ liệu vào page/loader, có trạng thái lỗi riêng; shell chỉ tải thông tin chung cần thiết. Không vừa useEffect vừa loader gọi trùng cùng resource. Bằng chứng local: GET ownership qua Users/Policies/Assets/Audit, dashboard không kéo queue/bảng, shell chỉ summary/unread giữ qua route; bảng ownership ở report. Còn integration M.
- [x] Thêm signal và kiểm soát response cũ; duy trì cơ chế refresh dùng chung, không chuyển token sang localStorage. Thay `refreshKey={assets}` bằng revalidation/resource revision có chủ đích. `useResource` theo key/revision, cleanup abort và guard; API session generation/shared refresh. Browser query trễ sau Back và unit transport bỏ qua abort đã đạt; không suy là cookie/DB đã nghiệm thu.
- Tiến độ F ngày 30/09: `App` không còn tải dashboard/policies/assets; từng page/bảng/reference sở hữu resource và response types theo tính năng. Loading/error/empty riêng, dữ liệu chưa biết không hiện 0; retry giữ draft khi 503, bỏ khi 403. Dashboard User dùng aggregate toàn owner và priority ID ngoài 250. Ba hành động F có bằng chứng local; còn các cổng E/M, chưa đóng T30.
- **Bàn giao:** page API/types có ownership rõ; request network theo page. **Đạt khi:** mở Users không tải bảng Audit/Policy/Assets chỉ vì cùng dashboard; lỗi Audit không làm Users hỏng. **Phụ thuộc:** D–E.

**T30-G — Các trang Admin · FE/QA**

- [ ] Chuyển users/access/policies/assets/audit/email thành các page của T30.1; giữ nguyên chức năng tạo tài khoản, trạng thái, role/scope, phát hành version và gửi thử.
- [ ] Dashboard Admin giữ số liệu/biểu đồ/cảnh báo ngắn; card đi tới page và filter tương ứng. Đưa summary policy vào đúng page, tránh hiển thị hai vùng quản lý trùng nhau.
- [ ] Sau mỗi thao tác, cập nhật page và chỉ số liên quan; cảnh báo 409 giữ dữ liệu form và cho tải lại; lỗi 403 về trạng thái đúng quyền.
- **Bàn giao:** toàn bộ menu Admin hoạt động theo route. **Đạt khi:** từng page làm được thao tác hiện có và không cần cuộn sang phần khác để hoàn thành. **Phụ thuộc:** F.

**T30-H — Các trang User và Approver · FE/QA**

Tiến độ 30/09: User assets/requests và selector có projection cá nhân phía server cho tài khoản nhiều role. Detail chỉ bật action với owner/creator/department/state/version đã xác nhận; ADMIN trong tập role không tạo hoặc duyệt dù đổi role hiển thị, Approver không tự duyệt. Browser/units đạt; vẫn cần các ca SoD/concurrency/UI → DB ở M trước nghiệm thu.

- [ ] Tách dashboard User/assets/requests/create/detail; dùng API phân trang hiện có cho danh sách và bộ chọn tài sản, tránh chỉ chọn được tài sản trong trang đầu.
- [ ] Tách queue/history của Approver; chuyển mọi link chi tiết về request ID. Dữ liệu quyết định/version lấy từ API chi tiết hoặc row đang chọn, không tìm trong mảng requests giới hạn của App.
- [ ] Giữ SoD, trạng thái cho phép, lý do từ chối, xử lý stale version và tự duyệt; không tự đổi quy tắc nghiệp vụ khi di chuyển form.
- **Bàn giao:** route thực hiện được tạo/gia hạn/thu hồi, xem, duyệt/từ chối theo chức năng hiện có. **Đạt khi:** yêu cầu ngoài trang đầu vẫn mở và quyết định đúng version; Admin không có action tạo/duyệt. **Phụ thuộc:** F, API scope hiện có; thiếu hợp đồng ghi vào T03/T10/T11.

**T30-I — Query, chi tiết và đường quay lại · FE/QA**

- [x] Parser URL của các bảng danh sách giữ q/status/page/pageSize và filter API hỗ trợ; normalize bằng replace, đổi filter/size về page 1. Browser fixture giữ context qua detail/Back/Forward/F5 và sửa page Users vượt tổng sau mutation bằng replace. Selector/form/timeline giữ paging nội bộ; còn integration M.
- [x] Chi tiết đọc ID từ API khi direct link/F5; fixture kiểm tra ID sai, 403/404, return mặc định và lineage bằng ID ngoài danh sách. Safe return theo user/role; object scope trên DB thật còn ở M.
- [x] Chỉ `useWorkspaceScroll` sở hữu scroll; chuyển page về đầu, Back chờ hàng tải để khôi phục. Query cũng chờ bảng đủ chiều cao, đặt đầu bảng dưới topbar và không cướp focus. Browser Back/query/pageSize và rà soát scrollTo đã đạt local.
- **Bàn giao:** URL tái lập được ngữ cảnh và history nhất quán. **Đạt khi:** Back/Forward/F5 giữ query đúng, không quay ra site ngoài khi bấm nút “Về danh sách”. **Phụ thuộc:** G–H.

**T30-J — Tìm kiếm, thông báo và action liên trang · FE**

- [x] Global search mở route+query của trang hỗ trợ (assets/requests/users/audit/queue/history), giữ filter/pageSize và bỏ page cũ; dashboard fallback theo role/quyền thật. Unit và browser context đã đạt.
- [x] Topbar ghi nhãn đích cụ thể trên cả trang không có search; không báo “đã lọc” trước khi áp dụng. Browser kiểm tra Users/Assets/Requests/History và Policies → Audit; SoD fallback có unit test.
- [x] Chuông mở notifications; card mở status/emergency phù hợp. Browser fixture ba role mở ID ngoài page 1, giữ lỗi 403/404/missing target và không mark read khi mở thất bại; mark one/all cập nhật tổng unread 15→14→0 khi đang page 2. Còn integration quyền/cookie/DB tại M.
- **Bàn giao:** không còn liên kết nghiệp vụ phụ thuộc section id; danh mục action đã kiểm tra hết. **Đạt khi:** mở thông báo ngoài trang đầu/mất quyền có hành vi rõ, link không im lặng thất bại. **Phụ thuộc:** G–I.

**T30-K — Form chưa lưu và kết quả thao tác · FE/QA**

- [x] Dirty request/user/access/policy theo giá trị ban đầu; blocker ở lại/bỏ thay đổi, target/policy switch không ghi đè draft. Browser fixture Back/create-user/local close, request/access/role blocker và native reload đạt; chọn policy mặc định tương thích không tạo dirty giả. Dialog đóng sau route commit.
- [x] beforeunload chỉ khi dirty; browser Edge xác nhận native reload ở lại giữ input và khôi phục giá trị gỡ cảnh báo ở bốn form. Draft không vào URL/storage. Đã chạy lại native reload trên Edge và Chrome ngày 01/10; chưa thử đóng tab thủ công; giới hạn cảnh báo và không hứa phục hồi đã ghi ở README/report.
- [x] Form đang gửi có trạng thái rõ; không ghi thành công trước acknowledgment hợp lệ; đóng/rời page không tự thử lại POST. Pending/unknown được journal theo user/key, có GET kiểm tra và gỡ theo dõi thủ công sau cảnh báo. Callback cũ không đóng form mới, xác nhận muộn chỉ revalidate đúng nguồn. Bằng chứng local NAV-21 và 106 browser cases trên Edge/Chrome; còn server/DB/concurrency tại M.
- Lịch sử I/J/K 30/09: query/history/search/card/unread/dirty/beforeunload có bằng chứng local; K còn mutation mất mạng/rời page/kết quả chưa rõ và GET kiểm tra NAV-21. Frontend 104/104, backend 86/86 unit test và hai build đạt; 78/78 browser HTTP fixture. Các checkbox implementation không thay nghiệm thu tích hợp M hoặc đóng T30.
- Cập nhật K 01/10: NAV-21 có implementation và bằng chứng local cho 9 loại ghi, lỗi/unknown/reopen/late response/logout; không coi GET dữ liệu hiện tại hoặc gỡ theo dõi là xác nhận lần gửi cũ. Journal mất khi reload/tab đóng; M tích hợp vẫn mở. Xem [báo cáo mới](T30_PROGRESS_2026-10-01.md).
- **Bàn giao:** quy tắc dirty/pending/error/success cho từng form. **Đạt khi:** Back/menu/mobile/đóng dialog không làm mất dữ liệu âm thầm trong các tình huống được hỗ trợ. **Phụ thuộc:** G–I.

**T30-L — Trợ năng, responsive và theme · FE/QA**

- [ ] Mỗi page có heading/title đúng; focus tới heading/main khi chuyển page bằng menu, nhưng không cướp focus khi chỉ lọc bảng; thông báo chuyển trang cho công nghệ hỗ trợ.
- [ ] Kiểm tra skip-link, focus khi đóng dialog, active menu, tooltip, loading/error/retry, chuỗi tiếng Việt dài; menu mobile giữ focus đúng sau đóng/mở.
- [ ] Review ở 1440/1024/768/390 px, zoom 200%, light/dark và reduced motion; không che nút chính, không tạo hai thanh cuộn dọc toàn trang ngoài chủ đích.
- **Bàn giao:** ảnh review và checklist bàn phím theo page, danh sách lỗi đã sửa. **Đạt khi:** dùng được các luồng chính không cần chuột và giữ nhận diện UI đã duyệt. **Phụ thuộc:** G–K; đóng phần T33/T34 liên quan, không tự đóng toàn bộ hai task đó.

**T30-M — Kiểm thử, triển khai và khả năng quay lại · FE/QA/OPS**

- [ ] Thêm test frontend hành vi bằng Vitest/React Testing Library và E2E bằng Playwright nếu baseline chưa có; chọn phiên bản tương thích, thêm script rõ trong package/CI. Mock API chỉ cho test UI, DB test cách ly cho E2E tích hợp.
- [ ] Chạy ma trận T30.4, frontend production build và Nginx deep-link smoke; lưu kết quả/trace khi lỗi, không reset database vận hành. Không gửi email thật hoặc gọi provider thật từ fixture điều hướng.
- [ ] Tích hợp từng lát cắt sau preview; ghi revision trước/sau và cách dùng lại artifact frontend trước nếu lỗi. Không rollback bằng lệnh xóa thay đổi working tree; không cần rollback DB riêng cho router.
- [ ] Xóa nhánh scroll/menu cũ sau khi thay thế đầy đủ; giữ skip-link hợp lệ. Cập nhật README, tracker, hướng dẫn URL/role/test và các ảnh bàn giao; không giữ hai cơ chế điều hướng cạnh tranh trong bản mặc định.
- **Bàn giao:** test report, build, bằng chứng browser/Nginx và hướng dẫn vận hành. **Đạt khi:** mọi test bắt buộc đạt; nếu Docker/DB không sẵn sàng, ghi “Chờ kiểm thử tích hợp”, không đánh dấu T30 hoàn tất. **Phụ thuộc:** A–L và N (motion bắt buộc; shared element nâng cao không chặn).

Cập nhật mới nhất 01/10: N4 thêm Requests/Notifications/history, 174/174 fixture mỗi Edge/Chrome; zoom Chrome thật 200% 6/6 và sửa focus bị panel cắt. 18/18 nhóm tích hợp thật mỗi browser trên DB riêng, gồm hai Approver khác nhau chỉ ghi một decision/audit; Nginx 17/17 bundle cuối, API smoke 13 lúc khởi tạo. FE 123/123/hai build đạt, backend giữ nguyên source đã có 89/89/build. Stack test đã dọn, vận hành giữ nguyên. Motion setup sang frame trước paint; trace cuối 72/72 setup root dưới 33.1 ms, shift on/off bằng nhau, còn layout/paint Users dài và N6 chưa nghiệm thu. Chưa đóng M/N/T30: còn N4 states/detail, zoom Edge/screen reader, hiệu năng và đủ NAV. [Bằng chứng mới](T30_PROGRESS_2026-10-01_N4_ZOOM_N6.md), [M/N4 trước đó](T30_PROGRESS_2026-10-01_M_N4.md).

**T30-N — Hiệu ứng chuyển trang SPA mượt, nhanh, có trợ năng · FE/QA · bổ sung 28/09/2026**

Lịch sử 30/09: entrance fade 160 ms ở main, pending 180 ms, reduced-motion/fallback; AppShell/Outlet, detail/query/return/scroll đã có bằng chứng. E/F bổ sung session boundary, role blocker, resource/page ownership và dashboard toàn owner; I/J/K bổ sung pageSize/focus/query scroll chờ hàng tải, search/card và dirty/native reload. Frontend 104/104, backend 86/86 unit test và cả hai production build mới đạt; 78/78 browser regression bằng HTTP fixture. Đã kiểm tra reduced-motion trước phiên và query/theme không replay motion; chưa hoàn tất N2/N4/N5/N6 hoặc NAV-23…30 (còn giữa phiên, browser thứ hai, 10 lần chuyển nhanh, CPU/performance trace và deployment/DB). Không dùng code hoặc fixture làm bằng chứng nghiệm thu thật. Xem [bằng chứng mới](T30_PROGRESS_2026-09-30.md) và tracker cho phần còn thiếu.

Lịch sử N trước lượt M/N4 01/10: token fast/page/overlay và motion matrix đã có implementation/bằng chứng; 3 lỗi L đã sửa và 24 tổ hợp role/theme/viewport đạt. Frontend 123/123, browser **134/134 mỗi Edge/Chrome**, bundle BKb9ILUH/CyQ-uI6G. N4 trace lịch sử và build mới giữ riêng; 3 vòng on/off luân phiên có shift bằng nhau nhưng tổng long task on nhiều hơn, **N6 chưa nghiệm thu**. Còn review toàn page/trạng thái, zoom thực/screen reader và deployment/DB tại M; runner DB riêng đã qua prepare/config nhưng daemon chưa chạy. [Bằng chứng mới](T30_PROGRESS_2026-10-01_L_N1.md), [NAV-21/N4 trước](T30_PROGRESS_2026-10-01.md).

Mục tiêu: menu thay main content có cảm giác liên tục, sidebar/header ổn định; không biến dashboard nghiệp vụ thành trang trình diễn. Dựa trên productive motion của Carbon, motion có giới hạn của Fluent và View Transitions của React Router. Những thời lượng bên dưới là **đề xuất riêng cho Crypta cần kiểm chứng bằng prototype**, không phải chuẩn bắt buộc hay khẳng định mọi dev đều dùng.

| Tương tác | Hiệu ứng đề xuất | Ranh giới bắt buộc |
| --- | --- | --- |
| Menu Dashboard → Users → Policies | Crossfade main content 160 ms, thử trong khoảng 120–180 ms | Không trượt cả viewport; không fade/sidebar/header hoặc tạo document reload |
| List → detail → Back | Fade 160–200 ms; thử dịch tối đa 4 px ở detail nếu thực sự giúp nhận biết | Giữ filter/page/scroll của list; không đợi exit animation mới điều hướng |
| Drawer/modal mở/đóng | Giữ kiểu hiện có, chuẩn hóa khoảng 160–200 ms và easing nhẹ | Không chồng thêm page animation; không trì hoãn focus trap/khôi phục focus |
| Hover/active/focus menu | Đổi nền/viền nhẹ 100–120 ms, active khớp route đã commit | Không làm chữ dịch vị trí; pending và active phải phân biệt |
| Search/filter/page của cùng bảng | Cập nhật trong vùng bảng, không chạy lại hiệu ứng toàn page | Không mất focus input, dirty state hoặc reset pagination ngoài quy tắc query |
| Tải chậm | Sau khoảng 150–200 ms mới hiện pending/skeleton đúng vùng | Không delay API cố ý, không giữ skeleton tối thiểu để kéo dài chờ; không spinner toàn màn hình |
| Reduced motion / không hỗ trợ API | Nội dung đổi ngay, phản hồi trạng thái bằng chữ/icon | Không animation dịch chuyển, zoom, shimmer hoặc smooth scroll cưỡng bức |

**N1 — Kiểm kê và chốt motion contract**

- [ ] Kiểm kê route change, query-only, detail/drawer, dialog, redirect auth, đổi role và Back/Forward; đo baseline render/network trên desktop và mobile trước chỉnh.
- [x] Tách token `--motion-fast`, `--motion-page`, `--motion-overlay`, easing entrance/exit; dùng cùng giá trị light/dark, không đổi bảng màu hoặc lớp bóng đã duyệt. Bằng chứng 01/10: routeMotion/main/CSS và browser N1 trong full suite 134 ca.
- [x] Ghi motion matrix: trigger, vùng được animate, thời lượng, pending, focus, scroll và reduced-motion cho từng loại thao tác. [Contract N1](T30_MOTION_CONTRACT.md), chưa đóng toàn bộ N/T30.
- **Kết quả:** contract + baseline revision/môi trường. **Đạt khi:** không có hai cơ chế cùng điều khiển một vùng; mỗi transition có mục đích rõ. **Phụ thuộc:** D–F và kiểm kê L.

**N2 — Prototype và review trước khi áp rộng**

- [ ] Làm lát cắt `/dashboard → /users → /policies` có tắt/bật motion để so sánh; dùng dữ liệu fixture hoặc dữ liệu đọc được phép, không phát sinh mutation.
- [ ] So sánh fade đơn thuần với fade + dịch 4 px trên detail; chọn phương án ít chuyển động nhất vẫn cho thấy thay đổi. Shared-element chỉ thử cho một phần tử có danh tính ổn định, không áp hàng loạt card/table row.
- [ ] Review light/dark, desktop 1440 và mobile 390 px; bổ sung màn hình tải chậm/lỗi/empty và reduced motion, lưu clip hoặc trace cùng ảnh trạng thái.
- **Kết quả:** prototype/đường dẫn và phương án đã chọn để chủ dự án review. **Đạt khi:** chữ không nhòe/flash, shell không nhảy, màn hình tải không giật chiều cao. **Phụ thuộc:** N1, C.

**N3 — Tích hợp router theo progressive enhancement**

- [ ] Đối chiếu API với `react-router@7.18.2` đang cài; ưu tiên `viewTransition` của Link/NavLink/navigate trong Data Router. Không nâng React/Router hoặc thêm Framer Motion chỉ để có fade.
- [ ] Chỉ đặt transition name cho vùng main content phù hợp; vô hiệu root crossfade mặc định nếu nó làm shell fade theo. Giữ tên duy nhất, tránh trùng giữa list/detail hoặc nhiều card cùng lúc.
- [ ] Feature detection; browser không hỗ trợ thì chuyển nội dung bình thường. Nếu fallback CSS được chọn, chỉ entrance ngắn và không chạy đồng thời với native transition.
- [ ] Dùng identity của page, không `key={location.key}` hoặc key toàn URL cho AppShell/form: đổi query không được remount toàn workspace.
- [ ] Blocker dirty phải quyết định trước navigation/transition: “Ở lại” không đổi URL, active menu, focus hoặc input; “Bỏ thay đổi” mới tới đích. Không dùng timeout thay cho tín hiệu router hay chờ animation để gửi POST.
- [ ] Không animate snapshot nội dung tài khoản cũ khi logout, hết phiên, đổi role, forbidden hoặc password gate. Hủy/bỏ kết quả GET cũ theo session/request identity; không mount page trái quyền để có ảnh chuyển cảnh.
- **Kết quả:** lớp tích hợp nhỏ có thể tắt riêng, không sửa nghiệp vụ. **Đạt khi:** route/state hoạt động cả khi API transition thiếu/lỗi, điều hướng nhanh tới đích cuối, không mutation lặp. **Phụ thuộc:** D–K, N2.

**N4 — Pending UI và dữ liệu không nhấp nháy**

- [ ] Phân biệt router pending với GET trong effect: hiện App còn tải bằng effect nên `useNavigation` riêng lẻ không đại diện toàn bộ thời gian chờ. Dùng trạng thái resource đúng page; khi chuyển sang loader thì bỏ nguồn pending trùng.
- [ ] Skeleton giữ kích thước vùng nội dung, `aria-busy`/status có văn bản ngắn; dashboard card không stagger liên tiếp làm người dùng đợi từng khối.
- [ ] Khi refetch cùng bảng, có thể giữ dữ liệu cũ và ghi “Đang cập nhật”; vô hiệu action có nguy cơ dùng ID/version cũ. Khác page/session phải bỏ dữ liệu cũ không đúng ngữ cảnh.
- [ ] Lỗi chỉ thay vùng liên quan, có retry theo GET; giữ menu/logout hoạt động. Không phát toast lỗi khi chủ động abort, không retry mutation chưa rõ kết quả.
- **Kết quả:** loading/refresh/error contract nhất quán. **Đạt khi:** mạng nhanh không chớp skeleton; mạng chậm không hiện trang trắng hoặc dữ liệu nhầm trang. **Phụ thuộc:** F, N3, T32 phần trạng thái.

**N5 — Focus, scroll và người nhạy cảm với chuyển động**

- [ ] Theo dõi `prefers-reduced-motion` kể cả khi đổi lúc app đang mở; tắt native transition lẫn fallback CSS, shimmer và smooth scroll không cần thiết. Không ẩn nội dung do animation bị tắt.
- [ ] Sau commit page hợp lệ, cập nhật title/heading và thông báo trang một lần; không chờ animationend để focus. Query-only giữ focus tại filter; dialog đóng trả về trigger hợp lệ.
- [ ] Menu mở page mới về đầu main; Back/Forward phục hồi scroll theo history entry và list–detail phục hồi ngữ cảnh. Khôi phục scroll không smooth ở reduced motion; không scrollIntoView section thay routing.
- [ ] Keyboard nhanh, Escape, zoom 200%, focus-visible, mobile menu và modal stack phải hoạt động khi đang transition. Snapshot không được gây click nhầm hành động cũ hoặc chặn interaction ngoài chủ đích.
- **Kết quả:** checklist keyboard/screen reader/reduced-motion. **Đạt khi:** tắt mọi animation vẫn nhận biết page/loading/error và hoàn thành tác vụ. **Phụ thuộc:** L, N3–N4.

**N6 — Regression, hiệu năng và rollout**

- [ ] Unit/component test motion policy: page vs query, reduced-motion, unsupported API, session boundary, blocker cancel/proceed. Không coi mock `startViewTransition` là bằng chứng animation thực tế.
- [ ] Browser/E2E NAV-23…NAV-30, cả Chromium và ít nhất một browser mục tiêu khác; ghi phiên bản và capability thực tế, không suy ra hỗ trợ chỉ từ tên browser.
- [ ] Đo trace trước/sau trên cùng máy với mạng chậm/CPU throttling: mục tiêu không thêm layout shift do transition, không thêm long task >50 ms do motion, không chờ exit animation trước xử lý navigation. Nếu không đạt, giảm về fade hoặc tắt; lưu số đo chứ không tự đánh dấu đạt.
- [ ] Gói motion có công tắc tắt độc lập; rollback frontend artifact trước mà không rollback DB. Cập nhật tracker với browser, revision, kết quả và giới hạn.
- **Kết quả:** report so sánh, bản review và đường rollback. **Đạt khi:** mandatory matrix đạt, build/frontend/backend regression cần thiết xanh, không tăng dependency animation ngoài quyết định được ghi lại. **Phụ thuộc:** N1–N5; M tổng nghiệm thu sau N6.

**Phạm vi bắt buộc:** fade main, pending đúng vùng, query không remount, reduced-motion/fallback, focus/scroll và regression. **Nâng cao không chặn T30:** shared-element/morph list–detail; chỉ triển khai sau khi prototype chứng minh hữu ích. Không dùng bounce, parallax, zoom toàn trang, gradient/glow chuyển động hoặc stagger bảng nhiều hàng.

##### T30.4 — Ma trận nghiệm thu bắt buộc

| Mã | Kịch bản / hành động kiểm tra | Kết quả phải đạt | Bằng chứng |
| --- | --- | --- | --- |
| NAV-01 | Bấm từng menu hợp lệ với mỗi role | URL/main/title/active menu khớp; shell giữ nguyên; không cuộn tới section khác | Test component + browser |
| NAV-02 | Users → Policies → Back → Forward | Đúng lịch sử page, không reload document | E2E |
| NAV-03 | Mở/F5 `/users`, `/assets/:id`, `/requests/:id` trên Nginx | App shell và page đúng; route frontend không 404 của web server | Build + Nginx smoke |
| NAV-04 | Deep link khi guest, login xong | Về đúng URL được phép; đích returnTo ngoài origin bị bỏ | Test parser + E2E |
| NAV-05 | Phiên bắt buộc đổi mật khẩu vào URL nghiệp vụ | Chỉ form đổi mật khẩu/logout; không tải dữ liệu nghiệp vụ trước khi đủ điều kiện | Test network + E2E |
| NAV-06 | USER nhập `/users`, ADMIN nhập `/approvals` | Từ chối theo ma trận; không mount nội dung đặc quyền; API vẫn kiểm tra quyền | Test guard + tích hợp API phòng vệ |
| NAV-07 | Logout/đổi tài khoản khi GET cũ chưa trả | Response cũ không xuất hiện ở phiên mới | Test response trễ |
| NAV-08 | Chuyển role được cấp và role không được cấp | Chỉ role thật có hiệu lực; route không phù hợp về đích hợp lệ | Test session/route |
| NAV-09 | Tìm kiếm/phân trang → mở detail → trở lại/F5 | Query, trang và ngữ cảnh đúng; dữ liệu chi tiết lấy bằng ID | E2E |
| NAV-10 | Query/UUID không hợp lệ, route lạ, đối tượng mất quyền | Validation/404/403 có đường phục hồi; không crash hoặc lộ nội dung cũ | Test route/error |
| NAV-11 | Chuyển trang nhanh khi mạng chậm | Hủy/bỏ GET cũ; không toast lỗi mạng do hủy chủ động, không ghi dữ liệu sai page | Test race + network trace |
| NAV-12 | Một API trang lỗi, API shell vẫn tốt | Chỉ page báo lỗi/retry; menu và logout còn dùng được | Test component |
| NAV-13 | Tạo user/đổi trạng thái/quyền/phát hành policy | Kết quả và bảng liên quan cập nhật; giữ kiểm tra quyền/concurrency hiện có | E2E trên fixture |
| NAV-14 | Duyệt request ở trang >1 và request vừa bị xử lý | Gửi đúng ID/version; stale version báo xung đột, không báo thành công sai | E2E + API fixture |
| NAV-15 | Tạo/gia hạn/thu hồi từ asset detail hoặc URL | Form đúng đối tượng, kiểm tra lại API; kết quả mở được bằng URL | E2E |
| NAV-16 | Form dirty → menu/Back; chọn ở lại hoặc bỏ | Giữ input khi ở lại; rời đúng đích khi bỏ; save thành công không chặn sai | Test blocker + browser |
| NAV-17 | Refresh/đóng tab có form dirty | beforeunload đăng ký đúng điều kiện; giới hạn browser được ghi rõ; không hứa phục hồi | Browser/manual |
| NAV-18 | Bấm thông báo và đánh dấu đọc từng mục/tất cả | Đúng đối tượng/scope; tổng unread cập nhật trên toàn dữ liệu | E2E |
| NAV-19 | Bàn phím, mobile, zoom và cả hai theme | Focus/menu/dialog/title đọc được; không che action hoặc mất tương phản rõ rệt | Ảnh + checklist |
| NAV-20 | Mở Users và xem network | Không fetch bảng Audit/Policy/Assets ngoài nhu cầu page; không gọi trùng loader/effect | Network trace so với baseline |
| NAV-21 | Route có mutation đang gửi rồi mất mạng/rời trang | Không tự gửi lại mutation; thể hiện kết quả chưa rõ, re-fetch khi quay lại | Test lỗi có kiểm soát |
| NAV-22 | API `/api/v1/...` và static asset qua Nginx | API vẫn proxy đúng, asset tải đúng; SPA fallback chỉ phục vụ điều hướng frontend phù hợp | Deployment smoke |
| NAV-23 | Dashboard → Users → Policies khi motion bật/tắt | Chỉ main chuyển cảnh; URL/title/focus/active đúng; shell không fade/nhảy | Browser clip + component test |
| NAV-24 | Đổi q/status/page cùng page; mở detail rồi Back | Không remount form/filter hoặc fade toàn workspace; giữ query và khôi phục scroll | E2E |
| NAV-25 | Bật reduced motion trước và trong phiên | Không slide/zoom/shimmer; nội dung, pending và focus vẫn dùng được | Browser + media emulation |
| NAV-26 | Browser không có View Transition API hoặc transition bị skip | Routing vẫn hoạt động, không màn hình trắng/chờ vô hạn | Component fallback + browser |
| NAV-27 | Form dirty → menu/Back trong khi đang chuyển cảnh | Ở lại giữ dữ liệu; bỏ mới chuyển; không mutation/transition lặp | Blocker test + browser |
| NAV-28 | 10 lần đổi page nhanh, logout/đổi role khi GET trễ | Đích cuối đúng; không snapshot/dữ liệu của phiên cũ, không trang trái quyền | Race test + network trace |
| NAV-29 | Mạng nhanh/chậm/lỗi và refetch cùng bảng | Skeleton không chớp/đẩy layout; pending đúng resource; retry không gửi lại POST | Component + browser |
| NAV-30 | Trace desktop/mobile, CPU throttling, keyboard/zoom | Không layout shift do motion, không long task mới >50 ms do motion; thao tác không đợi exit | Trace trước/sau + checklist |

Mỗi dòng ghi ngày, môi trường, revision, role, fixture và pass/fail/chưa chạy. Không lấy unit mock làm bằng chứng Nginx, DB, SMTP hoặc provider thật. Bộ test backend lịch sử vẫn được ghi riêng, đặc biệt khi có thay đổi dở trước T30.

##### T30.5 — Thứ tự, phụ thuộc và ranh giới hoàn tất

**Thứ tự trong task:** A → B → C → D → E → F → G → H → I → J → K → L → N → M. N1–N2 có thể chuẩn bị cùng L; N3 chỉ áp sau khi các điều kiện router/session/dirty form liên quan đã ổn. Test hồi quy viết/chạy cùng từng lát cắt; M tổng hợp bằng chứng cuối, không đợi đến M mới kiểm tra.

- **Ưu tiên thực hiện:** T30 là việc tiếp theo số 1. A–B bao gồm phần baseline/hợp đồng T01/T02/T03/T06 cần thiết cho router; không yêu cầu chờ đóng toàn bộ các task đó. Lỗi nền trực tiếp chặn router được ghi và xử lý trước lát cắt bị ảnh hưởng.
- **Chờ điều kiện ngoài:** thiếu Docker/DB không chặn thiết kế, tách component, build và test UI bằng fixture; nó chặn nghiệm thu DB/Nginx thật. Ghi rõ việc còn thiếu, không chuyển task sang “Đã nghiệm thu”.
- **Không phát sinh phạm vi:** T30 không thay thuật toán/provider/email worker, không thêm quyền hoặc sửa nghiệp vụ duyệt, không triển khai reset password/SSO/MFA chỉ để thêm route, không tạo nghiệp vụ Settings/Reports mới.
- **Phụ thuộc sau T30:** T12 dùng route chi tiết; T18 dùng asset route/lineage; T20 dùng policies page; T22 dùng audit page; T26/T28 dùng notifications/operations; T29 giữ dashboard gọn; T31–T34 hoàn thiện trải nghiệm; T38 mở rộng E2E. Những task này vẫn giữ phần nghiệp vụ chưa làm.
- **Ước lượng:** ghi thời gian thực tế A–F rồi cập nhật ước lượng G–M theo lỗi/phụ thuộc phát hiện. Chưa cam kết số ngày khi chưa có baseline và browser/DB khả dụng; ưu tiên một lát cắt chạy được từ menu → page → API → test.
- **Definition of Done của T30:** toàn bộ menu chuyển nội dung đúng route; session/quyền/direct link/history/query/form/data refresh và motion bắt buộc đạt NAV-01…NAV-30; build và kiểm thử triển khai đạt; có review light/dark/mobile/reduced-motion; tracker ghi đủ bằng chứng. Hoàn thành T30 không đồng nghĩa hoàn thiện production Crypta.

##### T30.6 — Nguồn nghiên cứu và cách áp dụng

Đối chiếu ngày 28/09/2026; khi cài đặt phải kiểm tra tài liệu đúng phiên bản package được chọn. Các quyết định URL/role/page ở trên là thiết kế riêng dựa trên mã Crypta, không phải yêu cầu của thư viện.

- [React Router Data Mode: routing](https://reactrouter.com/start/data/routing): route objects, layout và route lồng nhau; cơ sở tổ chức shell/page.
- [React Router Data Mode: installation](https://reactrouter.com/start/data/installation): đối chiếu cách tích hợp vào React hiện có; kiểm tra package/engine thực tế trước cài.
- [React Router: navigating](https://reactrouter.com/start/declarative/navigating): Link/NavLink và điều hướng có chủ đích; dùng cho menu và hành động chuyển trang.
- [React Router: navigation blocking](https://reactrouter.com/how-to/navigation-blocking) và [useBlocker](https://reactrouter.com/api/hooks/useBlocker): bảo vệ form chưa lưu khi chuyển trong SPA; reload/đóng tab cần xử lý riêng.
- [React Router: accessibility](https://reactrouter.com/how-to/accessibility): semantic links, trạng thái trang hiện tại, quản lý focus và thông báo khi route đổi.
- [React Router: View Transitions](https://reactrouter.com/how-to/view-transitions): tích hợp `viewTransition`, crossfade và shared-element; kiểm tra API bản 7 đang cài, không sao chép yêu cầu của bản mới hơn.
- [web.dev: SPA view transitions](https://web.dev/learn/css/view-transitions-spas): transition có progressive enhancement và xử lý reduced motion.
- [Carbon: motion](https://carbondesignsystem.com/elements/motion/overview/): phân biệt productive/expressive, thời lượng theo quy mô chuyển động; Crypta ưu tiên productive cho thao tác thường xuyên.
- [Fluent 2: motion](https://fluent2.microsoft.design/motion): chuyển động ngắn, giới hạn vùng liên quan và có no-motion; thông tin không phụ thuộc animation.
- Skill `reporter-enterprise-ui-ux` và checklist của skill đã dùng để lập tiêu chí workflow, error/recovery, keyboard và theme. Không dùng checklist như bằng chứng đã kiểm thử giao diện.

#### T31 — Bảng dữ liệu và tìm kiếm nhất quán · P1 · FE

- [ ] Áp API T17 cho các bảng; hiển thị tổng, trang, sort, filter đang dùng và thao tác xóa filter.
- [ ] Phân biệt không có dữ liệu với không tìm thấy; hiển thị mã/tên/trạng thái/thời gian dễ quét, không nhồi UUID.
- [ ] Xử lý văn bản dài, nhiều cột, màn hình hẹp và trạng thái đang tải trang mới.
- **Kết quả:** các danh sách dùng được với dữ liệu lớn, không chỉ bộ demo.
- **Nghiệm thu:** tìm bản ghi ngoài giới hạn cũ; chọn filter không để trang cũ gây kết quả rỗng giả; sort đúng ở server.
- **Phụ thuộc:** T17, T30.

#### T32 — Form, xác nhận và phục hồi lỗi · P1 · FE/QA

- [ ] Có loading/empty/validation/error/retry/success/conflict/timeout phù hợp cho từng form và thao tác.
- [ ] Giữ dữ liệu đã nhập khi lỗi có thể phục hồi; chặn double-submit, reset xác nhận khi đổi đối tượng/nội dung nhạy cảm.
- [ ] Với thu hồi/khóa tài khoản/đổi quyền, hiển thị đối tượng, tác động, lý do và bản tóm tắt trước xác nhận.
- **Kết quả:** người dùng biết điều gì xảy ra và phục hồi mà không thực hiện nhầm thao tác.
- **Nghiệm thu:** test mạng chậm/mất kết nối/409/403/500; không hiện thành công trước server; không retry tác động chưa rõ kết quả.
- **Phụ thuộc:** T03, T10–T15, T20, T30.

#### T33 — Light/dark và hệ thống màu · P1 · FE/QA

- [ ] Chuẩn hóa token nền, surface, elevation, text, border, chart và trạng thái; giữ dark với accent phù hợp đã duyệt, không dùng cam làm accent chính.
- [ ] Điều chỉnh lớp bóng/glow ở light để thấy chiều sâu nhưng không giảm độ rõ chữ; màu cảnh báo/lỗi có ý nghĩa riêng và kèm nhãn/icon.
- [ ] Kiểm tra chart tooltip, input, dropdown, drawer, disabled/focus trên cả hai theme; không chỉ screenshot dashboard.
- **Kết quả:** giao diện đồng nhất, giữ phong cách đã chốt mà đọc được ở cả hai chế độ.
- **Nghiệm thu:** bộ ảnh review các màn hình/trạng thái chính; không có chữ mất tương phản hoặc ý nghĩa chỉ dựa màu.
- **Phụ thuộc:** T29–T32; restyle lớn chỉ tích hợp sau khi duyệt mẫu.

#### T34 — Bàn phím, trợ năng và responsive · P1 · FE/QA

- [ ] Kiểm tra tab order, visible focus, nhãn input/nút icon, thông báo lỗi và status bất đồng bộ.
- [ ] Dialog/drawer có focus ban đầu, Escape, giới hạn focus phù hợp và trả focus khi đóng; biểu đồ có mô tả hoặc dữ liệu thay thế.
- [ ] Kiểm tra zoom 200%, chuỗi tiếng Việt dài, viewport hẹp và reduced motion; sửa overflow/đè nút.
- **Kết quả:** các luồng chính dùng được không cần chuột; checklist trợ năng có bằng chứng kiểm tra, không tự tuyên bố chứng nhận.
- **Nghiệm thu:** hoàn thành đăng nhập, tạo yêu cầu, duyệt và quản trị cơ bản bằng bàn phím; review cả dark/light.
- **Phụ thuộc:** T30–T33.

### Nhóm H — Kiểm thử chức năng, quyền và độ bền

#### T35 — Bộ fixture và môi trường test cách ly · P1 · QA/BE

- [ ] Tạo dữ liệu nhiều đơn vị, owner, Approver, Admin, user bị khóa và nhiều trạng thái tài sản/yêu cầu.
- [ ] Có dữ liệu lớn hơn giới hạn phân trang cũ, policy nhiều version, thông báo nhiều ngưỡng và provider stub kiểm soát lỗi.
- [ ] Tách DB/email/provider test, reset có phạm vi rõ; giả lập thời gian để không phải chờ ngày thực.
- **Kết quả:** bộ test xác định được kết quả và không phụ thuộc dữ liệu cá nhân hoặc credential thật.
- **Nghiệm thu:** chạy lặp không làm thay đổi DB vận hành, không gửi thư ra ngoài và không tạo tài sản thật.
- **Phụ thuộc:** T01, T04; xây sớm và mở rộng cùng các task chức năng.

#### T36 — Unit test quy tắc nghiệp vụ · P1 · BE/FE/QA

- [ ] Bổ sung test normalization, policy compatibility, state transitions, dedup, thời gian và mapping trạng thái UI.
- [ ] Bao phủ nhánh hợp lệ, không hợp lệ, giá trị biên và lỗi phụ thuộc; giữ test hồi quy cho các lỗi đã sửa.
- [ ] Tách test thuần khỏi hạ tầng; ghi rõ phần cần integration, không dùng mock để chứng minh transaction/concurrency.
- **Kết quả:** quy tắc quan trọng có test nhanh, dễ định vị lỗi.
- **Nghiệm thu:** thay đổi rule làm test liên quan thất bại; không dùng chỉ số coverage đơn lẻ thay cho kiểm tra 12 UC.
- **Phụ thuộc:** T03, T19, T27, T35; triển khai cùng code, không đợi cuối dự án.

#### T37 — Integration API, DB và transaction · P0 · BE/QA

- [ ] Test auth, request, decision, user, policy, notification và audit với PostgreSQL thật của môi trường test.
- [ ] Kiểm thử rollback khi một bước lỗi, unique/foreign key/trigger và migration nâng cấp có dữ liệu.
- [ ] Dùng nhiều connection thật cho tranh chấp duyệt, request trên cùng tài sản, admin cuối và policy version.
- **Kết quả:** bằng chứng ràng buộc vẫn đúng ngoài unit mock.
- **Nghiệm thu:** không có bản ghi mồ côi, trạng thái nửa chừng hoặc quyết định kép; suite chạy độc lập lặp lại được.
- **Phụ thuộc:** T04–T05, T10–T11, T19, T21, T35.

#### T38 — E2E đủ 12 use case · P1 · QA/FE/BE

- [ ] Viết luồng trình duyệt từ đăng nhập đến kết quả DB/API cho từng UC trong bảng mục 4.
- [ ] Bao phủ tạo mới, gia hạn, thu hồi thành công và lỗi; policy/access UI mới; thông báo tất cả role.
- [ ] Chạy trên bản build triển khai, lưu trace/screenshot khi lỗi và dữ liệu kiểm thử có thể dựng lại.
- **Kết quả:** 12 UC có bằng chứng hoạt động xuyên suốt, không chỉ endpoint trả 200.
- **Nghiệm thu:** mỗi UC có ít nhất happy path, kiểm tra quyền liên quan và trạng thái lỗi/biên quan trọng; không bỏ qua test fail để làm xanh CI.
- **Phụ thuộc:** các task chức năng liên quan, T35–T37; mock provider cho CI, T16/T25 nghiệm thu ngoài riêng.

#### T39 — Ma trận phân quyền và bảo vệ dữ liệu · P0 · QA/BE

- [ ] Kiểm tra từng API theo vai trò, chủ sở hữu, đơn vị, trạng thái user, phiên cũ và yêu cầu đổi mật khẩu.
- [ ] Bao phủ IDOR, tự duyệt, thay đổi scope, refresh/logout, input không hợp lệ, cookie/origin và redaction bằng test phòng vệ trong môi trường cách ly.
- [ ] Rà secret trong source/build/log, dependency và cấu hình triển khai; phân loại phát hiện và sửa trước release.
- **Kết quả:** bảng quyền cho phép/từ chối có kết quả test, danh sách rủi ro có người chịu trách nhiệm.
- **Nghiệm thu:** không còn lỗi Critical/High đã biết chưa khắc phục; không xem việc ẩn nút là biện pháp bảo mật.
- **Phụ thuộc:** T05–T06, T17–T22, T35, T43; không kiểm thử tấn công hệ thống bên thứ ba.

### Nhóm I — Đóng gói, cấu hình và vận hành

#### T40 — Cấu hình môi trường và Docker · P0 · OPS/BE

- [ ] Tách dev/test/demo/production; validate cấu hình bắt buộc khi khởi động và che secret trong lỗi.
- [ ] Rà port, APP_URL, origin, cookie và TLS; thêm healthcheck phù hợp, non-root khi khả thi, log rotation và graceful shutdown.
- [ ] Quyết định Redis: bỏ nếu không dùng hoặc giữ với nhiệm vụ cụ thể và test; không thêm queue mới chỉ để hợp số container.
- **Kết quả:** cấu hình có chủ đích, không mang seed/demo credential hoặc chế độ mock vào production ngoài ý muốn.
- **Nghiệm thu:** cấu hình thiếu/sai báo lỗi dễ sửa; dữ liệu tồn tại sau recreate container; port/URL thực khớp tài liệu.
- **Phụ thuộc:** T01, T04, T43.

#### T41 — Bộ khởi động/dừng/chẩn đoán một bước · P1 · OPS/QA

- [ ] Hoàn thiện `.cmd`/PowerShell: kiểm tra Docker/Compose, cổng bận, file cấu hình và quyền; tránh lỗi encoding/parser trên Windows hỗ trợ.
- [ ] Sinh secret bằng nguồn ngẫu nhiên mật mã, không thay placeholder theo vị trí; không ghi đè `.env` hiện có.
- [ ] Chờ health/readiness rồi mở đúng URL/port; timeout có hướng dẫn và log; dừng không xóa volume.
- [ ] Thêm chế độ chẩn đoán và quy trình update; tài liệu nêu rõ Docker là điều kiện tiên quyết, không hứa chạy trên máy chưa có runtime.
- **Kết quả:** người mới dùng được mà không phải tự nhớ từng lệnh.
- **Nghiệm thu:** thử trên máy/profile sạch, đường dẫn có dấu/khoảng trắng, port khác mặc định, Docker chưa chạy và lần khởi động thứ hai.
- **Phụ thuộc:** T04, T40, T43.

#### T42 — Backup và phục hồi đã diễn tập · P0 · OPS/QA

- [ ] Viết script backup DB, metadata cấu hình và manifest phiên bản; lưu secret riêng an toàn, không đóng gói lẫn vào backup công khai.
- [ ] Chốt lịch, retention, nơi lưu ngoài máy chạy ứng dụng, mã hóa và thông báo backup lỗi; chủ dự án duyệt RPO/RTO.
- [ ] Viết restore vào DB/môi trường riêng; kiểm tra số liệu, đăng nhập, lineage, audit và cấu hình provider sau phục hồi.
- **Kết quả:** backup có thể dùng được, có runbook và số đo phục hồi thực tế.
- **Nghiệm thu:** diễn tập mất môi trường giả định và phục hồi thành công; không ghi đè DB thật. Nêu rõ backup Crypta không tự backup khóa tại KMS/CA.
- **Phụ thuộc:** T04, T13, T21, T40, T43; lịch tự động chỉ cấu hình khi triển khai được cho phép.

#### T43 — Quyền DB, secret và hardening cấu hình · P0 · OPS/BE

- [ ] Tách tài khoản migration và runtime; runtime chỉ có quyền cần thiết, không là DB superuser và không sửa/xóa audit.
- [ ] Loại credential mặc định khỏi production; tạo/rotate secret an toàn; kiểm tra ignore, Docker image và frontend bundle không chứa secret.
- [ ] Giới hạn exposure DB/cache, kết nối provider và quyền email; xác định HTTPS/reverse proxy, CORS/cookie và giới hạn request theo môi trường.
- **Kết quả:** đặc quyền tối thiểu và đường quản lý secret rõ ràng.
- **Nghiệm thu:** app chạy đủ nghiệp vụ bằng tài khoản runtime hạn chế; quyền cấm thực sự bị DB từ chối; secret rotation có kịch bản kiểm tra.
- **Phụ thuộc:** T04; rà chính sách theo môi trường triển khai thật trước T51.

#### T44 — Healthcheck, log, metrics và cảnh báo · P1 · BE/OPS

06/11 đã tách liveness/readiness, kiểm log JSON, metrics Admin và cảnh báo stdout của monitor độc lập. 08/11 đã đưa diễn tập dừng và phục hồi PostgreSQL cách ly vào job tích hợp CI. Còn nối kênh người trực, kiểm dưới tải và diễn tập provider/SMTP trên môi trường đã chọn. [Bằng chứng T44](T44_HEALTH_READINESS_2026-11-06.md).

- [ ] Tách liveness/readiness; kiểm tra phụ thuộc theo mức ảnh hưởng, không suy provider healthy từ việc đã điền URL.
- [ ] Thêm log có cấu trúc/correlation ID; metrics tuổi hàng đợi, lỗi provider/email, job gần nhất, DB và thời gian xử lý.
- [ ] Xác định ngưỡng, kênh và người nhận cảnh báo; tránh gửi cảnh báo lỗi email chỉ qua chính email đang hỏng.
- **Kết quả:** người vận hành biết lỗi trước khi người dùng phải báo.
- **Nghiệm thu:** thử DB/provider/SMTP gián đoạn trong môi trường test tạo trạng thái và cảnh báo đúng; không lộ secret hoặc báo khỏe giả.
- **Phụ thuộc:** T14–T15, T23, T27, T40, T43.

#### T45 — CI có cổng chất lượng thực sự · P1 · BE/FE/OPS

- [ ] Mở rộng workflow hiện có với lint/typecheck, build, unit, DB integration và E2E; cache và artifact lỗi phù hợp.
- [ ] Kiểm tra dependency/secret và build image; sử dụng tài khoản test, không dùng credential production trong CI.
- [ ] Chạy workflow trên remote sau khi thay đổi được review/push có chủ đích; thiết lập yêu cầu check trước merge theo quyền repo.
- **Kết quả:** mỗi thay đổi quan trọng được kiểm chứng tự động trên môi trường sạch.
- **Nghiệm thu:** có một lần chạy xanh trên commit release; thay đổi làm hỏng test chặn release; workflow tồn tại chưa được tính là đã chạy.
- **Phụ thuộc:** T35–T39, T40; dựng khung CI sớm, mở rộng cùng test. Không tự push trong lượt lập kế hoạch.

#### T46 — Đóng gói phiên bản và nâng cấp/rollback · P1 · OPS/BE

- [ ] Chốt tag/version, image có thể truy xuất nguồn, changelog và tập tin cấu hình mẫu không chứa secret.
- [x] Viết quy trình backup, kiểm tra tương thích, migration và health/smoke sau nâng cấp. CI đã diễn tập từ baseline 001–003 đến 023.
- [x] Tách rollback code và phục hồi dữ liệu. CI đã khôi phục dump trên DB riêng và chạy smoke bằng API baseline. [Runbook và manifest](RELEASE_RUNBOOK.md)
- **Kết quả:** một release có thể cài lại, nâng cấp và khôi phục theo hướng dẫn.
- **Nghiệm thu:** diễn tập nâng cấp từ baseline có dữ liệu; rollback tương thích thành công hoặc phục hồi theo runbook được đo thời gian.
- **Phụ thuộc:** T04, T41–T42, T45.

#### T47 — Tài liệu sử dụng và vận hành · P1 · BE/FE/OPS

- [ ] Viết hướng dẫn User/Approver/Admin và người vận hành, kèm ảnh đúng phiên bản và tình huống lỗi thường gặp.
- [ ] Hoàn thiện OpenAPI, cấu hình email/provider, quản lý tài khoản, backup, restore, update và xử lý request cần đối soát.
- [ ] Giải thích từng container thực tế, dữ liệu nằm đâu, tắt máy ảnh hưởng gì và cách gửi log đã che thông tin nhạy cảm.
- **Kết quả:** người mới tự cài, đăng nhập và thực hiện quy trình mà không cần tác giả đọc lệnh từng bước.
- **Nghiệm thu:** một người chưa dùng dự án thử theo tài liệu; mọi chỗ phải hỏi lại được ghi nhận và sửa.
- **Phụ thuộc:** T07, T16, T25, T28, T41–T46; viết dần, chốt sau tính năng ổn định.

### Nhóm J — Kiểm chứng cuối và bàn giao

#### T48 — Kiểm thử job, thời gian và sự cố · P0 · QA/BE/OPS

08/11 đã xác minh lượt quét định kỳ sau 3.599,78 giây trên một backend và PostgreSQL cách ly, gồm hai trạng thái tài sản, hai audit và 16 thông báo theo phạm vi. [Bằng chứng T48](T27_HARDENING_2026-11-06.md#t48--lượt-quét-định-kỳ-theo-giờ-thực)

- [ ] Chạy nhiều worker cùng DB test; mô phỏng restart/crash/network timeout tại các ranh giới tác động ngoài và commit.
- [ ] Kiểm tra các ngưỡng cảnh báo/hết hạn, catch-up sau downtime, retry hết lượt và phục hồi Sending/Processing.
- [ ] Đối chiếu request, operation, asset, audit và notification sau mỗi sự cố; ghi rõ trường hợp cần can thiệp thủ công.
- **Kết quả:** báo cáo độ bền của hệ thống và test hồi quy cho từng lỗi tìm thấy.
- **Nghiệm thu:** không cấp phát trùng, không mất quyết định, không kẹt job vô hạn; giới hạn gửi trùng SMTP được mô tả trung thực.
- **Phụ thuộc:** T13–T15, T23, T27, T35, T37, T44.

#### T49 — UAT với vai trò và dữ liệu gần thực tế · P1 · PO/QA

- [ ] Chuẩn bị kịch bản công việc của User, Approver, Admin và vận hành; chỉ dùng dữ liệu giả hoặc dữ liệu được phép.
- [ ] Review light/dark, biểu đồ, danh sách, form, lỗi và bàn phím; đối chiếu hướng thiết kế đã duyệt.
- [ ] Ghi lỗi, mức độ, bước tái hiện, người xử lý; sửa và kiểm thử lại, không chỉ ghi “đã demo”.
- **Kết quả:** biên bản người dùng xác nhận luồng công việc đáp ứng nhu cầu.
- **Nghiệm thu:** 12 UC được chấp nhận; không còn blocker; thay đổi lớn về workflow được duyệt trước tích hợp.
- **Phụ thuộc:** T29–T34, T38–T39, T48.

#### T50 — Hiệu năng và dung lượng có số đo · P1 · BE/FE/OPS/QA

- [ ] Chốt tải dự kiến: user đồng thời, số assets/requests/audit, email/ngày và thời gian chờ cho phép.
- [ ] Đặt ngân sách p95 cho API chính, tải trang, thời gian job và backlog; đo trên cấu hình được ghi rõ.
- [ ] Test dữ liệu lớn, phân trang, truy vấn tổng hợp, pool DB, bundle và memory; tối ưu theo số đo rồi chạy lại.
- **Kết quả:** cấu hình triển khai tối thiểu và giới hạn dung lượng có bằng chứng.
- **Nghiệm thu:** đạt ngân sách đã chốt; không lấy vài bản ghi demo làm bằng chứng chịu tải production.
- **Phụ thuộc:** T17, T29–T31, T35, T44; xác định ngân sách sớm, đo nghiệm thu sau tối ưu.

#### T51 — Triển khai thử có kiểm soát · P1 · OPS/PO

- [ ] Chọn môi trường staging/pilot, domain, TLS, backup và tài khoản; chỉ deploy sau khi được cho phép dùng hạ tầng đó.
- [ ] Cấu hình SMTP và provider thật nếu mục tiêu là quản lý tài sản thật; tạo nhóm người dùng thử giới hạn.
- [ ] Chạy smoke sau deploy, kiểm tra cảnh báo, theo dõi một chu kỳ nghiệp vụ và chuẩn bị phương án quay lại.
- **Kết quả:** bản pilot chạy trên môi trường gần vận hành thực, không chỉ localhost.
- **Nghiệm thu:** không còn P0, T25/T42/T46 pass; nếu T16 chưa pass thì pilot phải ghi rõ mô phỏng và không dùng tài sản thật.
- **Phụ thuộc:** T16 theo phạm vi, T25, T39–T46, T48–T50.

#### T52 — Đào tạo, demo và tài liệu đồ án · P2 · PO/QA

- [ ] Quay demo từ bộ dữ liệu có thể dựng lại, bao phủ 12 UC và ít nhất một tình huống từ chối/lỗi/phục hồi.
- [ ] Cập nhật sơ đồ kiến trúc, ERD, luồng hoạt động và báo cáo để khớp code; phân biệt mock với tích hợp thật.
- [ ] Bàn giao trách nhiệm tài khoản quản trị, hỗ trợ và xử lý cảnh báo; không để credential xuất hiện trong video/tài liệu.
- **Kết quả:** bộ demo/báo cáo và hướng dẫn bàn giao nhất quán với release.
- **Nghiệm thu:** người nhận làm lại được kịch bản; không có chức năng được tuyên bố trong báo cáo nhưng không tồn tại.
- **Phụ thuộc:** T47, T49, T51 nếu demo bản triển khai thật.

#### T53 — Đồng bộ trạng thái và bằng chứng hoàn thành · P1 · BE/QA

- [ ] Cập nhật tracker theo task ID; gắn từng UC với test/commit/ảnh/báo cáo và ngày kiểm tra cuối.
- [ ] Hợp nhất các số liệu test cũ/mới trong `PROJECT_STATUS.md`, giữ lịch sử có nhãn thay vì để các tuyên bố mâu thuẫn.
- [ ] Ghi rõ phạm vi release, giới hạn còn lại, điều kiện ngoài đang chờ và backlog R2; kiểm kê thay đổi trước commit/push.
- **Kết quả:** một nguồn trạng thái đáng tin cậy, có thể kiểm tra lại.
- **Nghiệm thu:** không có mục “xong” thiếu bằng chứng; không đưa file riêng tư/ngoài phạm vi lên repo.
- **Phụ thuộc:** thu thập suốt dự án; chốt sau T45, T49–T52.

#### T54 — Cổng nghiệm thu release · P1 · PO/QA/OPS

- [ ] Kiểm tra toàn bộ điều kiện mục 7; phân biệt hoàn thành R1 và hoàn thành cả phạm vi nâng cao.
- [ ] Lập biên bản go/no-go, danh sách rủi ro còn lại, người phụ trách và phương án hỗ trợ.
- [ ] Gắn phiên bản phát hành và bàn giao sau khi được duyệt; không tự triển khai/push vì tài liệu kế hoạch này.
- **Kết quả:** quyết định release minh bạch thay vì kết luận “100%” theo cảm nhận.
- **Nghiệm thu:** tất cả task R1 bắt buộc có bằng chứng hoặc thay đổi phạm vi được chủ dự án duyệt rõ; P0 không được miễn trừ để dùng dữ liệu thật.
- **Phụ thuộc:** T01–T53 theo phạm vi; cần quyết định của chủ dự án.

### Nhóm K — Các mục nâng cao đã nêu trong kế hoạch gốc

Các mục dưới đây là backlog riêng, không mất khỏi kế hoạch chỉ vì chưa nằm trong R1. Nếu tổ chức triển khai yêu cầu một mục làm điều kiện bảo mật bắt buộc, phải đưa mục đó vào cổng release trước khi dùng thật.

#### X01 — MFA cho vai trò nhạy cảm · P2, nâng P0 nếu chính sách yêu cầu

- [x] Tích hợp TOTP 6 số, 10 mã khôi phục dùng một lần và thay ứng dụng theo mẫu đã duyệt. Kiểm xác thực tăng cường và khôi phục trên stack cách ly.
- [x] Mã hóa secret, giới hạn số lần thử và ghi audit. Kiểm API, refresh và đăng ký qua Chromium. [X01](docs/MFA_X01.md)
- **Kết quả:** Approver/Admin có bước xác thực bổ sung và đường khôi phục có kiểm soát.
- **Nghiệm thu:** không vào nghiệp vụ trước khi hoàn tất MFA; recovery code dùng một lần; có test reset MFA.
- **Phụ thuộc:** T05–T07, T39, T43; chốt phương thức với chủ dự án.
- **Môi trường đích:** Bật yêu cầu MFA và diễn tập khôi phục với cấu hình đích trước nghiệm thu.

#### X02 — Phê duyệt hai cấp theo độ nhạy cảm · P2

- [x] Tích hợp hai Approver khác nhau cùng phạm vi, thời hạn theo policy, mặc định 48 giờ, và lịch sử từ chối/hủy theo mẫu đã duyệt.
- [x] Cập nhật policy, hàng chờ, thông báo, lịch sử và worker. Đã kiểm quyết định đồng thời và chặn thực thi khi thiếu cấp trên PostgreSQL. [X02](docs/X02_TWO_STAGE_APPROVAL.md)
- **Kết quả:** tài sản nhạy cảm có quy trình kiểm soát bổ sung.
- **Nghiệm thu:** concurrent decisions đúng; thiếu một cấp không cấp phát; policy cũ được migrate rõ ràng.
- **Phụ thuộc:** T02, T10–T15, T19, T38–T39; cần nghiệp vụ duyệt của tổ chức.
- **Môi trường đích:** Xác nhận cấu hình policy, danh sách Approver và kịch bản UAT.

#### X03 — SSO/OIDC · P2

- [x] Chọn Keycloak cho kiểm thử cách ly, liên kết theo issuer/subject đã xác minh, lấy đơn vị và quyền từ Crypta, ghi audit khi cấp hoặc thu hồi liên kết.
- [x] Tích hợp đăng nhập, đăng xuất, vòng đời phiên và đường đăng nhập Admin cục bộ dùng MFA khi IdP gián đoạn. Đã kiểm trên stack cách ly.
- **Kết quả:** dùng danh tính tổ chức thay vì chỉ tài khoản cục bộ.
- **Nghiệm thu:** user ngừng hoạt động bị thu hồi đúng; không chiếm nhầm tài khoản qua email trùng; test callback/session/scope.
- **Phụ thuộc:** T05–T08, T39, T43; cần cấu hình và quyền với IdP.
- **Môi trường đích:** Cần cấu hình IdP và callback HTTPS, liên kết tài khoản thật và chạy UAT. [Bằng chứng và hướng dẫn X03](docs/X03_OIDC.md)

#### X04 — Xuất báo cáo CSV/PDF có kiểm soát · P2

- [x] Chốt và tích hợp nội dung xuất, quyền, bộ lọc, múi giờ và giới hạn theo mẫu đã duyệt. CSV trung hòa nội dung công thức và báo cáo dùng cột cho phép.
- [x] Chạy nền, tải trong một giờ và ghi audit người xuất/phạm vi. Đã kiểm 6 nhóm trên PostgreSQL và Chromium. [X04](docs/X04_REPORT_EXPORTS.md)
- **Kết quả:** báo cáo khớp dữ liệu tra cứu, không tạo kênh lấy dữ liệu vượt quyền.
- **Nghiệm thu:** tổng/số dòng đúng; dữ liệu ngoài scope bị loại; PDF đọc được và CSV an toàn khi mở bằng bảng tính.
- **Phụ thuộc:** T17–T22, T39; dùng skill tài liệu phù hợp khi thực sự triển khai artifact.

#### X05 — Audit chống sửa đổi có thể kiểm chứng · P2

- [x] Chốt mô hình kiểm chứng bằng chuỗi checkpoint Ed25519 và khóa tách khỏi quyền quản trị DB trong sandbox.
- [x] Thêm CLI ký/xác minh. Đã kiểm nhiều writer, ghi đồng thời, phát hiện sửa/xóa/chèn, xoay khóa và phục hồi PostgreSQL. [X05](docs/X05_AUDIT_ANCHOR.md)
- **Kết quả:** phát hiện thay đổi audit theo mô hình đã công bố, bổ sung cho trigger/quyền DB hiện có.
- **Nghiệm thu:** sửa/xóa/chèn log giả trong fixture được phát hiện; không tuyên bố hash-chain cùng DB tự chống được mọi quyền quản trị DB.
- **Phụ thuộc:** T21–T22, T42–T43; cần quyết định nơi lưu/khóa độc lập.
- **Môi trường đích:** Chọn kho độc lập, chủ sở hữu khóa và thời hạn lưu trước khi bật lịch ký production.

#### X06 — Mở rộng KMS/CA/HSM theo adapter · P2

- [x] Thêm adapter OpenBao Transit dùng hợp đồng T16 cho khóa ký RSA/ECDSA trong sandbox. Capability chứng thư được tách riêng.
- [x] Kiểm idempotency, tra cứu, thời hạn policy, gia hạn và thu hồi trên OpenBao 2.7.2 native. [X06](docs/X06_OPENBAO_TRANSIT.md)
- **Kết quả:** hỗ trợ mở rộng có kiểm chứng, không phải chỉ một URL HTTP chung.
- **Nghiệm thu:** mỗi adapter được công bố có test với sandbox thật; lỗi hãng không làm lệch trạng thái nội bộ; không bao gồm quản lý thiết bị HSM vật lý.
- **Phụ thuộc:** T13–T16, T38–T39, T43; cần tài khoản/quyền/chi phí từng nhà cung cấp.
- **Môi trường đích:** Chọn và cấu hình KMS/CA theo nhu cầu thực tế. Chạy contract test với tài khoản và phạm vi được cấp trước UAT.

## 4. Ma trận hoàn thiện 12 use case

| UC | Chức năng | Task chính | Bằng chứng cần có để đóng |
| --- | --- | --- | --- |
| UC1 | Yêu cầu cấp mới | T03, T09–T16, T19 | UI → submit → duyệt → provider → asset; tham số đúng, không trùng, ngoài quyền bị từ chối |
| UC2 | Gia hạn | T10, T13–T16, T18–T19 | Tài sản mới, liên kết trước/sau, policy đúng, trạng thái tài sản cũ đúng; kiểm tra lỗi provider |
| UC3 | Thu hồi | T10–T16, T18 | Quyền/lý do/thường–khẩn đúng; trạng thái provider và DB khớp; thao tác lặp an toàn |
| UC4 | Xem tài sản được phép | T17–T18, T30–T31 | Danh sách/chi tiết/timeline đúng scope, có phân trang, kiểm tra truy cập chéo |
| UC5 | Hàng chờ theo scope | T08, T11, T17, T31 | Filter khẩn/đơn vị/trạng thái đúng trên toàn dữ liệu; không bỏ sót do limit |
| UC6 | Duyệt/từ chối | T05, T11–T12, T21 | SoD, lý do, scope, concurrent decision, audit và notification |
| UC7 | Admin xem toàn hệ thống | T17–T18, T29, T31 | Danh mục đầy đủ; tổng số đúng, không chỉ bảng watched assets |
| UC8 | Quản trị policy | T19–T20 | Tạo/version/lịch sử/hiệu lực; bản cũ bất biến; worker thật sự tuân thủ |
| UC9 | Tra cứu audit | T21–T22 | Sự kiện đủ, filter/paging; không sửa/xóa bằng runtime; metadata đã lọc |
| UC10 | Quản lý role/scope | T05–T08 | Không mất admin cuối; atomic changes; scope hợp lệ; phiên cũ bị thu hồi |
| UC11 | Cảnh báo sắp hết hạn | T23–T28, T48 | Đúng ngưỡng policy/người nhận/kênh; chống lặp; email thật tới hộp thư |
| UC12 | Cập nhật hết hạn | T18, T27, T48 | Đúng mốc UTC; nhiều worker/downtime; audit và UI cập nhật đúng |

T35–T39 và T48 là bằng chứng kiểm thử chung cho bảng này, không phải tính năng thay thế cho các UC.

## 5. Thứ tự thực hiện và cổng từng giai đoạn

Đây là thứ tự phụ thuộc, không phải cam kết hoàn thành theo ngày. Một task lớn có thể triển khai nhiều lượt; test đi cùng thay đổi, không dồn toàn bộ cuối dự án. Các công việc ghi “bắt đầu sớm” được hoàn tất ở cổng sau.

| Giai đoạn | Việc thực hiện | Điều kiện chuyển tiếp |
| --- | --- | --- |
| G-UI — Ưu tiên số 1 theo yêu cầu 28/09 | T30-A → T30-M; baseline/hợp đồng tối thiểu và test đi kèm | Dashboard theo route hoạt động đúng, có review và bằng chứng ma trận NAV; phần thiếu hạ tầng ghi chờ kiểm thử |
| G0 — Baseline và quyết định | T01–T04; dựng T35; chốt lựa chọn ở mục 6 | Có baseline tái lập, ma trận trạng thái và migration an toàn |
| G1 — Tính đúng đắn cốt lõi | T05–T06, T19, T43, T21; T09–T10, T13–T15; test liên quan T36–T37 | Không còn lỗ hổng trạng thái đã nêu; crash không cấp phát trùng; audit/quyền DB đúng |
| G2 — Đủ chức năng và thông báo | T08, T17; T11–T12, T18, T20, T22–T28, T07; kết nối T16 khi có điều kiện | 12 UC có luồng đầy đủ; cảnh báo đúng policy; gửi thật được kiểm chứng hoặc đánh dấu chờ ngoài |
| G3 — UX sử dụng hằng ngày | T29, T31–T34; hồi quy T30 đã làm ở G-UI; hoàn tất UI từ G1/G2; cập nhật T38 | Không nút chết/số liệu giả; bảng lớn dùng được; dark/light, lỗi và bàn phím được review |
| G4 — Vận hành và kiểm thử release | T40–T46; hoàn tất T35–T39, T48, T50 | CI xanh, backup restore đã diễn tập, startup máy mới pass, không còn P0 |
| G5 — Pilot và bàn giao | T47, T49, T51–T54 | UAT được duyệt, hồ sơ release đầy đủ, phạm vi thật/mock rõ ràng |
| G6 — Mở rộng | X01–X06 theo ưu tiên được chọn | Mỗi tính năng có đặc tả, kiểm thử và nghiệm thu riêng |

Có thể làm sớm T40/T44/T45/T47 để hỗ trợ các giai đoạn trước. Trong giai đoạn triển khai, nên đóng một lát cắt hoàn chỉnh có test trước khi mở quá nhiều task cùng lúc; bảng này không yêu cầu tạo nhiều agent.

**Thứ tự thực hiện đã cập nhật ngày 28/09:** **T30 trước tiên** (A–B thực hiện baseline/hợp đồng tối thiểu cần thiết) → phần còn lại T01/T02/T03/T04 → T05/T19/T43 → T21 → T10/T13/T14/T15; sau đó tiếp tục các giai đoạn trên. Xây fixture/test tương ứng trong từng task. Việc ưu tiên router không giảm điều kiện P0 trước release; không tự coi thay đổi backend dở đã được kiểm chứng.

**Ước lượng:** chưa cam kết số ngày khi chưa chạy baseline và chưa chọn provider/hạ tầng. Sau G0, mỗi task cần ước lượng số ngày công theo BE/FE/QA/OPS, độ tin cậy và thời gian chờ ngoài; cập nhật sau mỗi giai đoạn. Các task idempotency/provider, migration, SMTP thật và restore có độ bất định cao hơn chỉnh UI. Không dùng “số task” làm đại diện khối lượng.

## 6. Những quyết định/điều kiện cần chủ dự án cung cấp

| Nội dung | Cần xác nhận | Có thể tiếp tục gì khi đang chờ? |
| --- | --- | --- |
| Mục tiêu release | R1 vận hành nội bộ hay yêu cầu cả X01–X06 ngay? | Hoàn thiện lõi và test; không tự bỏ các mục nâng cao khỏi tracker |
| Provider thật | Loại khóa/chứng thư, nhà cung cấp, sandbox, quyền, chi phí; ai quản lý tài sản cũ sau gia hạn? | Hoàn thiện contract, operation ledger, mock và recovery; chưa tuyên bố cấp phát thật |
| Email | Nhà cung cấp SMTP, địa chỉ gửi, domain, người nhận thử đồng ý | Hoàn thiện queue/template/test local; chưa gửi email ra ngoài tùy ý |
| Hạ tầng | Máy nội bộ/VPS, domain, TLS, tài nguyên, số người dùng và người vận hành | Hoàn thiện Docker/startup và kế hoạch deploy; chưa tự tạo tài nguyên trả phí |
| Backup | Mức mất dữ liệu/thời gian ngừng chấp nhận được, nơi lưu, retention | Viết script và diễn tập môi trường riêng; chưa chọn dịch vụ lưu trữ trả phí |
| Nghiệp vụ | Nháp, thu hồi khẩn, policy khi gia hạn, chuyển đơn vị, reset tài khoản, người nhận cảnh báo | Ghi phương án và hệ quả; không triển khai quyết định có thể làm sai quyền |
| UI thay đổi lớn | Duyệt preview nếu đổi điều hướng/workflow/ngôn ngữ thiết kế | Sửa hành vi hỏng, kiểm thử và giữ thiết kế đã được duyệt |

Secret được điền vào nơi cấu hình an toàn; không yêu cầu người dùng gửi mật khẩu SMTP/provider trong hội thoại hoặc tài liệu này.

## 7. Definition of Done — thế nào mới được gọi là hoàn thiện?

### R1 chức năng và vận hành

- [ ] 12 UC có bằng chứng UI → API → DB/job và test quyền liên quan; không có chức năng giả hoặc nút không hoạt động.
- [ ] Không còn P0 và lỗi Critical/High đã biết; thay đổi role/trạng thái thu hồi phiên đúng; admin cuối được bảo vệ.
- [ ] Không lộ private key/secret trong DB metadata, frontend, Git, audit, log, email hoặc bằng chứng test.
- [ ] Provider retry/crash được xử lý an toàn; tác vụ không rõ kết quả có đường đối soát, không tự chạy lại mù.
- [ ] Policy thực sự áp dụng cho cấp phát và lịch cảnh báo; expiration đúng mốc, không phụ thuộc một worker duy nhất.
- [ ] Email thật được kiểm chứng tại hộp thư; lỗi gửi/backlog được quan sát; giới hạn SMTP được ghi rõ.
- [ ] UI light/dark, biểu đồ, bảng dữ liệu, lỗi, loading, empty, conflict, mobile và bàn phím được nghiệm thu.
- [ ] Build/lint/typecheck/unit/integration/E2E chạy xanh trên commit release; test bị skip có giải trình, không che lỗi bắt buộc.
- [ ] Startup máy mới, nâng cấp có dữ liệu, backup và restore đã diễn tập; có số đo RPO/RTO và hiệu năng theo mục tiêu đã chốt.
- [ ] Có hướng dẫn sử dụng/vận hành, UAT, changelog và người chịu trách nhiệm hỗ trợ.

### Điều kiện bổ sung để tuyên bố vận hành tài sản mật mã thật

- [ ] T16 đã qua kiểm chứng với provider/CA thực tế; quản lý reference, thời hạn, gia hạn và thu hồi được đối chiếu.
- [ ] Môi trường triển khai, quyền truy cập, secret, TLS, backup và quy trình đối soát được chủ sở hữu chấp nhận.
- [ ] Những yêu cầu nâng cao bắt buộc theo chính sách tổ chức, nếu có, đã chuyển vào cổng release và hoàn thành.

Nếu một trong các điều kiện này thiếu, cách mô tả đúng là “bản pilot” hoặc “bản quản lý metadata/mô phỏng”, không phải sản phẩm quản lý khóa/chứng thư thật hoàn chỉnh.

### Điều kiện tuyên bố hoàn tất toàn bộ phạm vi gốc, kể cả nâng cao

- [ ] R1 được nghiệm thu.
- [ ] X01–X06 được nghiệm thu theo nhà cung cấp và phạm vi đã chọn, hoặc có biên bản thay đổi phạm vi rõ ràng. Mục bị hoãn không được ghi là hoàn thành.

## 8. Mẫu cập nhật sau mỗi task

```text
Task ID / tên:
Người phụ trách:
Trạng thái:
Ngày bắt đầu / ngày kiểm tra cuối:
Hành động đã thực hiện:
Kết quả đạt được:
File / commit / PR liên quan:
Môi trường và lệnh kiểm thử:
Kết quả kiểm thử / ảnh / trace:
Điều kiện nghiệm thu còn thiếu:
Phụ thuộc hoặc quyết định đang chờ:
Rủi ro còn lại:
Bước tiếp theo:
Người xác nhận nghiệm thu:
```

Tài liệu này chỉ lập kế hoạch. Việc tạo tài liệu không đồng nghĩa các task đã được triển khai, kiểm thử lại, push lên GitHub hoặc triển khai lên server.
