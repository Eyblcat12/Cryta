# PROMPT THIẾT KẾ UI/UX — HỆ THỐNG QUẢN LÝ KHÓA MÃ HÓA VÀ CHỨNG THƯ SỐ

## Vai trò của bạn

Bạn là **Lead Product Designer kiêm Senior UX Engineer** chuyên thiết kế ứng dụng web enterprise, hệ thống an toàn thông tin và các quy trình nghiệp vụ có phê duyệt. Hãy thiết kế một mẫu UI/UX hoàn chỉnh, có chiều sâu sản phẩm, có thể dùng để trình bày đồ án và làm chuẩn bàn giao cho lập trình viên.

Không chỉ làm giao diện “đẹp”. Hãy tối ưu đồng thời cho:

- Hoàn thành tác vụ nhanh, ít nhầm lẫn.
- Hiểu đúng trạng thái và bước tiếp theo.
- Ra quyết định an toàn đối với thao tác nhạy cảm.
- Khả năng truy vết và tạo niềm tin.
- Khả năng truy cập theo WCAG 2.2 AA.
- Khả năng triển khai thực tế bằng React + TypeScript.

## Bối cảnh sản phẩm

Tên làm việc: **Crypta — Crypto Asset Lifecycle Manager**.

Đây là ứng dụng web giúp một tổ chức quản lý tập trung vòng đời của khóa mã hóa và chứng thư số. Hệ thống quản lý **metadata, quyền, quy trình, trạng thái, cảnh báo và Audit Log**; không phải công cụ tự xây thuật toán mã hóa hay một Certificate Authority hoàn chỉnh.

Quy trình nghiệp vụ chính:

1. Nhân viên tạo yêu cầu cấp mới, gia hạn hoặc thu hồi tài sản.
2. Backend kiểm tra quyền, phạm vi dữ liệu và policy.
3. Approver đúng phạm vi xem xét và phê duyệt hoặc từ chối.
4. Worker/crypto provider xử lý yêu cầu đã duyệt.
5. Tài sản và yêu cầu được cập nhật trạng thái.
6. Người dùng nhận thông báo; mọi hành động quan trọng được ghi Audit Log.

Các nguyên tắc không được vi phạm:

- Người tạo yêu cầu không được tự phê duyệt yêu cầu của mình (Separation of Duties).
- Security Admin không có quyền phê duyệt nghiệp vụ.
- Approver chỉ xử lý yêu cầu thuộc phạm vi/phòng ban được gán.
- Private key, token và mật khẩu không bao giờ được hiển thị hoặc ghi log.
- Audit Log chỉ được ghi thêm; không có thao tác sửa hoặc xóa.
- Tài sản đã `REVOKED` không thể chuyển lại `ACTIVE`.
- Gia hạn tạo tài sản kế tiếp và giữ nguyên lịch sử tài sản cũ.
- Mọi hành động nhạy cảm phải có giải thích hậu quả, bước xác nhận và phản hồi kết quả rõ ràng.

## Người dùng và mục tiêu

### 1. User / Employee

- Xem nhanh tài sản nào đang hoạt động hoặc sắp hết hạn.
- Tạo yêu cầu cấp mới, gia hạn hoặc thu hồi trong tối đa 2 phút và không quá 3 bước chính.
- Theo dõi trạng thái yêu cầu, lý do bị từ chối và bước tiếp theo.
- Nhận cảnh báo đúng lúc mà không bị quá tải thông báo.

### 2. Approver / Manager

- Nhìn thấy yêu cầu cần xử lý theo đúng phạm vi.
- Nhận biết ngay yêu cầu khẩn cấp, rủi ro và vi phạm policy.
- Mở một yêu cầu, hiểu đủ ngữ cảnh và đưa ra quyết định trong tối đa 60 giây.
- Không vô tình duyệt sai phạm vi, tự duyệt hoặc xử lý một yêu cầu đã được người khác quyết định.

### 3. Security Admin

- Xem sức khỏe tài sản mật mã toàn tổ chức.
- Quản lý tài sản, user, role, scope và policy.
- Tìm một Audit Log cụ thể trong tối đa 45 giây.
- Nhìn thấy job lỗi, policy không tuân thủ và tài sản gần hết hạn để hành động.

## Yêu cầu công việc

Hãy tạo một **high-fidelity interactive prototype** hoàn chỉnh cho cả desktop và mobile. Nếu môi trường cho phép tạo code, hãy tạo prototype chạy được; nếu chỉ có công cụ thiết kế, hãy tạo các frame và liên kết interaction có thể trình diễn.

Trước khi thiết kế:

1. Nếu được cung cấp source code/tài liệu dự án, hãy đọc và kiểm kê các màn hình, luồng, component và hành vi hiện có.
2. Giữ lại những hành vi đang hợp lý; chỉ thay đổi khi có lý do UX rõ ràng.
3. Nêu tối đa 5 giả định quan trọng nếu thông tin còn thiếu, sau đó tiếp tục thiết kế; không dừng lại chỉ để hỏi các chi tiết nhỏ.

## Phạm vi màn hình bắt buộc

### Nền tảng chung

1. Đăng nhập, phiên hết hạn và khôi phục phiên.
2. App shell: sidebar, topbar, breadcrumb, tìm kiếm, thông báo, hồ sơ và vai trò hiện tại.
3. Notification Center có phân biệt chưa đọc, mức ưu tiên và hành động tiếp theo.
4. Trang 403, 404 và trạng thái hệ thống/provider tạm gián đoạn.

### User

5. Dashboard cá nhân.
6. Danh sách tài sản của tôi.
7. Chi tiết tài sản dạng trang hoặc drawer, có metadata và timeline vòng đời.
8. Wizard tạo yêu cầu gồm ba loại: cấp mới, gia hạn, thu hồi.
9. Danh sách yêu cầu của tôi.
10. Chi tiết yêu cầu có status, timeline, policy result, lý do từ chối/lỗi và hành động tiếp theo.

### Approver

11. Dashboard phê duyệt.
12. Approval Queue có tìm kiếm, filter, sort, priority và pagination.
13. Chi tiết yêu cầu phê duyệt — đây là **màn hình ngôi sao** của prototype.
14. Dialog/phần xác nhận phê duyệt và từ chối; từ chối bắt buộc nhập lý do.
15. Trạng thái conflict khi người khác đã xử lý yêu cầu trước.
16. Lịch sử quyết định của Approver.

### Security Admin

17. Dashboard toàn tổ chức.
18. Danh sách và chi tiết tài sản toàn hệ thống.
19. Quản lý user, role và department scope.
20. Cấu hình policy có version, validation và màn hình so sánh thay đổi trước khi lưu.
21. Audit Log có filter nâng cao và chi tiết event.
22. Job/health monitoring cho expiry scan, notification và crypto provider.

## Luồng prototype phải bấm được

Prototype phải mô phỏng tối thiểu các luồng sau bằng dữ liệu thực tế, không dùng lorem ipsum:

### Luồng A — Cấp mới thành công

User tạo yêu cầu chứng thư số → xem policy preview → xác nhận gửi → request ở `PENDING` → Approver mở request → xem checklist → phê duyệt → request `PROCESSING` → `COMPLETED` → User thấy tài sản mới và thông báo.

### Luồng B — Thu hồi khẩn cấp

User chọn một tài sản đang `ACTIVE` → chọn lý do “Nghi ngờ lộ khóa” → bật mức khẩn cấp → đọc cảnh báo không thể hoàn tác → gửi → Approver thấy yêu cầu được ưu tiên → phê duyệt → tài sản chuyển `REVOKED` → timeline và Audit Log cập nhật.

### Luồng C — Từ chối có lý do

Approver mở yêu cầu vi phạm policy → chọn từ chối → bắt buộc ghi lý do cụ thể → User xem được lý do và biết cách sửa/tạo lại yêu cầu.

### Luồng D — Xung đột xử lý

Approver chuẩn bị phê duyệt nhưng yêu cầu vừa được người khác xử lý → hiển thị conflict rõ ràng → vô hiệu hóa quyết định cũ → cho phép tải dữ liệu mới mà không mất ghi chú chưa gửi.

### Luồng E — Admin truy vết

Admin dùng filter tìm event theo mã request/user/action/khoảng thời gian/result → mở chi tiết event → thấy actor, timestamp, target, kết quả và before/after đã che dữ liệu nhạy cảm.

## Kiến trúc thông tin và điều hướng

- Mỗi vai trò có dashboard phù hợp nhu cầu, không dùng một dashboard chung rồi chỉ đổi vài con số.
- Các vị trí chức năng chung phải ổn định giữa các vai trò.
- Menu chỉ hiển thị chức năng đúng quyền, nhưng giao diện phải thể hiện rằng backend vẫn là lớp kiểm soát quyền thực sự.
- Vai trò hiện tại luôn nhìn thấy cạnh tên/avatar.
- Mỗi trang chỉ có một primary action rõ nhất.
- Các tác vụ phổ biến không sâu quá 3 cấp điều hướng.
- Dashboard chỉ dùng chỉ số hoặc biểu đồ có thể dẫn đến hành động.
- Ưu tiên bảng dữ liệu, filter và contextual details cho màn hình nghiệp vụ dày đặc; tránh biến mọi nội dung thành card.

## Định hướng hình ảnh

Phong cách: **calm enterprise security** — hiện đại, chuyên nghiệp, đáng tin cậy, rõ ràng khi trình chiếu, có bản sắc riêng nhưng không phô trương.

- Dùng nền trung tính, xanh navy/xanh lam làm màu thương hiệu.
- Màu semantic: xanh lá = thành công/active; vàng hổ phách = cảnh báo; đỏ = nguy hiểm/revoked; xanh lam = thông tin/processing; xám = inactive/neutral.
- Không truyền đạt trạng thái chỉ bằng màu; luôn có label, icon hoặc mô tả.
- Typography có phân cấp mạnh, ưu tiên khả năng đọc tiếng Việt; dùng Inter hoặc system font.
- Hệ spacing 8px, bo góc nhất quán 8–12px, border tinh tế, shadow nhẹ chỉ khi cần phân tầng.
- Một bộ icon duy nhất, nét nhất quán; hành động quan trọng luôn có nhãn chữ.
- Không dùng gradient trang trí, glassmorphism, neon, 3D, emoji nghiệp vụ, card lồng card hoặc quá nhiều badge.
- Không làm giao diện giống landing page, ví điện tử hoặc dashboard crypto trading.
- Không lạm dụng biểu đồ; mọi biểu đồ phải có nhãn trực tiếp, giá trị và mục đích quyết định rõ ràng.
- Tạo cả light theme và dark theme chỉ khi có thể bảo đảm tương phản và đầy đủ trạng thái ở cả hai; nếu không, ưu tiên light theme hoàn thiện.

## Design system cần bàn giao

Định nghĩa và áp dụng nhất quán:

- Color tokens: brand, surface, text, border và semantic states.
- Typography scale và font weight.
- Spacing, radius, shadow, icon size và container width.
- Grid/layout desktop và mobile.
- Button: primary, secondary, ghost, danger; đủ hover, focus, active, disabled, loading.
- Form: input, select, combobox, date field, radio, checkbox, textarea; đủ hint, validation, error và disabled.
- Data table: sticky header, sort, filter, pagination, selection nếu cần và responsive behavior.
- StatusBadge, RiskBadge, ExpiryIndicator, Timeline, Stepper và ApprovalChecklist.
- Toast, inline alert, banner, tooltip, popover, drawer, modal và confirm dialog.
- EmptyState, Skeleton, ErrorState, ForbiddenState và OfflineState.
- SensitiveValueMask và nút copy có phản hồi.

Không hard-code màu hoặc khoảng cách tùy ý trong từng component. Hãy cung cấp tên token và quy tắc dùng, không chỉ một bảng màu rời rạc.

## Màn hình ngôi sao: chi tiết yêu cầu phê duyệt

Thiết kế màn hình này để Approver hiểu và quyết định nhanh mà không cần mở nhiều trang. Màn hình phải thể hiện:

- Mã request, trạng thái, mức ưu tiên và thời gian chờ.
- Người gửi, phòng ban, loại yêu cầu, tài sản liên quan và lý do.
- Tóm tắt rủi ro bằng ngôn ngữ dễ hiểu.
- Policy checklist: đạt, cảnh báo, không đạt; có giải thích cho từng mục.
- Kiểm tra SoD và phạm vi phê duyệt.
- Metadata cần thiết của tài sản nhưng không lộ dữ liệu bí mật.
- Timeline đầy đủ từ khi tạo đến trạng thái hiện tại.
- Ghi chú quyết định.
- Hai hành động “Từ chối” và “Phê duyệt yêu cầu” có hierarchy đúng; hành động nguy hiểm cần xác nhận.
- Trạng thái loading, stale data, conflict, forbidden và provider down.

## Dữ liệu mẫu tối thiểu

Dùng dữ liệu tiếng Việt thực tế và nhất quán:

- `CRT-FIN-SOON` — Chứng thư ký hóa đơn — RSA 2048 — còn 7 ngày — `EXPIRING_SOON`.
- `KEY-DEV-001` — Khóa máy chủ phát triển — RSA 2048 — `ACTIVE`.
- `KEY-DEVICE-021` — Khóa thiết bị thất lạc — yêu cầu thu hồi khẩn cấp.
- `REQ-2026-0105` — Cấp mới — `PENDING`.
- `REQ-2026-0103` — Thu hồi do nghi lộ khóa — `PENDING`, khẩn cấp.
- `REQ-2026-0098` — Thu hồi — `COMPLETED`.
- Tên mẫu: Nguyễn An (User), Trần Bình (User), Lê Minh (Approver), Phạm Hà (Security Admin).
- Phòng ban: CNTT, Kế toán, Nhân sự, An toàn thông tin.

Ngày giờ hiển thị thống nhất theo dạng `04/09/2026, 14:30 (GMT+7)`. Mã request/asset dễ quét bằng mắt và có nút sao chép.

## Trạng thái bắt buộc cho từng trang dữ liệu

Thiết kế rõ ràng, không chỉ ghi chú bằng chữ:

- Loading bằng skeleton giữ nguyên bố cục.
- Empty lần đầu có giải thích và CTA phù hợp.
- Empty sau filter có nút xóa filter.
- Partial data/stale data không che mất dữ liệu còn dùng được.
- Error có thông báo dễ hiểu, request ID và nút thử lại.
- Forbidden không làm lộ sự tồn tại hoặc nội dung dữ liệu ngoài quyền.
- Offline/provider down có banner degraded mode và hướng xử lý.
- Success cập nhật ngay bảng/timeline và có phản hồi phù hợp.
- Conflict giải thích dữ liệu đã đổi, giữ input người dùng và cho phép refresh.
- Session timeout giữ bản nháp nếu an toàn và đưa người dùng trở lại đúng ngữ cảnh sau đăng nhập.

## Form, microcopy và hành động nhạy cảm

- Label luôn hiển thị; placeholder không thay thế label.
- Validation gần field, dễ sửa và không xóa dữ liệu đã nhập khi submit lỗi.
- Dùng câu hành động cụ thể: “Gửi yêu cầu”, “Phê duyệt yêu cầu”, “Thu hồi tài sản”.
- Tránh câu chung chung như “Có lỗi xảy ra”; nói rõ điều gì sai và người dùng có thể làm gì.
- Với thuật ngữ RSA, ECDSA, key size, provider và policy, dùng helper text/tooltip ngắn cho người không chuyên.
- Trước revoke, role change hoặc policy change, mô tả chính xác hậu quả.
- Không dùng confirm dialog cho thao tác ít rủi ro.
- Toast chỉ xác nhận kết quả; thông tin quan trọng vẫn tồn tại trên trang hoặc timeline.

## Accessibility và responsive

Đạt WCAG 2.2 AA ở mức prototype/handoff:

- Contrast đủ cho text, icon, border và focus indicator.
- Điều hướng đầy đủ bằng bàn phím, thứ tự focus hợp lý, focus visible rõ.
- Modal/drawer trap focus, đóng bằng Escape và trả focus về trigger.
- Tên truy cập cho icon button; lỗi được liên kết với field; status async được thông báo mà không cướp focus.
- Target chạm tối thiểu phù hợp; không phụ thuộc hover.
- Hỗ trợ zoom/reflow và `prefers-reduced-motion`.
- Bảng trên mobile không chỉ co nhỏ chữ: chuyển sang card/list có thứ tự thông tin hợp lý hoặc cho cuộn ngang có chỉ dẫn khi thực sự cần.
- Kiểm tra tối thiểu tại 1920×1080, 1366×768, 768px và mobile 390px.
- Màn hình User phải sử dụng tốt trên mobile; màn hình Approver/Admin ưu tiên desktop nhưng vẫn không vỡ layout.

## Yêu cầu kỹ thuật nếu tạo code

- Sử dụng React + TypeScript + Vite.
- Có thể dùng Lucide Icons; không trộn nhiều thư viện icon.
- Tách component và design tokens rõ ràng, tránh dồn toàn bộ vào một file.
- Dùng semantic HTML và ARIA đúng mục đích; không thêm ARIA dư thừa.
- Dùng dữ liệu mock tập trung và mô phỏng latency/error/conflict để review được các trạng thái.
- Không cần backend thật, đăng nhập thật hoặc gọi API thật cho prototype.
- Không tạo nút chết: mọi CTA chính phải hoạt động hoặc mô phỏng phản hồi hợp lý.
- Không hiển thị raw UUID, JSON hay stack trace cho người dùng nghiệp vụ.
- Chạy build không lỗi và không có lỗi console nghiêm trọng.

## Đầu ra bắt buộc

Bàn giao theo thứ tự sau:

1. **Tóm tắt quyết định thiết kế:** người dùng, nhu cầu, ưu tiên, giả định và rủi ro chính.
2. **Sitemap và user flows:** ba vai trò, luồng happy path và critical recovery path.
3. **Design system:** token, component, trạng thái và quy tắc sử dụng.
4. **Prototype high-fidelity:** đủ các màn hình và luồng bắt buộc, có desktop/mobile.
5. **State coverage:** loading, empty, error, forbidden, offline, success, conflict và session timeout.
6. **Accessibility notes:** keyboard, focus, contrast, screen reader và reduced motion.
7. **Implementation handoff:** cấu trúc component, responsive rules, interaction details và nội dung/microcopy.
8. **Tự đánh giá:** đối chiếu prototype với checklist nghiệm thu bên dưới và nêu điểm nào chưa hoàn thành.

Nếu có thể xuất ảnh, hãy cung cấp ít nhất:

- Dashboard của cả ba vai trò.
- Approval Queue.
- Màn hình chi tiết yêu cầu phê duyệt.
- Wizard tạo yêu cầu.
- Asset detail/timeline.
- Policy diff.
- Audit Log.
- Một màn hình mobile User.

## Checklist nghiệm thu

Chỉ coi công việc hoàn thành khi:

- Trong 30 giây, người xem hiểu vai trò hiện tại, việc cần làm ngay và trạng thái của tài sản/yêu cầu.
- Ba vai trò có dashboard và điều hướng đúng nhu cầu/quyền.
- Các luồng chính có thể bấm từ đầu đến cuối.
- Màn hình phê duyệt thể hiện rõ SoD, scope, policy, rủi ro và lịch sử.
- Mỗi trang dữ liệu có đầy đủ loading, empty, error và recovery state.
- Form giữ dữ liệu khi lỗi và validation chỉ rõ cách sửa.
- Không có secret/private key, dữ liệu lorem ipsum, nút chết hoặc trạng thái mơ hồ.
- Màu trạng thái luôn đi kèm text/icon; tương phản và focus đạt yêu cầu.
- Giao diện dùng tốt tại 1366×768 và không vỡ ở mobile 390px.
- Design system nhất quán và đủ rõ để lập trình viên triển khai.
- Prototype ưu tiên hiệu quả, rõ ràng và độ tin cậy hơn hiệu ứng trang trí.

## Cách bạn phải trả lời

Hãy bắt đầu bằng một đoạn ngắn xác nhận bạn đã hiểu bài toán và liệt kê các artifact sẽ tạo. Sau đó **tiến hành thiết kế/prototype ngay**, không chỉ đưa ra lời khuyên chung hoặc một bản mô tả ý tưởng. Khi phải chọn giữa vẻ đẹp và độ rõ ràng nghiệp vụ, ưu tiên độ rõ ràng; khi phải chọn giữa nhiều tính năng và một luồng hoàn chỉnh, ưu tiên luồng hoàn chỉnh có trạng thái phục hồi.

