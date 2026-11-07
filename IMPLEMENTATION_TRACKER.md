# Theo dõi hoàn thiện theo kế hoạch

## Cập nhật ngày 07/11/2026

### Hồi quy điều hướng T30

Bộ 180/180 ca Chromium với API fixture đạt trên build tắt fade của `39e4a3c`. Firefox đạt 24/24 tổ hợp vai trò, theme và viewport. Hai trình duyệt cũng qua ca giữ phản hồi mã trang Chính sách đến sau khung hình điều hướng. [Chromium](tools/test-artifacts/n6-focus-layout-scoped/chromium-off-39e4a3c/results-chromium.json) · [Ma trận Firefox](tools/test-artifacts/n6-focus-layout-scoped/off-firefox-L-matrix/results-filtered.json)

NAV-22 tái hiện chunk JavaScript đã mất trả HTTP 200 với SPA trên cấu hình cũ. Sau sửa, Nginx trả 404 cho ba URL tệp đã mất, giữ đúng MIME của JS/CSS hiện hành, JSON cho cả API có thật và API 404, và HTML cho năm URL điều hướng. Hai ca Chromium mở trực tiếp rồi F5 ở trang tài sản và yêu cầu cùng đạt. Đã dọn cả hai stack Docker thử. [Trước sửa](tools/test-artifacts/integration/crypta-t30-test-4bd6e7a1c5c4/real-chromium-1794060199245/results.json) · [Sau sửa](tools/test-artifacts/integration/crypta-t30-test-5c6618c73085/real-chromium-1794060251412/results.json)

Bảng Tài khoản căn chiều cao tối thiểu của hàng dữ liệu theo hàng tải ở 1440 và 390 px. Khi mở trang từ menu mobile, focus đi đến tiêu đề. Đóng menu tại cùng trang trả focus về nút mở. Khi mã trang Chính sách tải chậm, bộ kiểm giữ phản hồi đến sau khung hình điều hướng rồi xác nhận tiêu đề nhận focus sau khi xuất hiện. Frontend đạt 148/148 kiểm thử đơn vị. Chromium trên stack Docker cách ly đạt ca mở Chính sách bằng bàn phím ở 390 px, giữ cùng tài liệu và không gọi fade. Bộ hồi quy trình duyệt chạy được với cả hai cấu hình fade. [Báo cáo stack](tools/test-artifacts/integration/crypta-t30-test-c61fa8c1cf04/real-chromium-1794059484065/results.json) · [Hướng dẫn chạy](tools/testing/README.md)

### T30/N6 trên cây mã `4d50242`

Chromium 151.0.7922.34 chạy ba vòng luân phiên bật/tắt fade, 12 lượt chuyển trang mỗi mẫu tại 1440 và 390 px. Cấu hình mô phỏng CPU chậm 4 lần, mạng trễ 80 ms và API fixture. Cả 12 mẫu hoàn thành. Trace ghi số tác vụ trên 50 ms qua `PerformanceObserver` và ghi riêng công việc renderer.

| Khung nhìn | Tác vụ trên 50 ms khi bật | Khi tắt | Tổng dịch chuyển bố cục mỗi mẫu |
| --- | --- | --- | --- |
| 1440 px | 13 | 0 | 0,1683–0,1688 |
| 390 px | 25 | 10 | 0,4610 |

Khi bật, 29/72 tác vụ renderer chứa bước bắt đầu hiệu ứng dài trên 50 ms. Bước gọi `Element.animate` mất tối đa 4,50 ms. Trace ghi công việc dài cả khi tắt và số liệu không quy hết phần chênh lệch cho fade. Theo tiêu chí N6, image Docker mặc định tắt fade khi chuyển trang. Chromium qua Nginx/PostgreSQL xác nhận chuyển từ Tài khoản sang Audit Log trong cùng tài liệu, focus đến tiêu đề và không gọi animation ở vùng nội dung. T30 còn nghiệm thu toàn ma trận, trình đọc màn hình và môi trường triển khai. [Số đo](tools/test-artifacts/n6-4d50242/comparison.json) · [Trace đã phân tích](tools/test-artifacts/n6-4d50242/root-task-analysis.json) · [Ca kiểm image](tools/test-artifacts/integration/crypta-t30-test-35384ed3d537/real-chromium-1794058183471/results.json)

T07, T08, T15, T18 và T20 đã tích hợp các mẫu được duyệt. T04 có CLI Admin đầu tiên và schema cài mới an toàn. Nhánh ứng viên đã được đẩy lên repo, CI GitHub có 419 backend, 147 frontend, 6 SMTP loopback và 158 nhóm tích hợp đạt. Required checks còn bị giới hạn bởi gói repo private. Tiến độ hiện hành và các cổng còn mở nằm ở [bảng task](TASK_STATUS_2026-11-05.md), [trạng thái](PROJECT_STATUS.md) và [bằng chứng CI](docs/CI_REMOTE_2026-11-07.md).

## Lịch sử các pha

T18 bổ sung mốc provider và quyết định vào lịch sử phân trang theo quyền, sửa nhãn và phiên bản policy trong chi tiết. Backend 305/305, frontend 145/145. DB và mẫu danh mục Approver còn chờ kiểm/duyệt. [Bằng chứng T18](T18_ASSET_LINEAGE_2026-11-06.md).

T17 bổ sung sắp xếp cho năm danh sách, sửa bộ lọc audit không có page và thêm tìm kiếm thông báo. Backend 304/304. Fixture lớn và query plan đang chờ kiểm DB. [Bằng chứng T17](T17_SERVER_LISTS_2026-11-06.md).

T15 đã tích hợp giao diện theo mẫu được duyệt, frontend 144/144 và hai build đạt. Kiểm trình duyệt qua Nginx còn chờ do hạn mức duyệt lệnh Docker. [Bằng chứng T15](T15_PROVIDER_RECOVERY_2026-11-06.md).

T16 đã thêm kiểm cấu hình, metadata HTTP, thời hạn từ PEM và phạm vi provider trên tài sản. PostgreSQL trước 015 đạt worker 27/27, API runtime LOGIN 39/39. Migration 015 sửa liên kết ba khóa mẫu, đang chờ kiểm DB. Chọn provider và nghiệm thu sandbox vẫn còn mở. [Bằng chứng T16](T16_HTTP_ADAPTER_2026-11-06.md).

T20 đã kiểm chứng API quản lý vòng đời policy trên PostgreSQL. Runtime LOGIN 34/34, worker 23/23, bất biến phiên bản 8/8. Bản xem trước đã qua kiểm tra tương tác ở hai kích thước và đang chờ duyệt để tích hợp. [Bằng chứng T20](T20_POLICY_LIFECYCLE_2026-11-06.md).

T07 đã nối luồng mời tài khoản và tự đặt lại mật khẩu qua email. Backend 265/265, frontend 136/136, runtime LOGIN 30/30, Edge/Chrome 6/6 luồng qua SMTP loopback. SMTP triển khai và nghiệm thu hộp thư còn mở. [Bằng chứng T07](T07_ACCOUNT_ACTIONS_2026-11-06.md).

T08 đã tích hợp quản lý đơn vị và chuyển tài khoản theo mẫu đã duyệt. Edge đạt 19/19, Chrome 12/12 UI, runtime LOGIN 24/24 và hồi quy Edge 26/26. [Bằng chứng T08](T08_DEPARTMENT_ADMINISTRATION_2026-11-06.md).

Lượt T24 tiếp ngày06/11 thêm tám mẫu thư nghiệp vụ có link/múi giờ và hai mẫu tài khoản chờ T07; worker enqueue kết quả cùng transaction qua migration010. Backend233/233, FE133/133/hai build, SMTP loopback10/10, preview20/20, link thật3/3, worker23/23, runtime LOGIN23/23, ledger10/10 và Edge26/26. [Bằng chứng T24](T24_EMAIL_TEMPLATES_2026-11-06.md).

Lượt T05 tiếp ngày 06/11 sửa request quản trị đã qua guard nhưng chờ khóa: sau khi người gửi bị thu hồi quyền hoặc khóa, transaction đọc lại actor và từ chối trước khi ghi. Đối chứng 2/8 → 8/8 nhóm API/DB; backend202/202/build, runtime LOGIN23/23, Edge integration26/26. [Bằng chứng T05](T05_USER_ADMINISTRATION_2026-11-06.md).

Lượt T09 ngày 06/11 đã nối UI lưu, sửa, gửi nháp và xác nhận hủy. Edge/Chrome có 24/24 nhóm mới, gồm mất phản hồi sau commit, hai tab cạnh tranh và giữ tham số/cờ khẩn khi sửa nháp. Frontend 133/133, hai build đạt. [Bằng chứng T09](T09_REQUEST_DRAFTS_2026-11-06.md).

Pha tương phản trước đó06/11: [sửa viền focus và nhãn radio](T30_FOCUS_CONTRAST_2026-11-06.md),600/600 kiểm màu/cận gradient trên ba browser ON/OFF đạt, thấp nhất4,64449:1; native radio keyboard12/12/hai build đạt. Snapshot206 file và bằng chứng giữ phạm vi pha đó. T30/screen reader/N6 vẫn mở.

Cập nhật focus06/11: [sửa Tab thoát dialog đang gửi](T30_DIALOG_FOCUS_2026-11-06.md), before0/16 →96/96 nhóm trên Edge/Chrome/Firefox, ON/OFF, desktop/mobile và hai theme. **FE131/131,180/180 hồi quy mỗi browser, visual4/4 và hai build đạt**; JS đổi sangBWV_OzFu/DFRUkWzt, CSS giữ nguyên. Snapshot205 file/build/report/cleanup khớp;11 preview process/port/esbuild còn0. Chỉ WorkspaceUi.tsx đổi trong source ứng dụng; các ghi chú product byte-identical bên dưới thuộc pha trước sửa focus. DB/provider/SMTP không chạy lại; screen reader/N6 và toàn dự án chưa nghiệm thu.

Cập nhật tiếp06/11: [NAV20 network baseline12/12 mẫu](T30_USERS_NETWORK_2026-11-06.md) trên Edge/Chrome xác nhận cold Users7→3 GET và503+retry14→4, không đọc bảng ngoài nhu cầu Users; đây là fixture comparison với source Git trước routing, không latency/deployment proof. [Skeleton gộp hàng](T30_SKELETON_BANDS_2026-11-06.md)40/40 geometry nhưng24 mẫu benefit đổi dấu, không tích hợp. Product source/build giữ nguyên; N6 và T30 vẫn mở.

## Lượt mới nhất06/11/2026 — T30 với GET thật bị trễ

[Integration mới26/26 mỗi Edge/Chrome](T30_DELAYED_GET_2026-11-06.md) thêm ba race Assets qua relation lock PostgreSQL thật: đổi route, logout→account khác, ADMIN→USER. Browser hủy read cũ và giữ đúng owner/scope; mỗi ca một document/không tải thêm script, không business mutation từ UI. Holder session đã đóng; backup11/11,17 bảng/sequence khớp, dọn stack test0/0/0 và giữ8 container ngoài test. Snapshot204 file/build/12 compiled hashes khớp. Product FE/BE giữ nguyên; unit không chạy lại. T30 còn N6, screen reader/native close, network baseline và ma trận ngoài ba ca desktop này.

## Lượt trước06/11/2026 — API bằng runtime LOGIN

[T43 runtime LOGIN](T43_RUNTIME_LOGIN_2026-11-06.md) đạt **19/19 nhóm** PostgreSQL/API thật: ba role tách biệt, cấp lại quyền thu hồi ACL dư cả từng cột,7 cấu hình nguy hiểm bị từ chối không đổi ACL,21 lệnh cấm deny, luồng nghiệp vụ/rollback/concurrency và password rotation. Backend **186/186**/build thuộc lượt05/11, application source giữ nguyên qua resume; frontend giữ131/131 lịch sử và build byte-identical. Parent Compose vẫn bootstrap/apply local/demo, API con riêng dùng runtime/validate. Ngoại lệ UPDATE khóa dòng, rollout, T30/N6 và các cổng nghiệp vụ/provider/SMTP/deploy còn mở; không đóng task từ riêng ma trận xanh.

## Lượt trước 05/11/2026 — runtime ledger chỉ đọc

Backend **172/172**, migration focused **16/16**, build đạt. Startup mặc định validate ledger trong transaction read-only; operator CLI migrate riêng, Compose demo explicit apply. PostgreSQL role SELECT-only đạt **10/10**, sáu lệnh DDL/DML deny42501. Backend test validate khởi động giữ đủ version/checksum/applied_at; worker23/policy8/expiry13, Edge23/Chrome23 và backup11 đều đạt. Đã dọn stack test, tám container ngoài test giữ danh tính. Snapshot199 file/compiled/build/report/dump/cleanup khớp.

[Runtime ledger và giới hạn](T43_RUNTIME_LEDGER_2026-11-05.md), [runbook](DATABASE_MIGRATIONS.md), [tiến độ](PROJECT_PROGRESS_2026-11-05.md), [54+6 task](TASK_STATUS_2026-11-05.md). T43 còn provision/grants toàn ứng dụng, LOGIN/rotation/rollout; API test vẫn bootstrap credential. T30/N6 và các cổng nghiệp vụ/provider/SMTP/deploy giữ mở.

## Lượt trước 05/11/2026 — worker, dependency, parser và N6

Worker bổ sung preflight/final snapshot và dùng resolver chung; parser client errors giữ 400/413/415 với thông báo an toàn. FE **131/131**, BE **161/161**, ba build đạt. Dependency audit trước sửa BE all13/production8/FE4 → **0 cả ba scope**; CI đã gọi audit/build/test cho cả package, chưa có remote CI proof.

Image cuối đã kiểm worker DB **23/23**, policy **8/8**, expiry **13/13**, parser HTTP **3/3**, API/DB/Nginx **23/23 mỗi Edge/Chrome**, backup/restore **11/11** với 17 bảng/sequence khớp. Stack test đã dọn 0 container/volume/network, tám container ngoài test giữ nguyên danh tính. Snapshot từng pha giữ source/image riêng.

N6 emission probe **7/7** xác nhận debug categories thực phát dù enumeration rỗng. Capture ứng dụng **3/4**, ON390 lỗi route assertion ở650ms; trace thu hẹp workload tới skeleton Users 25 hàng/150 TD/175 span, chưa chứng minh toàn bộ chi phí native hoặc đủ hiệu năng. Không tích hợp thử nghiệm CSS chưa kiểm chứng. Sáu file build frontend byte-identical với pha trước; fixture180 cả ba browser vẫn thuộc lượt06/10, không gọi là chạy lại.

[Tiến độ](PROJECT_PROGRESS_2026-11-05.md), [46 task đối chiếu ít nhất một phần và 8 chưa đối chiếu riêng](TASK_STATUS_2026-11-05.md), [nháp T09](T09_REQUEST_DRAFTS_2026-11-06.md), [healthcheck T44](T44_HEALTH_READINESS_2026-11-06.md), [worker](T14_EXECUTION_GUARDS_2026-11-05.md), [parser](T03_PARSER_ERRORS_2026-11-05.md), [security](T39_DEPENDENCY_SECURITY_2026-11-05.md), [DB hardening](T43_DB_HARDENING_REVIEW_2026-11-05.md). T30 và toàn dự án còn các cổng nghiệm thu. Provider, SMTP và môi trường triển khai thật chưa được chọn.

## Lịch sử 06/10/2026 — T30, worker, policy, thời gian và backup

Frontend **131/131**, fixture **180/180 mỗi Edge/Chrome/Firefox**, menu **72 nhóm/384 link**, detail **48/48**, reference **33/33**, UI mutations **16/16**, zoom native **12/12**. NAV-28 kiểm race đổi route cùng vai trò bằng fixture. Build ON/OFF `sWnhGYiW/DVxDFsDr/CRAMZK9_` đạt. N6 còn Layout Users dài; thử border model không cải thiện ổn định nên chưa tích hợp.

Backend **119/119** và build đạt. Worker poll nay quét PROCESSING quá hạn: BEFORE 2/3 → AFTER **12/12** DB thật. Published policy version được bảo vệ UPDATE/DELETE bằng trigger: BEFORE 6/8 → AFTER **8/8**. Expiry **13/13**; upgrade thực 7→8 giữ nguyên bảy checksum. API/DB/Nginx **23/23 mỗi Edge/Chrome** trên image backend `73fdb9c…`; không gán các report image cũ cho source mới.

Backup sau migration 008 **11/11**, đủ 17 bảng/sequence khớp. Đã dọn stack test: container/volume/network **0/0/0**, trigger/function t30_ **0/0**; inventory có tám container ngoài test và ID/name/project giữ nguyên. Chưa nghiệm thu RPO/RTO production.

[T30](T30_PROGRESS_2026-10-06.md), [NAV](T30_NAV_ACCEPTANCE_2026-10-06.md), [T14](T14_WORKER_RECOVERY_2026-10-06.md), [T19](T19_POLICY_VERSION_2026-10-06.md), [T27](T27_EXPIRY_SCAN_2026-10-06.md), [T42](T42_BACKUP_RESTORE_2026-10-06.md), [54+6 task](TASK_STATUS_2026-10-06.md): **39 task chính một phần, 15 chưa đối chiếu riêng, 6 mở rộng chưa nghiệm thu, 0 đủ toàn tiêu chí R1**. Provider/SMTP/deployment chưa được chọn: [điều kiện dịch vụ thật](CAU_HINH_DICH_VU_THAT.md). T30 ưu tiên đầu và toàn dự án còn mở.

## Lịch sử 04/10/2026 — session nhiều tab, picker và scroll, T30 vẫn mở

- Native Web Locks serialize thao tác cookie theo origin; opaque revision chặn response của account cũ và làm sibling logout/account switch bỏ dữ liệu/draft. AssetPicker xác minh detail trước gửi, giữ reference khi503 và bỏ khi mất quyền; handler chặn submit trực tiếp. Scroll bỏ no-op đồng bộ và defer thao tác cần thiết trước paint.
- FE **131/131**, fixture **179/179 mỗi Edge/Chrome**, picker **5/5 desktop light và5/5 mobile dark**, hai build đạt trên bundle `BKxJgvfI/fQCdLjVQ/CTxLXPoY`. DB/API/Nginx thật **20/20 mỗi browser**; phase TTL12s **2/2 mỗi browser** dùng backend trước sửa logout.
- Logout server cũ đã tái hiện malformed500 và thu hồi session với actor/secret sai; source đã sửa format+owner+hash, BE **95/95**/build và **21/21 integration mỗi Edge/Chrome** trên image mới `dab40360…` đạt. Docker được khôi phục bằng dừng/mở lại, không reset volume. Đã dọn đúng stack test, trigger/function0/0, container ID vận hành giữ nguyên; TTL12s2/2 trước vẫn thuộc image cũ.
- N6 đo lại ba vòng sau cleanup, không build/test/parse song song: shift ON/OFF bằng nhau, web long task desktop16/2, mobile28/20;35/72 setup root>50ms,max205.368ms, có layout/paint dài cả OFF. Lượt after đầu4/3/28/17 giữ phạm vi nhiễu riêng; **N6 còn mở**, không suy causal từ counts/setup. N4 detail/empty/short/multiline, zoom Edge/screen reader và đủ NAV còn thiếu.
- [Bằng chứng và artifact](T30_PROGRESS_2026-10-04_SESSION_PICKER_PERF.md), [NAV audit](T30_NAV_ACCEPTANCE_2026-10-04.md), [loading review](T30_LOADING_REVIEW_2026-10-04.md), [thống kê](TASK_STATUS_2026-10-04.md). Giữ đủ T01–T54/X01–X06: **35 task chính một phần,19 chưa đối chiếu riêng,6 mở rộng chưa nghiệm thu,0 toàn tiêu chí R1**. Goal active; T30 vẫn ưu tiên đầu.

## Lịch sử 01/10/2026 — N4 danh sách/zoom thật/N6

- Requests/Notifications/lịch sử tài sản giữ footprint khi loading, snapshot cùng query khi 503 và khóa action; 403/đổi query bỏ dòng cũ. Sửa nút refresh Notifications mobile.
- Zoom Chrome thật 200% phát hiện/sửa textarea request bị panel cắt; **6/6 nhóm role/theme** đạt, gồm menu/skip/keyboard và bốn loại dialog. Còn zoom Edge và screen reader/các trạng thái khác.
- Bundle cuối `By2DuIlI/CTxLXPoY`, off `Div_QacB`: **174/174 fixture mỗi Edge/Chrome**, **18/18 tích hợp thật mỗi browser**, FE **123/123**/hai build đạt. Hai Approver khác nhau cạnh tranh quyết định: đúng một 201/409, một decision/audit; backend 75 file không đổi so với snapshot đã có 89/89/build.
- Nginx 17/17 trên bundle cuối; API smoke 13 khi khởi tạo DB riêng. Stack test đã dọn, operational container ID giữ nguyên; source archive 175 file và on/off archive đã kiểm hash/giải nén.
- Motion setup chuyển sang frame trước paint; N6 đã đo ba vòng on/off và phân tích cả root/lifetime layout/paint. Phép đo cuối tắt snapshot/polling locator: 72/72 setup root dưới 33.1 ms, shift on/off bằng nhau; web long task desktop on/off 7/7, mobile 17/13. **N6 vẫn mở** vì layout/paint Users dài ở cả hai mode và còn gate toàn matrix; không nghiệm thu từ riêng setup root.
- [Bằng chứng mới](T30_PROGRESS_2026-10-01_N4_ZOOM_N6.md), [thống kê](TASK_STATUS_2026-10-01.md): 35 task chính cập nhật một phần, 19 chưa đối chiếu riêng, 6 mở rộng chưa nghiệm thu riêng, 0 xác nhận toàn tiêu chí R1. Goal vẫn active; tiếp N6 → N4/L/N5/M còn thiếu theo plan.

## Lịch sử trước 01/10/2026 — M thật/N4

- Docker hoạt động; stack PostgreSQL/API/Nginx mới cách ly đạt smoke Nginx **17/17**, API **13 kiểm tra**, **18/18 nhóm tích hợp thật mỗi Edge/Chrome**. JWT/cookie/F5, scope/SoD, version, rollback và concurrency có report riêng.
- Sửa hai deadlock DB: advisory lock trước khóa dòng user ở status/access; auth khóa user trước session và recheck trước tạo/rotation. Có đối chứng refresh/access với delay DB, 200/409 Admin cuối và decision/audit đúng một lần.
- N4 mở rộng Assets/Queue/Audit/Email: skeleton/cột/card ổn định, GET refresh giữ cùng-key snapshot nhưng khóa action, 503 giữ/403 bỏ. **150/150 fixture mỗi browser**, frontend **123/123**, backend **89/89**, các build đạt. Bundle `DSwgZCwf/C6u-C_Yc`; off `ClRmUXps`.
- Artifact cũ đã diễn tập trên Nginx test với API mới: smoke/login/F5 đạt, backend/DB giữ nguyên. Stack test/network/volume đã dọn; container ID project vận hành `crypta` giữ nguyên.
- [Bằng chứng mới](T30_PROGRESS_2026-10-01_M_N4.md), [thống kê](TASK_STATUS_2026-10-01.md): **35 task chính cập nhật một phần, 19 chưa đối chiếu riêng, 6 mở rộng chưa nghiệm thu riêng, 0 xác nhận toàn tiêu chí R1**. Goal vẫn active, T30 ưu tiên đầu. Còn N4 resource/trạng thái thiếu, L/N5 zoom thực/screen reader, N6 trace mới và đủ NAV/M; không đóng task từ số test.

## Lịch sử trước 01/10/2026 — T30-L/N1 và chuẩn bị M

- Sửa ba lỗi đã tái hiện: trap/focus khi resize menu mobile, chữ dài/nhiều role bị cắt trong Users, control xác nhận bị footer sticky che. Review 24 tổ hợp role × theme × 1440/1024/768/390; có ảnh và kiểm tra focus/shell/overflow/cặp contrast được chọn.
- N1 có token fast/page/overlay và motion matrix; CSS và Web Animation dùng nguồn thời lượng chung. Hai checkbox token/matrix có bằng chứng. L chưa đóng: còn zoom thực 200%, screen reader và mọi page/dialog/trạng thái.
- **134/134 browser regression ở Edge và 134/134 ở Chrome**, bundle `index-BKb9ILUH.js` / `index-CyQ-uI6G.css`; frontend **123/123** unit test và production/motion-off build đạt. Backend gần nhất **89/89**; lát cắt này không sửa backend.
- Trace build mới đã đo 3 vòng luân phiên on/off, CPU 4×/mạng chậm: shift bằng nhau, tổng long task on/off desktop 27/25 và mobile 33/29; wrapper setup tối đa 13.6 ms. Raw trace có layout/FunctionCall nặng ở cả hai mode. N6 còn mở, chưa suy ra causal effect hoặc nghiệm thu từ setup dưới 50 ms.
- Runner Compose test PostgreSQL/API/Nginx riêng đã qua parser/prepare/config; lượt preflight daemon thất bại **trước khi tạo stack**. Docker Desktop thoát vì socket `dockerInference` không thể truy cập; M/DB/Nginx vẫn chờ kiểm thử.
- Bundle frontend on/off đã đóng ZIP, lưu manifest/SHA-256 và giải nén kiểm tra đủ 3 file mỗi bản; artifact nằm trong `tools/test-artifacts/frontend-artifacts/t30-l-n1-20261001/`. Chưa diễn tập rollback deployment thực.
- [Bằng chứng mới nhất](T30_PROGRESS_2026-10-01_L_N1.md), [motion contract](T30_MOTION_CONTRACT.md), [runner tích hợp](tools/testing/README.md). [Danh mục](TASK_STATUS_2026-10-01.md): **30 task chính cập nhật một phần, 24 chưa đối chiếu riêng, 6 mở rộng chưa nghiệm thu**, 0 task được xác nhận toàn tiêu chí. Goal vẫn active; tiếp L/N → M và phần còn lại theo phụ thuộc.

Mục NAV-21/N4 ngay dưới giữ bằng chứng trước lượt L/N1; số test/bundle trong mục đó là lịch sử.

## Lượt tiếp tục 01/10/2026 — T30-K/NAV-21 và N4

- NAV-21 có journal pending/unknown/confirmed cho 9 loại ghi; khóa thao tác trùng, GET kiểm tra dữ liệu và cảnh báo kết quả chưa xác nhận. Pending/unknown còn khi rời/reopen form, acknowledgment/phiên được kiểm tra; không tự POST lại, không lưu payload/draft trong journal/storage.
- Users API hỗ trợ userId/email chính xác với validation/quyền Admin trước DB; probe không còn phụ thuộc trang đầu. Metadata theo tài khoản được xóa khi logout/đổi quyền; callback/probe cũ không đóng form mới hoặc hồi sinh dữ liệu.
- L/N bổ sung skip-link focus main, mobile focus trap/Escape/heading, reduced-motion giữa phiên, fallback khi animate thiếu/lỗi và 10 lần chuyển nhanh. Còn ma trận viewport/zoom thực, screen reader, resize/dialog và nghiệm thu tích hợp.
- N4 dùng outline dashboard theo layout hiện có, skeleton policy/table/cột Users ổn định. Cùng query giữ snapshot và khóa write khi loading/503; khác query hoặc 403 bỏ dữ liệu cũ. 6 browser cases mới kiểm tra geometry/recovery ở desktop/mobile.
- **Mới nhất:** frontend **123/123** unit test và production/motion-off build đạt; **106/106 browser regression trên Edge và 106/106 trên Chrome**, cùng bundle `index-3gwoFFVU.js`/`index-CCUgmGPJ.css`. Backend **89/89** và build đạt ở lượt NAV-21 trước khi dừng, N4 không sửa backend. Đây là fixture UI + unit, chưa thay DB/Nginx.
- Trace CPU 4×/mạng chậm: tổng layout shift chuỗi đo sau N4 0.1560 (1440 px), 0.4010 (390 px), bằng nhau giữa motion on/off; mẫu không còn shift không có recent input. **N6 chưa đạt:** long task vẫn có, lượt on ghi nhiều hơn off; chưa xác định tác động causal của motion. Đây không phải Core Web Vitals CLS hoặc nghiệm thu hiệu năng chung.
- Docker daemon vẫn chưa kết nối; đã yêu cầu Docker Desktop khởi động nhưng chưa xác minh hoạt động. Cổng M JWT/cookie/DB/concurrency/Nginx mã mới vẫn chờ kiểm thử.
- Bằng chứng và giới hạn: [T30_PROGRESS_2026-10-01.md](T30_PROGRESS_2026-10-01.md). [Danh mục đủ 54 task + 6 mở rộng](TASK_STATUS_2026-10-01.md) ghi 29 task cập nhật một phần, 25 chưa đối chiếu riêng; 0 task được nghiệm thu toàn tiêu chí qua đợt này. Giữ T30 ưu tiên số 1; tiếp L/N1/N2/N4/N6 → M, rồi các task còn lại theo plan.

Các mục có ngày cũ bên dưới là lịch sử, không thay bằng chứng mới nhất hoặc đóng các cổng còn thiếu.

## Lượt tiếp tục 30/09/2026 — theo đúng ưu tiên T30

- Đã tách `AppShell`/`Outlet`, pages/dialog/shared UI, User workspace và trang chi tiết riêng theo T30.1. Queue mở chi tiết bằng request ID; Admin không có action tạo/gia hạn/thu hồi tài sản hay duyệt yêu cầu nghiệp vụ.
- User assets và selector gia hạn/thu hồi dùng phân trang API; asset được chọn đọc lại bằng ID. Lịch sử Approver không còn giới hạn ba dòng. Timeline có link lineage bằng ID theo scope. URL/query/page và ngữ cảnh quay lại được giữ; scroll có một chủ sở hữu, chờ dữ liệu bảng khi Back.
- Tải resource/lỗi/retry độc lập; unread thất bại vẫn giữ dashboard/assets. Bảng/timeline truyền AbortSignal, giữ guard response cũ. Dialog bỏ thay đổi xử lý đúng lớp focus/Tab/Escape.
- Tiếp theo đã tách `useAuthSession`: safe returnTo giữ deep link/query, role được cấp phù hợp route, role switch áp dụng sau blocker; logout/expiry/quyền thay đổi xóa form/dữ liệu. API generation bỏ response cũ kể cả transport bỏ qua abort; refresh chung và không retry thao tác thuộc scope cũ. Refresh outage giữ input; restore outage có retry. Logout/password change không cho F5/refresh cũ khôi phục phiên client đã kết thúc.
- Lượt F đã chuyển dashboard/policies/request/detail/bảng/reference sang resource của từng feature; shell chỉ đọc summary/unread và giữ qua route. `useResource` abort/guard theo key/revision; lỗi không hiện thành empty hoặc 0, refetch giữ draft khi outage và bỏ khi mất quyền. Mutation chỉ tăng revision nguồn liên quan. Dashboard User lấy aggregate toàn owner, priority ID ngoài 250; backend kiểm tra role dashboard được cấp. Đã sửa chuyển trang sau gửi request để không hiện blocker với dữ liệu đã lưu.
- Lượt E/H mới đối chiếu scope service: list mặc định ưu tiên ADMIN/APPROVER, detail cho owner/creator và Approver trong phạm vi. Thêm `ownedOnly`/`createdByMe` lấy ID từ phiên cho page cá nhân/selector; false/không truyền giữ scope cũ. UI xét toàn bộ role đã cấp khi chặn ADMIN tạo/duyệt, và owner/creator/department/state/version khi bật action; không đổi guard nghiệp vụ backend.
- Lượt I/J/K hoàn thiện parser q/status/page/pageSize theo API, chuẩn hóa bằng replace; đổi filter/size về page 1, giữ context qua detail/Back/Forward/F5, sửa page Users vượt tổng sau mutation. Queue/footer giữ control/focus khi loading/error/empty; query scroll chờ hàng tải và đặt bảng dưới topbar. Search theo trang với nhãn đích; cảnh báo có filter đúng, thông báo 403/404/missing target giữ lỗi và không mark read; unread one/all cập nhật tổng toàn scope.
- Request/user/access/policy dirty đã kiểm tra native reload; khôi phục giá trị gỡ beforeunload, draft không vào URL/storage. Đổi target/policy và Back/discard bảo vệ input; dialog tạo user đóng sau route commit. Còn mutation mất mạng/kết quả chưa rõ NAV-21 và đóng tab thủ công/browser khác.
- **Kiểm chứng mới:** frontend **104/104**, backend **86/86** unit test và cả hai production build đạt; **78/78 browser regression** trên bundle `index-2BE84YB2.js` bằng HTTP fixture cách ly. Lượt I/J/K thêm 16 frontend, 2 backend numeric guard và 25 browser cases. Không thay cho integration DB/SMTP/provider hoặc nghiệm thu T30.
- Response contracts đọc đã tách theo assets/requests/notifications/users/policies/audit/dashboard; wire dates và model hiển thị tách riêng, không còn `any` ở API đọc/callback bảng. TypeScript strict build đạt.
- Bằng chứng, bảng ownership/scope, hợp đồng API tối thiểu và mapping NAV: [T30_PROGRESS_2026-09-30.md](T30_PROGRESS_2026-09-30.md). Bản hiện tại chưa được nghiệm thu trên Nginx/DB; summary/lifecycle và personal filters mới cần triển khai cả backend/frontend. Ưu tiên tiếp: K/NAV-21 kết quả thao tác chưa rõ → L/N trace/browser → M session/object scope/SoD integration và tổng hợp NAV. T30 vẫn đang làm.

Các bảng và số liệu dưới đây là lịch sử từng lát cắt; kết quả hiện tại ở mục 01/10/2026 đầu tài liệu. Không coi các cổng còn thiếu là đã hoàn thành.

## Tiếp tục ngày 30/09/2026 — T30 vẫn đang làm

- Đã triển khai lát cắt motion của T30-N: entrance fade 160 ms cho main sau khi route hợp lệ đổi; shell giữ nguyên; không chạy ở lần tải đầu, query/theme/detail hoặc qua ranh giới phiên/role. `prefers-reduced-motion` và thiếu Web Animations API đều hiển thị nội dung ngay. Chỉ báo đồng bộ chung trễ 180 ms và nằm ngoài luồng bố cục. Đây chưa phải native crossfade/shared-element.
- Đã sửa route lạ trả 404 thay vì 403, chuyển focus vào heading 403/404 và chặn mở modal tạo yêu cầu khi role không được phép. Kết quả detail đến muộn bị bỏ theo route/session; request tải chung truyền `AbortSignal` để hủy khi đổi route/phiên. Unit test kiểm tra hủy request và lỗi mạng; vẫn cần E2E luồng phiên.
- Admin Assets, Audit, Email và User Requests đã dùng `q`/`status`/`page` từ URL; Approver Queue dùng `q`/`emergency`/`page`; Notifications dùng `page`. Trang vượt tổng được thay bằng trang hợp lệ sau khi nhận đúng page. Back/F5 tái lập bộ lọc, query không kích hoạt hiệu ứng toàn trang. Admin Users đã có URL query từ trước.
- Frontend `npm test` đạt 37/37, production build đạt; backend 65/65 unit test và build đạt. Browser trên Docker local đã xác minh Admin Assets/Audit/Email/404 (focus heading), User Requests deep link, Approver Queue deep link/xóa lọc/Back và Notifications page vượt tổng. Phiên thử đã trả lại Admin. Chưa chạy browser reduced-motion, mobile/zoom mới hoặc mutation E2E đầy đủ ba role.
- Docker Desktop ban đầu chưa chạy, sau đó khởi động thành công. Đã build/recreate **chỉ frontend**; PostgreSQL, Redis và backend giữ nguyên. Phát hiện Nginx `/assets` bị redirect sang `/assets/` rồi 403 do trùng thư mục static; đã sửa SPA fallback và thêm `tools/smoke-spa-routes.ps1` chỉ đọc. Smoke bằng Windows PowerShell 5 đạt 17/17 (15 direct route, JS asset, API health). Chưa kiểm thử SMTP/provider thật, chưa push thay đổi local hoặc nghiệm thu T30/T30-N/toàn dự án.

## Ưu tiên mới ngày 28/09/2026

**Task thực hiện đầu tiên: T30 — Dashboard theo trang với client-side routing.** Đặc tả đầy đủ T30-A đến T30-N, bảng route/quyền, quy tắc URL/dữ liệu/form/motion và 30 kịch bản NAV-01 đến NAV-30 nằm trong [kế hoạch hiện tại](KE_HOACH_HOAN_THIEN_DU_AN.md). Trạng thái: **đang triển khai; lát cắt route/menu/page đầu tiên đã chạy được nhưng chưa đủ Definition of Done T30**. Chuyển main content theo menu, giữ shell và theme; ưu tiên này thay thứ tự triển khai trước đây, không giảm các cổng P0.

| Mốc T30 | Công việc | Trạng thái |
| --- | --- | --- |
| A–C | Baseline, route/quyền/hợp đồng, preview theo hướng đã chốt | Đã kiểm kê dirty tree, baseline build đạt; route manifest/quyền đã mã hóa; hướng chuyển trang đã được chủ dự án duyệt. Có bảng ownership và trạng thái loading/error/empty được test; còn tổng hợp preview đủ bốn trạng thái |
| D–F | Router/shell, phiên/quyền, ownership dữ liệu theo page | AppShell/Outlet/session boundary, role blocker, resource ownership/contracts, pending/error/retry, dashboard role và ma trận scope/default/personal đã có bằng chứng local. Còn JWT/cookie/object scope/DB thật |
| G–H | Di chuyển màn hình Admin, User, Approver | Menu/page ba role, selector API-paged, lịch sử Approver/detail ID, dashboard toàn aggregate; personal filters và SoD/metadata guards cho multi-role. Còn hợp đồng/phòng vệ/concurrency API thật |
| I–K | URL/history/detail, search/notifications, form chưa lưu | Parser/pageSize/replace/clamp/history/scroll; search/card filters/notification errors và unread toàn scope; dirty bốn form/target switch/native reload có fixture. Còn NAV-21 mất mạng/kết quả mutation chưa rõ, đóng tab thủ công và đường lỗi tích hợp |
| L–M | Trợ năng/theme/mobile, test/triển khai/tài liệu | 104 frontend/86 backend unit test, 78 browser fixture; cả hai build mới đạt. Còn zoom thực, browser thứ hai, integration DB/job, Nginx smoke mã mới và tổng hợp đủ NAV |
| N1–N6 | Motion SPA: contract, prototype, tích hợp router, pending, trợ năng, regression | Entrance fade 160 ms, pending trễ 180 ms, reduced-motion/fallback, shell/query/detail và scroll restoration có bằng chứng. Còn reduced-motion giữa phiên, 10 lần chuyển nhanh, CPU/performance trace/zoom và deployment. Shared-element là nâng cao |

### Bổ sung phạm vi ngày 28/09/2026 — motion và review nhánh ngoc

- T30-N đã có lát cắt motion trong UI local; kế hoạch vẫn là tiêu chí nghiệm thu chưa hoàn tất. T30-N có hành động/kết quả/điều kiện đạt/phụ thuộc cho từng bước, nguồn React Router/Carbon/Fluent/web.dev.
- Nhánh review: `origin/ngoc` tại `7303064`, so với `origin/main` nền `ff1478c`; dùng checkout riêng để không ghi đè thay đổi T30 chưa commit. Quyết định và bằng chứng tích hợp được ghi trong `NGOC_BRANCH_REVIEW.md`.
- Kết quả: chỉ chọn pool idle-error fix, giữ tác giả qua cherry-pick; thêm log an toàn + 4 test và push GitHub main `105d104`. Build và 22/22 test trên nền main đạt; workspace backend 65/65 test + build đạt. Không chạy E2E có side effect, không redeploy; các thay đổi T30 và plan local chưa push. Credential trong test nhánh ngoc cần chủ database thu hồi/rotate nếu còn hiệu lực.

### Bằng chứng T30 — lát cắt ngày 28/09/2026

- Dependency: `react-router@7.18.2`, tương thích React 18/Node hiện tại; `npm audit` sau nâng cấp: 0 lỗ hổng.
- Tự động: `npm test` đạt 2 file/23 test; `npm run build` đạt với Vite 6.4.3; `npm audit --omit=dev` báo 0; `git diff --check` đạt.
- Browser tại `http://127.0.0.1:5173`: `/dashboard → /users → /policies`; Back/Forward, refresh trực tiếp `/policies`, active menu, title và focus heading đạt. ADMIN mở `/approvals` chuyển `/forbidden`; route lạ hiển thị 404.
- Responsive/theme: dark desktop và mobile 390×844 đã kiểm tra; menu mobile mở, chọn Chính sách, đổi URL/nội dung và tự đóng. Viewport kiểm thử đã reset về mặc định.
- Ownership dữ liệu: Users không còn kéo mảng assets/policies/requests từ `App`; resource con được làm mới bằng revision có chủ đích thay cho `refreshKey={assets}`. Dashboard summary và unread count vẫn là dữ liệu shell dùng chung.
- Form dirty: policy và tạo user đã được kiểm tra bằng bàn phím trên dev; “Ở lại” giữ nguyên giá trị, “Bỏ thay đổi” mới chuyển trang/đóng modal. Bản Docker/Nginx 8080 cũng đã smoke policy blocker; không submit mutation trong kiểm thử.
- Query Users: `q`, `status`, `page` là nguồn trạng thái đã áp dụng; F5 giữ bộ lọc, `page=-2`, `status=BAD`, khoảng trắng và trang vượt tổng đều được chuẩn hóa bằng replace. Browser đã xác minh `/users?q=Nguyễn` sau reload vẫn trả đúng 2 dòng và `page=999` được đưa về trang hợp lệ.
- Triển khai: image frontend mới đã build, container frontend được recreate riêng bằng `--no-deps`; direct `/users`, `/policies`, `/assets/example-id` trả 200 HTML shell và `/api/v1/health` trả 200. Lần Compose trước đó tự recreate backend dependency; sau đó backend 61/61 test đạt và container healthy.
- Chưa đánh dấu T30 hoàn tất: chưa có E2E đủ ba role, route query đầy đủ, tách file page/layout theo Outlet, AbortSignal và browser test dirty-form cho request/access.

**Ghi nhận task đã dừng ngày 28/09:** `backend/src/requests/request-policy.ts` có chỉnh sửa dở trước yêu cầu dừng và tại thời điểm đó chưa được test/build. Lượt 30/09 đã chạy lại backend 65/65 unit test và build trên toàn bộ workspace; kết quả này vẫn không thay cho integration nghiệp vụ hay nghiệm thu T19.

Kế hoạch backlog chi tiết ngày 27/09/2026: [KE_HOACH_HOAN_THIEN_DU_AN.md](KE_HOACH_HOAN_THIEN_DU_AN.md), gồm hành động, kết quả bàn giao, điều kiện nghiệm thu và phụ thuộc cho từng task. Bảng dưới đây giữ nguyên trạng thái lịch sử; chưa phải kết quả kiểm thử lại ngày 27/09.

## Tiến độ triển khai ngày 27/09/2026

| Task | Đã thực hiện trong mã nguồn | Còn cần trước khi nghiệm thu task |
| --- | --- | --- |
| T01 | Chạy lại backend 61/61 unit test; build backend/frontend đạt; kiểm kê thay đổi Git | Smoke/integration trên DB cách ly; ghi runtime và cấu hình máy mới |
| T03 | Chuẩn hóa alias tham số trước khi lưu, dùng chung ở worker; chặn alias mâu thuẫn/field lạ; kiểm tra cả gia hạn | OpenAPI đầy đủ, E2E và kiểm tra tham số với provider thật |
| T04 | Migration có khóa chống hai instance chạy cùng lúc, checksum và từ chối version lạ; thêm migration trạng thái đối soát | Test nâng cấp/cài mới trên PostgreSQL thật, tách demo seed và quyền migration |
| T05 | Đổi trạng thái, thu hồi phiên và audit cùng transaction; kiểm tra admin hoạt động cuối có khóa giao dịch | Integration đồng thời và test thu hồi token/scope trên DB thật |
| T06 | Loại phản hồi tải dữ liệu đến muộn, xóa dữ liệu cũ khi đăng nhập/đăng xuất tài khoản khác | E2E nhiều tab, refresh rotation và session hết hạn |
| T10 | Form thu hồi cho chọn mức khẩn cấp; không tự đánh dấu mọi yêu cầu thu hồi là khẩn; xác nhận mô tả đúng tác động | Kiểm thử trình duyệt, quy tắc lý do khẩn và đối soát sau thực thi |
| T13–T15 | Operation ID là request ID, header idempotency; mock trả cùng reference; đã có ledger `provider_operations` trước/sau call và giữ reference; request lỗi/treo chuyển Cần đối soát thay vì tự đưa lại hàng chờ | Provider lookup, lease/fencing đầy đủ, UI đối soát, test crash/DB và hợp đồng provider thật |
| T16 | Kiểm tra runtime metadata bắt buộc và thuật toán/kích thước key trong response HTTP trước khi worker lưu | Chọn provider thật, kiểm tra thời hạn chứng thư, sandbox test và xác nhận hợp đồng |
| T17–T18 | Năm danh sách có filter/scope/sort/page phía server; mẫu T18 đã duyệt và tích hợp danh mục Approver, timeline provider/quyết định, liên kết trước/sau và yêu cầu theo quyền. FE147/147/hai build. [T17](T17_SERVER_LISTS_2026-11-06.md), [T18](T18_ASSET_LINEAGE_2026-11-06.md) | Fixture lớn/query plan, DB lineage và bốn nhóm UI mới/visual QA còn chờ chạy |
| T21 | Nguồn ghi audit dùng correlation/redaction chung; pool riêng lưu lỗi/từ chối sau rollback; audit nháp/reset, logout/refresh cùng transaction. Backend344/344/build. [Bằng chứng](T21_AUDIT_CORRELATION_2026-11-06.md) | Runtime/DB mới, log proxy/startup/SMTP cũ, lưu fallback khi mất DB và nghiệm thu quyền tối thiểu |
| T22 | Audit API lọc actor/action/entity/outcome/requestId/correlationId/thời gian, phân trang ổn định; Admin UI tìm toàn dữ liệu; unit kiểm correlation | UI filter nâng cao/chi tiết, retention, query plan và integration DB thật |
| T23 | Worker chỉ tự thử lại khi SMTP từ chối tạm thời rõ ràng; kết quả không chắc chắn/chết worker đưa vào đối soát; dùng Message-ID ổn định, báo số cần kiểm tra trong Admin; có 3 unit test và hướng dẫn vận hành | Admin API/UI xử lý từng bản ghi có audit, integration nhiều worker/DB, nghiệm thu SMTP thật và khả năng deliverability |
| T26 | Hiển thị cùng một vùng thông báo cho User, Approver, Admin; nút chuông/điều hướng có đích; phân trang server, tổng chưa đọc trên toàn dữ liệu; mở yêu cầu/tài sản qua API kiểm tra quyền, đánh dấu đọc từng mục hoặc tất cả | Browser/E2E cho mọi role, lỗi mất quyền và thông báo tới đối tượng đã xóa |
| T28 | Admin có danh sách chỉ đọc cho email `FAILED`/`RECONCILIATION_REQUIRED`, phân trang và lọc trạng thái; không hiển thị lỗi SMTP thô | Luồng xử lý từng mục có audit và xác minh nhà cung cấp, monitoring/alert ngoài ứng dụng, E2E |
| T27 | Scan lấy mốc `warning_days` của policy, chống nhắc lặp theo mốc; xử lý lỗi kết nối DB để lần sau vẫn chạy | Test thời gian và nhiều worker trên DB thật; thống nhất người nhận ngoài owner |
| T29 | Bỏ tên/phòng ban demo trên hồ sơ và danh sách vai trò; lấy tên đơn vị từ phiên đăng nhập | Đối chiếu toàn bộ dashboard và biểu đồ với dữ liệu lớn, loại các chỉ số/nhãn giả còn lại |
| T41 | Sinh secret bằng nguồn ngẫu nhiên mật mã, kiểm tra Compose và chờ trang sẵn sàng theo APP_PORT | Chạy thử trên máy Windows có Docker, cả cổng tùy chỉnh và `.env` cũ |
| T42 | Thêm script backup PostgreSQL kèm SHA-256 và restore chỉ vào database mới; có hướng dẫn sử dụng | Diễn tập backup/restore trên Docker thật, chốt lịch, nơi lưu, RPO/RTO |

Kiểm tra tĩnh PowerShell: đạt. Docker daemon không khả dụng trong lượt này, vì vậy không có kết quả smoke/integration mới. Các task trong bảng đang **làm một phần**, chưa đánh dấu nghiệm thu. Mã nguồn vẫn ở working tree, chưa commit/push. UI đã thay các nhãn “đã kết nối/đang hoạt động” suy đoán từ cấu hình thành nhãn cấu hình trung thực; số xung đột vai trò được tính từ dữ liệu tải về.

Cập nhật 15/09/2026. Đây là đối chiếu với implementation_plan.md; không phải tuyên bố nghiệm thu production.

| Mục | Trạng thái | Bằng chứng / phần còn lại |
| --- | --- | --- |
| UC1–UC3 tạo, gia hạn, thu hồi | Có luồng cơ bản | Cần E2E riêng gia hạn/thu hồi và kiểm tra lỗi provider, retry an toàn |
| UC4 xem tài sản | Có API/UI theo scope | Bổ sung API và UI lịch sử hoạt động; cần integration test IDOR |
| UC5–UC6 hàng chờ, quyết định | Có API/UI | Cần hoàn thiện bộ lọc khẩn cấp, kiểm thử đồng thời đầy đủ |
| UC7 quản lý toàn hệ thống | Một phần | Admin hiện chỉ có bảng tài sản cần theo dõi; cần danh sách đầy đủ, phân trang/lọc |
| UC8 phiên bản policy | Bổ sung API/UI | Có version mới, audit, concurrency, giữ version cũ; chưa kiểm chứng UI trực tiếp |
| UC9 Audit Log | Có API/UI cơ bản | Cần lọc server, phân trang, đầy đủ sự kiện thất bại/từ chối |
| UC10 RBAC | Bổ sung UI và ràng buộc scope | Cần E2E thu hồi phiên, cập nhật trạng thái nguyên tử và kiểm tra quản trị cuối cùng |
| UC11–UC12 job hết hạn | Có worker | Cần kiểm thử thời gian và chống lặp với nhiều worker |
| Đổi mật khẩu bắt buộc | Đã sửa guard máy chủ | 4 test guard; smoke kiểm tra endpoint bị chặn và token cũ bị thu hồi |
| CI | Có workflow build/test | Chưa chạy trên GitHub cho thay đổi này |
| Backup/restore | Chưa có công cụ vận hành | Cần script backup và diễn tập restore trong database riêng |
| SMTP thật | Có worker và gửi thử | Cần cấu hình credential của chủ sở hữu và xác minh thư tới hộp thư |
| Provider thật | Có adapter HTTP | Cần hợp đồng idempotency, kiểm tra response và kiểm thử với KMS/CA thật |
| E2E 12 UC và security matrix | Chưa đủ | Unit tests không thay thế được các mục này |
| Tài liệu/video/rehearsal | Có tài liệu nền | Video và nghiệm thu nhóm chưa thực hiện |

## Lỗi và việc ưu tiên tiếp theo

- Worker đã nhận cả keySize/key_size và validityDays/validity_days; cần E2E xác minh tham số cấp phát và xử lý alias xung đột.
- Phân bổ thời hạn đã dùng dữ liệu thật; tiếp tục loại thông tin vai trò và xác nhận phê duyệt ghi cứng.
- Quy trình retry provider phải có idempotency trước khi cho chạy lại request lỗi.
- Bổ sung quản lý trạng thái user nguyên tử cùng audit, chống mất quản trị viên cuối.
- Hoàn thiện danh sách Admin, phân trang/filter API, notification cho mọi vai trò.
- Kiểm tra trực tiếp giao diện mới trên light/dark, bàn phím và mobile.

Lượt T28 tiếp06/11: thống kê chỉ EMAIL, gửi thử có audit intent/result và rate dùng chung DB, kiểm lại Admin sau khóa, phân biệt rejected/unknown/accepted đúng recipient. BE367/367/build đạt. Bốn SMTP protocol cần TCP loopback đang bị sandbox chặn; runtime LOGIN đã chuẩn bị48 nhóm nhưng chưa thực thi trên source mới. [T28](T28_EMAIL_TEST_OPERATIONS_2026-11-06.md).

Lượt tích hợp 06/11 trên PostgreSQL/API/Nginx mới đạt [runtime LOGIN 48/48](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/runtime-privileges-70488ce7aad4/results.json), [worker 27/27](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/worker-recovery-after-ba4426afa367/results.json), [expiry 19/19](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/expiry-scan-c4bd492b28b7/results.json), [email 11/11](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/email-delivery-after-d8e4688d51c2/results.json) và [ledger 10/10](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/runtime-ledger-a53267301ffd/results.json). [Edge](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/real-msedge-1793965266140/results.json) và [Chrome](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/real-chrome-1793965524000/results.json) mỗi trình duyệt đạt 32/32 nhóm sau sửa lịch sử mobile. [Chuyển đơn vị Edge](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/departments-msedge-1793966279791/results.json) đạt 19/19. Backend 383/383 và frontend 147/147, ba build đạt. Kiểm SMTP loopback riêng đạt 4/4. Provider và SMTP bên ngoài, release/UAT và các cổng còn mở theo kế hoạch.

Lượt T46 ngày 06/11: diễn tập nâng cấp thật từ Git 105d104 (001–003) lên 016 đạt 6/6. Khôi phục baseline qua API trong 17,3 giây, khớp 15 bảng và sequence audit. Migration 016 sửa liên kết chứng thư demo, giữ checksum 001–015. BE383/383, runtime48/48, ledger10/10 và Nginx smoke đạt. Hai image baseline có nhãn OCI và manifest đã xác minh. [Runbook T46](RELEASE_RUNBOOK.md).
