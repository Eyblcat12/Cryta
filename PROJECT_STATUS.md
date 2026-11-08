# Trạng thái triển khai Crypta

## Hiện trạng ngày 08/11/2026

Nhánh ứng viên đã có bản kiểm CI đầy đủ tại `fd4577145db8db35a38437b7f81501ad78549142`. Cả 5 job đạt. Artifact xác nhận backend 520/520, frontend 148/148, SMTP loopback 6/6, Chromium 65/65, quyền runtime 51/51, worker 37/37 và hết hạn 21/21. Audit dependency ghi 0 advisory cho ba package ở lượt này. CI đã dọn stack. SHA-256 của hai context build và mẫu cấu hình khớp khi tạo lại từ cùng commit. [Bằng chứng CI](docs/CI_REMOTE_2026-11-07.md)

Thay đổi Tổng quan tại `c14a89b` có bằng chứng local riêng. Backend 520/520 và hai nhóm Chromium T29 đạt. Truy vấn biểu đồ Admin nhanh hơn trên cùng volume. Hai lượt đo p95 ở mức 32 request đồng thời cho 139–216 ms. [CI Tổng quan](https://github.com/Eyblcat12/Cryta/actions/runs/42492791049) · [Báo cáo tải](T50_CAPACITY_2026-11-06.md)

54 task chính đã được đối chiếu ít nhất một phần và 6 mục mở rộng giữ trong phạm vi. Cả 12 UC có liên kết đến bằng chứng kỹ thuật theo commit. Quyết định R1 và nghiệm thu R2 còn chờ điều kiện đích, gồm UAT, hạ tầng HTTPS, hộp thư SMTP, provider/CA theo phạm vi, nơi sao lưu và người trực. [Tracker](TASK_STATUS_2026-11-05.md) · [Ma trận UC](docs/NGHIEM_THU_UAT.md#đối-chiếu-bằng-chứng-theo-commit) · [Cổng nghiệm thu](docs/CONG_NGHIEM_THU_RELEASE.md)

## Lịch sử kiểm thử theo từng lượt

T30 đã sửa callback tiêu đề lấy mất focus trước Enter. Bộ UI/API thật đạt 39/39. GitHub Actions trên `7a02147` đạt cả năm job, gồm 160/160 nhóm tích hợp và dọn stack. [Focus](T30_FOCUS_INTENT_2026-11-07.md) · [CI](docs/CI_REMOTE_2026-11-07.md)

X02 đã tích hợp hai cấp phê duyệt vào policy, hàng chờ, chi tiết và worker theo mẫu đã duyệt. GitHub Actions trên `dcfff1d` đạt 165/165 nhóm tích hợp, gồm X02, các ca T49 và 4 nhóm MFA. Cả hai stack đã được dọn. [Chi tiết X02](docs/X02_TWO_STAGE_APPROVAL.md) · [CI](https://github.com/Eyblcat12/Cryta/actions/runs/42347634913)

X03 đã tích hợp Keycloak, liên kết danh tính theo issuer/subject, MFA và thu hồi phiên. GitHub Actions đạt 172/172 nhóm tích hợp, gồm 6 nhóm Keycloak với Chromium và 50 nhóm quyền runtime. Môi trường đích cần cấu hình realm HTTPS, tài khoản khẩn cấp và chạy UAT. [Chi tiết X03](docs/X03_OIDC.md) · [CI](https://github.com/Eyblcat12/Cryta/actions/runs/42350581928)

X04 đã tích hợp xuất CSV/PDF vào Tài sản, Yêu cầu và Audit Log. GitHub Actions đạt 6/6 nhóm X04, gồm tạo tệp, số dòng, phạm vi, hết hạn và Chromium. [Chi tiết X04](docs/X04_REPORT_EXPORTS.md)

X05 đã có CLI ký và xác minh checkpoint audit. GitHub Actions đạt 5/5 nhóm X05, gồm sửa/xóa/chèn dòng, xoay khóa và phục hồi PostgreSQL. Cần kho và khóa ký độc lập cho môi trường đích. [Chi tiết X05](docs/X05_AUDIT_ANCHOR.md)

X06 đã có adapter OpenBao Transit cho khóa ký. Sandbox native và CI Ubuntu cùng đạt 4/4 nhóm, gồm gia hạn, tra cứu, thu hồi và mất kết nối. Lượt native chạy thêm client HTTP Crypta. [Chi tiết X06](docs/X06_OPENBAO_TRANSIT.md)

Commit `9766e5a` đạt 193/193 nhóm tích hợp, gồm nâng cấp đến migration 023 và phục hồi baseline. CI đã build hai image có manifest truy xuất nguồn. Cổng triển khai vẫn cần môi trường, provider/CA theo phạm vi, SMTP thật và xác nhận nghiệp vụ. [Bằng chứng CI](docs/CI_REMOTE_2026-11-07.md) · [Cổng nghiệm thu](docs/CONG_NGHIEM_THU_RELEASE.md)

X01 đã tích hợp TOTP 6 số và 10 mã khôi phục theo mẫu đã duyệt. GitHub Actions trên `b4d4dc7` đạt 4/4 nhóm MFA và 160/160 nhóm hồi quy. Backend 478/478, frontend 148/148. Còn xác nhận trên môi trường đích. [Chi tiết X01](docs/MFA_X01.md) · [CI](https://github.com/Eyblcat12/Cryta/actions/runs/42345358091)

T43 đã thu hồi UPDATE không còn dùng trên `policy_versions.id`. Migration 018 chặn đổi liên kết metadata khóa sang tài sản khác và giữ khóa dòng cho worker. Runtime/provisioning kiểm thêm ownership function. Local đạt 421 backend, 159 nhóm tích hợp, 6 ca nâng cấp/restore và 23 ca production TLS. Template được kiểm riêng khi trigger thiếu hoặc bị tắt. [Hồi quy](tools/test-artifacts/integration/crypta-t30-test-e6df8e509d52/ci-verification.json) · [Nâng cấp](tools/test-artifacts/integration/crypta-t30-test-580d3bc461ed/release-upgrade-95a3fa380c71/results.json) · [Production](tools/test-artifacts/production-24ab8c7d0e61/verification.json) · [Quy trình](DATABASE_MIGRATIONS.md)

Đã đẩy nhánh ứng viên và hợp nhất lịch sử origin/main. GitHub Actions trên commit `a599aae` đạt đủ năm job, gồm 419 backend, 147 frontend, 6 SMTP loopback và 158 nhóm tích hợp trên Ubuntu. Audit ba package đều 0 advisory. Nhánh thử lỗi đạt điều kiện kiểm thất bại có chủ đích và dọn stack. Cấu hình required checks bị GitHub từ chối HTTP 403 do gói của repo private. [Bằng chứng CI remote](docs/CI_REMOTE_2026-11-07.md)

T04 có CLI tạo Admin đầu tiên cho database mới, dùng credential operator riêng và tệp mật khẩu tạm. Diễn tập production cách ly đạt 22/22 ca, gồm hai tiến trình khởi tạo cạnh tranh, rollback khi audit lỗi, từ chối khởi tạo lại, kiểm schema cài mới giữ tài khoản/ledger và đổi mật khẩu trước khi quản trị. Backend đạt 419/419, build, lint và OpenAPI đạt. Hồi quy đầy đủ sau sửa schema/validator đạt 158/158 nhóm, gồm ca mới kiểm nạp lại schema giữ dữ liệu. Stack đã được dọn và danh tính chín container ngoài test khớp. [Diễn tập](tools/test-artifacts/production-a19c8d37f042/verification.json) · [Hồi quy](tools/test-artifacts/integration/crypta-t30-test-f1f20ec87e12/ci-verification.json) · [Khởi tạo Admin](RELEASE_RUNBOOK.md#khởi-tạo-admin-đầu-tiên)

T40/T43 có cấu hình Docker production riêng. Diễn tập cách ly đạt 11/11 ca, gồm ledger 17 migration, runtime LOGIN qua PostgreSQL xác minh TLS, SMTP xác thực bằng chứng thư thử, cookie Secure/HttpOnly và bốn ca từ chối startup. Lượt hồi quy sau thay đổi đạt 157/157 nhóm tích hợp, backend 405/405, frontend 147/147, build, lint và OpenAPI. Các stack thử đã được dọn và giữ danh tính chín container ngoài test. Còn xác nhận qua proxy HTTPS trên máy đích, provider/SMTP thật, UAT và CI trên commit ứng viên. [Bằng chứng production](tools/test-artifacts/production-ebc9217214b9/verification.json) · [Hồi quy](tools/test-artifacts/integration/crypta-t30-test-4dbbc85a8568/ci-verification.json) · [Runbook](RELEASE_RUNBOOK.md)

T40 đã có dừng có kiểm soát khi Docker gửi SIGTERM. API báo readiness 503 và chặn yêu cầu mới, giữ liveness 200 trong lúc chờ job đã nhận. Ca PostgreSQL thật ghi đúng một tài sản, một audit và hai thông báo trước khi API thoát mã 0. Yêu cầu tiếp theo vẫn ở hàng chờ và không còn kết nối API vào DB. Compose đặt 150 giây và xoay log 3 × 10 MB. Backend 385/385, SMTP loopback 6/6, build, lint và OpenAPI đạt. Lượt CI đầy đủ đạt 157/157 nhóm và dọn stack, giữ nguyên danh tính chín container ngoài test. [Diễn tập SIGTERM](tools/test-artifacts/integration/crypta-t30-test-69d743ad832a/shutdown-b349e2b8eda6/results.json) · [Kết quả CI](tools/test-artifacts/integration/crypta-t30-test-69d743ad832a/ci-verification.json)

T45 đã có ESLint trong workflow và kiểm cài sạch bằng Node 22 Linux. Lint đạt với 0 warning và chặn mẫu lỗi cố ý. Audit backend, frontend và công cụ CI đều ghi 0 advisory. Lượt Windows sau chỉnh lint đạt 156/156 nhóm, bổ sung kiểm hết hạn và giao thư qua SMTP loopback, rồi dọn stack và giữ chín container ngoài test. CI remote trên commit ứng viên còn mở. [CI](tools/ci/README.md)

T41 bổ sung kiểm cổng, chẩn đoán, readiness API/DB và dừng giữ volume. Lượt đầu phát hiện Windows PowerShell 5.1 timeout qua `localhost` khi dịch vụ chỉ bind IPv4. Launcher chuyển probe sang địa chỉ loopback và giữ URL trình duyệt. Bản sửa khởi động ở cổng 18150 từ thư mục có dấu và khoảng trắng, chạy lại CMD giữ nguyên `.env` và xác nhận bản ghi PostgreSQL sau dừng/khởi động lại. Compose bỏ Redis không dùng. [Kiểm launcher](tools/test-artifacts/launcher-4a83e646de55/verification.json)

Lượt Windows ngày 07/11 đạt 126/126 nhóm tích hợp, gồm 38 Chromium, 48 quyền runtime, 27 worker, 10 ledger và 3 parser. Stack được dọn và chín container ngoài test giữ nguyên danh tính. Backend 383/383, frontend 147/147 và SMTP loopback 6/6. Đã đối chiếu các cổng T51/T54. Còn GitHub Actions, SMTP thật, môi trường pilot và UAT. [Kết quả CI local](tools/test-artifacts/integration/crypta-t30-test-445e594eb7df/ci-verification.json) · [Cổng nghiệm thu](docs/CONG_NGHIEM_THU_RELEASE.md)

T52 đã có video khoảng 48 giây với 12 chương từ stack dữ liệu mẫu, hướng dẫn dựng lại và bảng trách nhiệm bàn giao. Kiến trúc, luồng trạng thái và ERD đã cập nhật theo schema 017 với 19 bảng, 164 cột và 33 khóa ngoại. Cả 20 sơ đồ Mermaid render đạt. Demo dùng provider MOCK và SMTP tắt, người tiếp nhận còn cần làm lại và xác nhận các kịch bản. [Demo và bàn giao](docs/DEMO_VA_BAN_GIAO.md)

T46 đã diễn tập 6/6 nhóm nâng cấp từ commit 105d104 có ledger 001–003 lên 017, gồm rollback khi DDL lỗi và khôi phục API cũ từ DB riêng trong 17,7 giây. Backend 383/383, runtime LOGIN 48/48 và ledger 10/10 đạt trên image 017. T50 có 11/11 nhóm API đạt mốc thử ở tải 16 yêu cầu đồng thời trong hai lượt. Còn commit/tag release, CI remote, UAT và môi trường đích. [Hướng dẫn T46](RELEASE_RUNBOOK.md) · [Đo tải T50](T50_CAPACITY_2026-11-06.md)

Lượt tích hợp 06/11 trên PostgreSQL/API/Nginx mới đạt [runtime LOGIN 48/48](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/runtime-privileges-70488ce7aad4/results.json), [worker 27/27](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/worker-recovery-after-ba4426afa367/results.json), [expiry 19/19](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/expiry-scan-c4bd492b28b7/results.json), [email 11/11](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/email-delivery-after-d8e4688d51c2/results.json) và [ledger 10/10](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/runtime-ledger-a53267301ffd/results.json). [Edge](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/real-msedge-1793965266140/results.json) và [Chrome](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/real-chrome-1793965524000/results.json) mỗi trình duyệt đạt 32/32 nhóm sau sửa lịch sử mobile. [Chuyển đơn vị Edge](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/departments-msedge-1793966279791/results.json) đạt 19/19. Backend 383/383 và frontend 147/147, ba build đạt. Kiểm SMTP loopback riêng đạt 4/4. [Backup/restore](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/backup-restore-0ffc420d1c2a/results.json) đạt 11/11 trong khoảng 63 giây với 19 bảng khớp và sequence khớp. [Dọn stack](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/cleanup-report.json) xác nhận 0 container, volume và network test, giữ danh tính chín container ngoài test. [Chỉ mục kiểm chứng](tools/test-artifacts/expiry-hardening-20261106/integration-index.json) đối chiếu 23 tệp backend đã biên dịch với image chạy kiểm. Provider và SMTP bên ngoài, release/UAT và các cổng còn mở theo kế hoạch.

T27 đã triển khai người nhận được duyệt (owner, Approver trong scope, Admin), dedup theo người/kênh và tương thích key cũ; kiểm quyền trước SMTP và che metadata thông báo ngoài quyền. Job chuẩn hóa policy legacy, khóa asset khi chọn cảnh báo và phục hồi cả lỗi rollback. Expiry 19/19, email 11/11 và runtime 48/48 đạt. [T27](T27_HARDENING_2026-11-06.md).

T28 đã sửa thống kê email chỉ đếm EMAIL; gửi thư thử có giới hạn chung DB, kiểm lại Admin và audit intent/kết quả, không tự gửi lại khi SMTP chưa rõ. Backend367/367/build đạt. SMTP loopback riêng đạt 4/4 sau khi được cấp quyền TCP. Sáu ca gửi thử đạt trong runtime LOGIN. [Bằng chứng T28](T28_EMAIL_TEST_OPERATIONS_2026-11-06.md).

T21 đã bổ sung correlation cho nguồn ghi audit, pool độc lập ghi lỗi/từ chối sau rollback, audit nháp/reset và redaction chuỗi nhạy cảm. Sửa refresh sai secret gây thu hồi phiên và logout chưa nguyên tử với audit. Các ca audit đã đạt trên runtime LOGIN. [Bằng chứng T21](T21_AUDIT_CORRELATION_2026-11-06.md).

T18 đã tích hợp danh mục Approver và liên kết truy vết theo mẫu vừa được duyệt, ngoài lịch sử provider/quyết định và phiên bản policy đã bổ sung. Frontend 147/147, hai build đạt; backend hiện 344/344 trong lượt T21. Đã kiểm UI thật và đối chiếu mẫu ở desktop/mobile. [Bằng chứng T18](T18_ASSET_LINEAGE_2026-11-06.md).

T17 bổ sung sắp xếp cho năm danh sách, sửa bộ lọc audit không có page và thêm tìm kiếm thông báo. Backend 304/304. Fixture lớn và 10 query plan đã kiểm trên DB. [Bằng chứng T17](T17_SERVER_LISTS_2026-11-06.md).

T15 đã tích hợp giao diện theo mẫu được duyệt, frontend 144/144 và hai build đạt. Hai ca T15 qua Nginx đã đạt trên Edge và Chrome. [Bằng chứng T15](T15_PROVIDER_RECOVERY_2026-11-06.md).

T16 đã thêm kiểm cấu hình, metadata HTTP, thời hạn từ PEM và phạm vi provider trên tài sản. PostgreSQL trước 015 đạt worker 27/27, API runtime LOGIN 39/39. Migration 015 đã áp dụng và sửa liên kết ba khóa mẫu trong kiểm DB. Chọn provider và nghiệm thu sandbox vẫn còn mở. [Bằng chứng T16](T16_HTTP_ADAPTER_2026-11-06.md).

T20 đã tích hợp mẫu được duyệt vào trang Chính sách. Hai ca desktop/mobile đã đi qua tạo, xung đột phiên bản, so sánh lịch sử và ngừng áp dụng trên stack PostgreSQL. API và worker đã kiểm bất biến phiên bản. [Bằng chứng T20](T20_POLICY_LIFECYCLE_2026-11-06.md)

T07 đã nối luồng mời tài khoản và tự đặt lại mật khẩu qua email. Backend 265/265, frontend 136/136, runtime LOGIN 30/30, Edge/Chrome 6/6 luồng qua SMTP loopback. SMTP triển khai và nghiệm thu hộp thư còn mở. [Bằng chứng T07](T07_ACCOUNT_ACTIONS_2026-11-06.md).

T08 đã tích hợp quản lý đơn vị và chuyển tài khoản theo mẫu đã duyệt. Edge đạt 19/19, Chrome 12/12 UI, runtime LOGIN 24/24 và hồi quy Edge 26/26. [Bằng chứng T08](T08_DEPARTMENT_ADMINISTRATION_2026-11-06.md).

Lượt T24 tiếp ngày06/11 thêm tám mẫu thư nghiệp vụ có link/múi giờ và hai mẫu tài khoản chờ T07; worker enqueue kết quả cùng transaction qua migration010. Backend233/233, FE133/133/hai build, SMTP loopback10/10, preview20/20, link thật3/3, worker23/23, runtime LOGIN23/23, ledger10/10 và Edge26/26. [Bằng chứng T24](T24_EMAIL_TEMPLATES_2026-11-06.md).

Lượt T05 tiếp ngày 06/11 sửa request quản trị đã qua guard nhưng chờ khóa: sau khi người gửi bị thu hồi quyền hoặc khóa, transaction đọc lại actor và từ chối trước khi ghi. Đối chứng 2/8 → 8/8 nhóm API/DB; backend202/202/build, runtime LOGIN23/23, Edge integration26/26. [Bằng chứng T05](T05_USER_ADMINISTRATION_2026-11-06.md).

Lượt T09 ngày 06/11 đã nối UI lưu, sửa, gửi nháp và xác nhận hủy. Edge/Chrome có 24/24 nhóm mới, gồm mất phản hồi sau commit, hai tab cạnh tranh và giữ tham số/cờ khẩn khi sửa nháp. Frontend 133/133, hai build đạt. [Bằng chứng T09](T09_REQUEST_DRAFTS_2026-11-06.md).

Pha tương phản trước đó06/11: [sửa viền focus và nhãn radio](T30_FOCUS_CONTRAST_2026-11-06.md),600/600 kiểm màu/cận gradient trên ba browser ON/OFF đạt, thấp nhất4,64449:1; native radio keyboard12/12/hai build đạt. Snapshot206 file và bằng chứng giữ phạm vi pha đó. T30/screen reader/N6 vẫn mở.

Cập nhật focus06/11: [sửa Tab thoát dialog đang gửi](T30_DIALOG_FOCUS_2026-11-06.md), before0/16 →96/96 nhóm trên Edge/Chrome/Firefox, ON/OFF, desktop/mobile và hai theme. **FE131/131,180/180 hồi quy mỗi browser, visual4/4 và hai build đạt**; JS đổi sangBWV_OzFu/DFRUkWzt, CSS giữ nguyên. Snapshot205 file/build/report/cleanup khớp;11 preview process/port/esbuild còn0. Chỉ WorkspaceUi.tsx đổi trong source ứng dụng; các ghi chú product byte-identical bên dưới thuộc pha trước sửa focus. DB/provider/SMTP không chạy lại; screen reader/N6 và toàn dự án chưa nghiệm thu.

Cập nhật tiếp06/11: [NAV20 network baseline12/12 mẫu](T30_USERS_NETWORK_2026-11-06.md) trên Edge/Chrome xác nhận cold Users7→3 GET và503+retry14→4, không đọc bảng ngoài nhu cầu Users; đây là fixture comparison với source Git trước routing, không latency/deployment proof. [Skeleton gộp hàng](T30_SKELETON_BANDS_2026-11-06.md)40/40 geometry nhưng24 mẫu benefit đổi dấu, không tích hợp. Product source/build giữ nguyên; N6 và T30 vẫn mở.

## Lượt 06/11/2026 — T30 với GET thật bị trễ

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

## Lịch sử 04/10/2026 — T30 tiếp tục

Đã sửa session nhiều tab dùng Web Locks/revision, picker chờ detail đúng quyền và scroll ngoài React commit. FE **131/131**, fixture **179/179 mỗi Edge/Chrome**, picker **5/5 mỗi cấu hình** và hai build đạt, bundle `BKxJgvfI/fQCdLjVQ/CTxLXPoY`. Logout mới có unit **95/95**/build và DB/API/Nginx thật **21/21 mỗi browser** trên image `dab40360…`; phase hết hạn server TTL12s **2/2 mỗi browser** thuộc backend trước logout hardening. Docker phục hồi không reset database; stack test đã dọn và container ID vận hành giữ nguyên.

N6 vẫn mở: quiet after ON/OFF desktop web long task16/2, mobile28/20, root có layout/paint dài cả OFF; không nghiệm thu hoặc suy causal từ riêng commit/setup/counts. N4 detail/empty/short/multiline, zoom Edge/screen reader và đủ NAV còn thiếu. [Bằng chứng mới](T30_PROGRESS_2026-10-04_SESSION_PICKER_PERF.md), [thống kê](TASK_STATUS_2026-10-04.md). Phạm vi giữ **54 task chính +6 mở rộng**, **35 một phần/19 chưa đối chiếu riêng/6 mở rộng chưa nghiệm thu/0 toàn tiêu chí R1**; Goal active, T30 ưu tiên đầu.

## Lịch sử 01/10/2026 — N4 danh sách/zoom thật/N6

Requests/Notifications/lịch sử tài sản đã có loading và snapshot/retry/khóa action cùng query; 403/đổi query bỏ dữ liệu cũ. Zoom Chrome thật 200% phát hiện/sửa focus textarea bị panel cắt, **6/6 nhóm role/theme** đạt với menu/skip và bốn loại dialog. Bundle cuối `By2DuIlI/CTxLXPoY` đạt **174/174 fixture và 18/18 nhóm tích hợp thật mỗi Edge/Chrome**, FE **123/123**/hai build; hai Approver khác nhau chỉ ghi một decision/audit. Nginx 17/17, API smoke 13 lúc tạo DB riêng; stack test đã dọn, operational container ID giữ nguyên. Backend không đổi so với snapshot có 89/89/build; không gọi số đó là chạy lại.

Motion setup đã chuyển sang frame trước paint; N6 đo/phân tích ba vòng cuối với snapshot/polling locator tắt: 72/72 setup root dưới 33.1 ms, shift on/off bằng nhau, web long task desktop 7/7 và mobile 17/13. Còn layout/paint Users dài ở cả hai mode, N4 states/detail, zoom Edge/screen reader và đủ NAV/M; chưa nghiệm thu N6/T30. [Bằng chứng/giới hạn](T30_PROGRESS_2026-10-01_N4_ZOOM_N6.md), [thống kê](TASK_STATUS_2026-10-01.md): **35 task cập nhật một phần, 19 chưa đối chiếu riêng, 6 mở rộng chưa nghiệm thu riêng, 0 xác nhận toàn tiêu chí R1**. Goal vẫn active, T30 ưu tiên đầu.

## Lịch sử trước 01/10/2026 — M thật/N4

- Docker hoạt động; stack PostgreSQL/API/Nginx mới cách ly đạt smoke Nginx **17/17**, API **13 kiểm tra**, **18/18 nhóm tích hợp thật mỗi Edge/Chrome**. JWT/cookie/F5, scope/SoD, version, rollback và concurrency có report riêng.
- Sửa hai deadlock DB: advisory lock trước khóa dòng user ở status/access; auth khóa user trước session và recheck trước tạo/rotation. Có đối chứng refresh/access với delay DB, 200/409 Admin cuối và decision/audit đúng một lần.
- N4 mở rộng Assets/Queue/Audit/Email: skeleton/cột/card ổn định, GET refresh giữ cùng-key snapshot nhưng khóa action, 503 giữ/403 bỏ. **150/150 fixture mỗi browser**, frontend **123/123**, backend **89/89**, các build đạt. Bundle `DSwgZCwf/C6u-C_Yc`; off `ClRmUXps`.
- Artifact cũ đã diễn tập trên Nginx test với API mới: smoke/login/F5 đạt, backend/DB giữ nguyên. Stack test/network/volume đã dọn; container ID project vận hành `crypta` giữ nguyên.
- [Bằng chứng mới](T30_PROGRESS_2026-10-01_M_N4.md), [thống kê](TASK_STATUS_2026-10-01.md): **35 task chính cập nhật một phần, 19 chưa đối chiếu riêng, 6 mở rộng chưa nghiệm thu riêng, 0 xác nhận toàn tiêu chí R1**. Goal vẫn active, T30 ưu tiên đầu. Còn N4 resource/trạng thái thiếu, L/N5 zoom thực/screen reader, N6 trace mới và đủ NAV/M; không đóng task từ số test.

## Lịch sử trước 01/10/2026 — review L/N1, T30 còn mở

Đã sửa ba lỗi focus/resize/footer và chữ dài trong Users; review 24 tổ hợp role, light/dark và viewport 1440/1024/768/390. Motion token/contract N1 đã thống nhất; còn zoom thực, screen reader, các page/trạng thái chưa phủ và phân tích N6.

Frontend **123/123** unit test, production/motion-off build đạt; Edge **134/134**, Chrome **134/134** browser fixture trên bundle `index-BKb9ILUH.js` / `index-CyQ-uI6G.css`. Backend gần nhất **89/89** của NAV-21; không có thay đổi backend trong lát cắt L/N1. Runner stack DB cách ly qua parser/prepare/config, nhưng daemon preflight thất bại trước khi tạo stack; Docker Desktop đang lỗi socket `dockerInference`. M/JWT/cookie/PostgreSQL/concurrency/Nginx chưa có kết quả mới.

Goal đang active, phạm vi vẫn **54 task chính + 6 mở rộng**; **30 task cập nhật một phần, 24 chưa đối chiếu riêng, 0 xác nhận nghiệm thu toàn tiêu chí**. [Thống kê](TASK_STATUS_2026-10-01.md), [bằng chứng mới](T30_PROGRESS_2026-10-01_L_N1.md). Giữ T30 ưu tiên đầu theo plan rồi tiếp các phụ thuộc; kết quả bên dưới là lịch sử.

## Lượt trước 01/10/2026 — NAV-21/N4, T30 chưa nghiệm thu

NAV-21 đã có khóa mutation cùng key, theo dõi pending/unknown qua rời/reopen form và GET kiểm tra có cảnh báo kết quả cũ chưa xác nhận. N4 bổ sung outline dashboard/policy và skeleton Users, giữ snapshot cùng query nhưng khóa thao tác khi cập nhật/lỗi; khác query/mất quyền bỏ dữ liệu cũ. Keyboard/mobile/skip-link/reduced-motion giữa phiên/fallback và chuyển nhanh có bằng chứng local.

Frontend **123/123 unit test**, production/motion-off build đạt. **106/106 browser ca trên Edge và 106/106 trên Chrome**, cùng build `index-3gwoFFVU.js`/`index-CCUgmGPJ.css`. Backend gần nhất **89/89** và build đạt ở lượt NAV-21 trước khi dừng; N4 không sửa backend. Trace loading giảm dịch chuyển ở hai viewport, nhưng long task còn và N6 chưa được nghiệm thu. Docker chưa kết nối nên JWT/cookie/PostgreSQL/concurrency/Nginx mã mới còn chờ kiểm thử.

Phạm vi vẫn đủ 54 task chính và 6 mở rộng: **29 task có cập nhật một phần, 25 chưa đối chiếu riêng, 0 được xác nhận nghiệm thu toàn tiêu chí qua báo cáo này**. Xem [thống kê toàn bộ](TASK_STATUS_2026-10-01.md) và [bằng chứng T30](T30_PROGRESS_2026-10-01.md). Ưu tiên tiếp tục L/N còn thiếu → M theo plan; không đóng T30 hay toàn dự án từ một lát cắt xanh. Các kết quả có ngày cũ bên dưới được giữ làm lịch sử.

## Lượt 30/09/2026 — T30 đang triển khai

Đã tách shell/Outlet/pages, resource ownership và session boundary. Lượt I/J/K mới hoàn thiện query/pageSize/history, search theo trang và card filter; thông báo giữ lỗi mất quyền/đối tượng, cập nhật unread toàn scope. Bốn form có dirty/beforeunload và bảo vệ đổi target/policy/Back; sửa query scroll chờ hàng tải và đóng dialog sau điều hướng. Các guards personal/SoD của lượt E/H được giữ. Kết quả mới: **104/104 frontend, 86/86 backend unit test**, cả hai production build đạt, **78/78 browser regression bằng HTTP fixture cách ly**. T30 chưa nghiệm thu; ưu tiên tiếp K/NAV-21 mutation mất mạng/kết quả chưa rõ, rồi L/N browser/trace và M JWT/cookie/object scope/SoD/concurrency/deployment/DB theo [bằng chứng T30](T30_PROGRESS_2026-09-30.md). Hợp đồng summary/lifecycle/personal filters mới cần triển khai cả backend và frontend; chưa có Nginx/DB smoke mới.

Các mục phía dưới giữ số liệu và môi trường của lượt trước. Docker daemon không kết nối được trong lượt mới; kết quả Nginx cũ không đại diện cho build vừa sửa.

## Tiến độ 30/09/2026

T30 tiếp tục là ưu tiên số 1. Đã thêm fade 160 ms cho chuyển main content, pending trễ 180 ms, reduced-motion/fallback; sửa route lạ 404, focus và chặn modal tạo yêu cầu cho role trái quyền. Bộ lọc/phân trang Admin Assets, Audit, Email, User Requests và Approver Queue đã chuyển sang URL. API tải chung/detail dùng AbortSignal để không trả dữ liệu cũ sau đổi route. Frontend 37/37 test và production build đạt; backend 65/65 test và build đạt. Docker Desktop đã chạy lại; frontend được build/recreate riêng, smoke direct-route/Nginx/API đạt và browser đã xác minh trang ba role ở mức đọc. Chưa có E2E mutation, SMTP/provider thật hay nghiệm thu T30 và toàn dự án; chi tiết ở [tracker](IMPLEMENTATION_TRACKER.md).

## Cập nhật kế hoạch ngày 28/09/2026

Lịch sử ngày 28/09: T30-N1…N6 mô tả motion SPA, pending UI, reduced-motion/fallback, focus/scroll và NAV-23…30; motion được triển khai sau mốc này. Review nhánh `ngoc` tại `7303064`: không merge toàn bộ do credential trong test, auth bị nới và lỗi nghiệp vụ; chỉ đưa pool idle-error fix + log an toàn + 4 test lên GitHub main `105d104`. Backend kiểm tra lại đạt 65/65 test ở workspace, 22/22 trên nền main chọn lọc; build đạt. Không chạy script E2E của ngoc. Xem [NGOC_BRANCH_REVIEW.md](NGOC_BRANCH_REVIEW.md) để biết phần bị giữ lại và yêu cầu rotate credential.

Theo yêu cầu chủ dự án, **T30 — chuyển dashboard từ cuộn section sang điều hướng theo trang — là task cần thực hiện đầu tiên**. Lát cắt đầu tiên đã được triển khai: React Router 7.18.2, menu NavLink, URL/page/title/focus, deep link, Back/Forward, 403/404, password gate, tải resource theo page và các trang chính của ba role. Frontend có 23 route/permission/query test đạt, production build đạt và npm audit 0. Browser Admin đã kiểm tra desktop dark/light, mobile 390 px, refresh trực tiếp, route trái quyền, bảo vệ form chưa lưu và query Users tái lập qua F5; bản Docker/Nginx 8080 đã được cập nhật và direct-route smoke đạt. T30 vẫn **đang làm**, chưa nghiệm thu vì còn URL filter/page cho các bảng khác, E2E ba role, tách layout/pages hoàn chỉnh, AbortSignal và browser test blocker của request/access. Chi tiết bằng chứng/còn lại ở [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md). Thay đổi backend dở ở `request-policy.ts` trước yêu cầu dừng đã được Compose build ngoài dự kiến và bộ backend 61/61 test hiện đạt; vẫn không coi T19 đã nghiệm thu vì chưa có integration nghiệp vụ tương ứng.

Cập nhật nền: 15/09/2026; các mục sau ghi lịch sử theo ngày.

## Kiểm tra và phát triển tiếp ngày 27/09/2026

Đã bắt đầu thực hiện backlog trong [KE_HOACH_HOAN_THIEN_DU_AN.md](KE_HOACH_HOAN_THIEN_DU_AN.md). Các thay đổi về transaction tài khoản, chuẩn hóa tham số, migration, job cảnh báo, sổ đối soát provider/email, backup/restore, thông báo UI, phân trang assets/requests/users/notifications/audit, timeline tài sản và che metadata audit được ghi chi tiết trong `IMPLEMENTATION_TRACKER.md`. Backend có **61/61 unit test đạt**; build backend/frontend và kiểm tra cú pháp PowerShell đạt. Docker daemon không khả dụng, nên chưa chạy lại smoke/integration hoặc nghiệm thu production. Các kết quả bên dưới là lịch sử đến 15/09, không thay thế kiểm thử mới.

Đối chiếu đầy đủ với kế hoạch: xem [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md). Bản này chưa đáp ứng toàn bộ tiêu chí nghiệm thu production.

## Bổ sung ngày 15/09/2026

- API và UI Admin phát hành phiên bản policy, có audit và kiểm tra xung đột version.
- API chỉ chấp nhận policy hiện hành cho cấp mới; tài sản cũ giữ version đã cấp.
- UI thay đổi vai trò/phạm vi; backend kiểm tra phòng ban hoạt động và cấm tự gỡ quyền Admin.
- API và UI lịch sử tài sản theo quyền owner/scope/Admin.
- Chặn API nghiệp vụ khi tài khoản chưa đổi mật khẩu tạm; token cũ bị thu hồi sau đổi mật khẩu.
- Biểu đồ phân bổ thời hạn dùng dữ liệu thật.
- Workflow GitHub Actions build frontend/backend và chạy unit tests (chưa push/chạy CI).
- Build frontend/backend đạt; 26 unit tests đạt; smoke Docker 13 kiểm tra đạt, dùng Approver tài chính vì tài khoản IT hiện INACTIVE.
- API lịch sử tài sản và từ chối phát hành policy với version cũ đã kiểm tra trên Docker.
- Các kiểm tra cũ bên dưới là kết quả lịch sử, không thay thế E2E đầy đủ.

## Đã hoàn thành (MVP vận hành nội bộ)

- UI prototype cho User, Approver và Security Admin; light/dark theme, responsive và dashboard charts.
- PostgreSQL bootstrap schema và dữ liệu seed demo.
- Backend NestJS foundation tại `backend/`.
- `POST /api/v1/auth/login`, `GET /api/v1/auth/me`.
- `GET/POST /api/v1/requests` và `POST /api/v1/requests/:id/decision`.
- JWT access token có kiểm tra `token_version`.
- Scope theo phòng ban, chặn Admin duyệt, chặn self-approval và quyết định lặp.
- Transaction gộp thay đổi request với Audit Log.
- Response envelope/error model có `requestId`; database rows được đổi sang camelCase.
- Swagger, Docker Compose local và hướng dẫn chạy.
- 18 unit tests cho policy, API presenter và crypto provider adapter.
- Frontend đăng nhập và đọc/ghi dữ liệu qua API thật; có khôi phục phiên, loading, error và retry.
- Refresh-token rotation bằng cookie HttpOnly; token chỉ lưu hash trong PostgreSQL; logout thu hồi session.
- Assets API, Policies API, request detail/cancel và Admin Audit API.
- Hàng đợi email PostgreSQL, SMTP thật, kiểm tra kết nối và retry tối đa 5 lần.
- Docker image cho frontend/backend và tệp `start-crypta.cmd` chạy toàn hệ thống một lần.
- Dark theme đổi sang bảng màu xanh lam–indigo, bỏ màu cam khỏi accent chính.
- Dashboard theo vai trò dùng số liệu, xu hướng và cơ cấu trực tiếp từ PostgreSQL; không còn số mẫu ở biểu đồ.
- Notification trong ứng dụng, đánh dấu đã đọc và email theo cùng một sự kiện nghiệp vụ.
- Job xử lý sau phê duyệt với trạng thái `PROCESSING`, `COMPLETED`, `FAILED`; tự phục hồi job treo sau khi khởi động lại.
- Adapter provider hỗ trợ `MOCK` cho local và `HTTP` qua HTTPS/token cho KMS, HSM hoặc CA thật.
- Quét hết hạn định kỳ, chống chạy trùng bằng PostgreSQL advisory lock.
- Chống brute-force cơ bản: khóa tài khoản 15 phút sau 5 lần đăng nhập sai.
- API và UI Admin xem người dùng, Audit Log, trạng thái dịch vụ và vô hiệu hóa/kích hoạt tài khoản; vô hiệu hóa sẽ thu hồi phiên.
- Tệp khởi động một lần đã kiểm tra bằng Windows PowerShell 5 và Docker Compose.
- Security Admin tạo tài khoản từ UI, sinh mật khẩu tạm mạnh và gán phạm vi phòng ban cho Approver.
- Tài khoản mới bắt buộc đổi mật khẩu ở lần đăng nhập đầu; sau khi đổi, toàn bộ phiên cũ bị thu hồi.
- Hàng đợi Approver hiển thị người gửi, phòng ban, tài sản và phiên bản request từ database; quyết định dùng optimistic concurrency.
- Policy được kiểm tra ở cả UI lẫn backend: loại tài sản, thuật toán, độ dài khóa và thời hạn.
- Tìm kiếm thật cho hàng đợi Approver/Audit Log; Help dialog mô tả quy trình theo vai trò.
- Security Admin có nút gửi email thử trực tiếp từ trang trạng thái dịch vụ khi SMTP đã bật.
- Chi tiết vòng đời tài sản không còn ngày, provider hoặc actor ghi cứng; chỉ hiển thị metadata thật.
- `tools/smoke-test.ps1` kiểm thử tích hợp các luồng quan trọng và tự dọn tài khoản tạm.

## Kết quả kiểm tra gần nhất

- Backend build: pass.
- Backend test: 18/18 pass.
- Frontend build: pass.
- Docker Compose config: pass.
- One-click startup `start-crypta.ps1 -NoBrowser`: pass.
- Swagger không cần database: HTTP 200.
- Protected endpoint không token: HTTP 401.
- Invalid login payload: HTTP 400 với error envelope chuẩn.
- Health khi PostgreSQL chưa chạy: HTTP 503 với `DATABASE_UNAVAILABLE`.

## Kiểm thử tích hợp đã chạy

- Docker Compose: PostgreSQL, Redis, backend và frontend đều healthy/running.
- Login qua Nginx, cookie HttpOnly, refresh rotation: pass.
- Assets API trả 4 tài sản; Requests API trả dữ liệu theo owner: pass.
- Tạo yêu cầu, scope approver, quyết định APPROVED, Audit Log và enqueue email: pass.
- Tạo yêu cầu mới, duyệt, job cấp tài sản, request chuyển `COMPLETED`, tài sản xuất hiện và tạo thông báo in-app: pass.
- Dashboard User/Approver/Admin, Users API và Audit API qua Nginx: pass.
- Rà giao diện trực tiếp ở dark/light và khung nhìn hẹp: pass.
- Smoke test tạo tài khoản, đổi mật khẩu bắt buộc, thu hồi phiên, queue Approver và policy boundary: pass.
- SMTP thật chưa thể gửi trong máy phát triển vì chưa có credential của chủ sở hữu; mã nguồn và endpoint kiểm tra đã sẵn sàng.

## Trước khi phát hành production cho một tổ chức cụ thể

1. Nhập SMTP credential thật và gửi email test tới địa chỉ quản trị.
2. Cấu hình adapter KMS/HSM/CA của tổ chức bằng HTTPS/token; adapter HTTP đã sẵn sàng nhưng hiện local đang dùng `MOCK`.
3. Loại bỏ dữ liệu seed, cấu hình domain HTTPS, secret manager, backup và monitoring.
4. Bổ sung E2E CI trên hạ tầng triển khai và kiểm thử tải theo quy mô người dùng thực.
