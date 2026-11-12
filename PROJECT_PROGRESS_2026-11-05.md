# Crypta — tiến độ tiếp tục ngày 05/11/2026

T07 đã nối luồng mời tài khoản và tự đặt lại mật khẩu qua email. Backend 265/265, frontend 136/136, runtime LOGIN 30/30, Edge/Chrome 6/6 luồng qua SMTP loopback. SMTP triển khai và nghiệm thu hộp thư còn mở. [Bằng chứng T07](T07_ACCOUNT_ACTIONS_2026-11-06.md).

T08 đã tích hợp quản lý đơn vị và chuyển tài khoản theo mẫu đã duyệt. Edge đạt 19/19, Chrome 12/12 UI, runtime LOGIN 24/24 và hồi quy Edge 26/26. [Bằng chứng T08](T08_DEPARTMENT_ADMINISTRATION_2026-11-06.md).

Mục tiêu giữ đủ **T01–T54 và X01–X06**, T30 ưu tiên đầu theo [kế hoạch](KE_HOACH_HOAN_THIEN_DU_AN.md). Đây là bằng chứng từng pha, chưa phải nghiệm thu toàn dự án. Các số ngày 06/10 thuộc source/image lịch sử.

T44 ngày 06/11 tách liveness và readiness. Khi PostgreSQL dừng, liveness 200 và readiness 503 trong khoảng một giây. Sau phục hồi, đăng nhập 200 trên cùng tiến trình API. 9/9 probe HTTP và 186/186 test backend đạt. Metrics và cảnh báo còn mở. [Bằng chứng T44](T44_HEALTH_READINESS_2026-11-06.md).

Lượt T21/T44 tiếp theo thêm log JSON cho lỗi HTTP và worker. Hai lỗi 503 khớp request ID trong header, body và log. SMTP loopback 5/5 giữ đúng nhánh gửi lại, thất bại và đối soát khi lọc thông báo. Backend 187/187, worker 23/23, expiry 13/13 và cleanup đạt. [Kết quả lượt log và SMTP](T44_HEALTH_READINESS_2026-11-06.md#lượt-tiếp-theo--log-json-và-lọc-lỗi-httpsmtp).

T44 có metrics Admin cho tuổi hàng đợi, kết quả worker, DB pool và HTTP. Ba truy vấn đồng thời khi bảng thông báo bị khóa cùng trả 503 sau khoảng 2 giây, readiness 200, metrics phục hồi sau nhả khóa. Backend 187/187, outage 9/9 và runtime LOGIN 19/19 đạt trên image này. [Kết quả metrics](T44_HEALTH_READINESS_2026-11-06.md#lượt-metrics-và-tín-hiệu-vận-hành).

Monitor độc lập dùng token chỉ đọc mã tín hiệu, phát JSON qua stdout. Diễn tập qua Nginx có sáu sự kiện mở/đóng cho DB dừng thật và provider/email mô phỏng, giữ cảnh báo đang mở khi DB mất kết nối. CLI 3/3 và backend 187/187 đạt. Còn nối kênh đến người trực trên môi trường đã chọn. [Bộ theo dõi và kết quả](T44_HEALTH_READINESS_2026-11-06.md#lượt-bộ-theo-dõi-độc-lập).

## Pha 1 — guard thực thi worker đã kiểm chứng

Worker kiểm request PROCESSING/version/input, policy active/effective và owner/state/policy/reference của tài sản trước provider. Transaction ngắn đánh dấu SENT rồi trả khóa; transaction cuối kiểm lại snapshot trước mutation. Dùng chung `resolveProvisionParameters`, claim trả phiên bản PROCESSING thực tế. Khi dữ liệu đổi sau provider, giữ receipt để đối soát và không tự phát lại. [Chi tiết và giới hạn](T14_EXECUTION_GUARDS_2026-11-05.md).

| Kiểm tra thực chạy 05/11 | Kết quả | Bằng chứng |
| --- | --- | --- |
| Frontend unit | 131/131 | [report](tools/test-artifacts/unit/resume-20261105-frontend/results.json) |
| Backend unit | 145/145 | [report](tools/test-artifacts/unit/resume-20261105-backend/results.json) |
| Worker PostgreSQL thật | 23/23 | [report](tools/test-artifacts/integration/crypta-t30-test-dfb502e8f8f6/worker-recovery-after-3ff558a99fdf/results.json) |
| Policy PostgreSQL thật | 8/8 | [report](tools/test-artifacts/integration/crypta-t30-test-dfb502e8f8f6/policy-version-e724c5bf7f7d/results.json) |
| Expiry PostgreSQL thật | 13/13 | [report](tools/test-artifacts/integration/crypta-t30-test-dfb502e8f8f6/expiry-scan-a34d24bd2e8c/results.json) |
| Browser/API/Nginx/DB Edge | 23/23 | [report](tools/test-artifacts/integration/crypta-t30-test-dfb502e8f8f6/real-msedge-1793891619529/results.json) |
| Browser/API/Nginx/DB Chrome | 23/23 | [report](tools/test-artifacts/integration/crypta-t30-test-dfb502e8f8f6/real-chrome-1793891696961/results.json) |
| Backup/restore | 11/11, 17 bảng và sequence khớp | [report](tools/test-artifacts/integration/crypta-t30-test-dfb502e8f8f6/backup-restore-7f419945e7db/results.json) |
| Cleanup | Test container/volume/network 0/0/0; tám container ngoài test giữ nguyên full ID/name/project | [report](tools/test-artifacts/integration/crypta-t30-test-dfb502e8f8f6/cleanup-report.json) |

Backend build và Docker build backend/frontend đạt. Backend image `sha256:c8bf18936f88acba9f2790bd8d180fad0842a06aa70a320e9c7154ba0a319ea4`, frontend `sha256:ec665713f2dc51469cb0ce9f890f9ced08536599b78f47032ec8ee3715b55dd6`; MOCK/SMTP=false. [Runtime provenance](tools/test-artifacts/integration/crypta-t30-test-dfb502e8f8f6/runtime-provenance.json) có đủ tám migration và hash ba file frontend thực đang phục vụ, khớp build ON cũ `sWnhGYiW/CRAMZK9_`.

[Snapshot 194 file nguồn và hai build](tools/test-artifacts/frontend-artifacts/worker-guards-20261105-phase1/source-manifest.json), archive SHA-256 `3f3ea882ad81647a40a76d9a62cac03d36043c49731c2e29e3ec603c1e0543fe`, đã được [verifier](tools/test-artifacts/frontend-artifacts/worker-guards-20261105-phase1/evidence-verification.json) kiểm khớp source/build/compiled/report/dump/cleanup. Đây là pha trước cập nhật dependency; không gán kết quả này cho lockfile hoặc image pha sau. HEAD còn working tree dirty, chưa có revision release.

## Pha 2 — dependency và parser đã kiểm chứng trên image mới

[Security report](T39_DEPENDENCY_SECURITY_2026-11-05.md) ghi bản vá, primary advisories và scope từng dependency; audit lockfile mới **0** backend all/production/frontend. Backend Vitest 4.1.12 và scoped overrides giữ Multer2.5.0/Vite7; không ép đổi major Nest hoặc React Router. [Parser filter](T03_PARSER_ERRORS_2026-11-05.md) có đối chứng **8/16→16/16**; full backend **161/161**, frontend **131/131** và ba build exit0. Sáu file ON/OFF mới có cùng byte hash pha1; không chạy lại fixture180 hoặc gọi đó là kết quả browser156 mới.

Backend image cuối `sha256:a2ce8053e25c95d441eefc06f4488338bf4b2837ed316be0cf1aa81c119776e1`, frontend `sha256:1bbc02d1f0681c07ef1be0fc483e0b8bba531a076fc83f9770ad84999e5d7545` trong stack `crypta-t30-test-d375cbb5e29e`, MOCK/SMTP=false. Smoke17+13 đạt; [worker23](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/worker-recovery-after-d8ca0bea013f/results.json), [policy8](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/policy-version-fe1e0b353cfc/results.json), [expiry13](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/expiry-scan-f68ae2575340/results.json), [parserHTTP3](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/body-parser-06976459b2b8/results.json), [Edge23](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/real-msedge-1793893369683/results.json), [Chrome23](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/real-chrome-1793893445551/results.json) đều đạt. Parser2.4.0 nhận ba body38/4/1063byte và trả404/400/404; health sau200ms, PID/start/restart count giữ nguyên. Không stress, không thử crash image cũ và không chứng minh mọi decoder timing.

[Backup cuối](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/backup-restore-5c0bd4305613/results.json) **11/11**, **17 bảng/sequence** khớp, dump 91396 byte SHA-256 `c6c714870d1281381ba96057607523b11266dd6f9a31b9f9967a009537f8eda3`; restore+verify 15.673s, không phải RTO production. [Cleanup cuối](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/cleanup-report.json) container/volume/network test0/0/0, trigger/function t30_0/0; tám container ngoài test giữ full ID/name/project. [Runtime provenance](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/runtime-provenance.json) ghi tám migration và ba hash file frontend thực đang phục vụ.

## Pha 3 — runtime ledger validate và CLI operator

[Implementation/bằng chứng](T43_RUNTIME_LEDGER_2026-11-05.md) và [runbook](DATABASE_MIGRATIONS.md): default startup chỉ đọc ledger, CLI apply riêng; Compose demo vẫn explicit apply. SQL/checksum001–008 không đổi. Backend172/172/migration16/16/build đạt; PostgreSQL compiled CLI/validator10/10, role test SELECT-only không own object, sáu lệnhDDL/DML deny42501. Role test là SET ROLE, không thay LOGIN credential proof.

Backend test đã recreatevalidate, giữ tám version/checksum/applied_at; worker23/policy8/expiry13, Edge23/Chrome23 và backup11 đạt. Stack/role/DB con đã dọn, tám container ngoài test giữ identity. Snapshot199 file SHA69a2ec5686747c53328a651f9cdd8c621cbb3c18f63c8ed76d85e7c90a96cbb3 được kiểm source/build/compiled/report/dump/cleanup. APIphase này vẫn bootstrap role; full runtime grants/rotation/rollout chưa hoàn tất. Không gán snapshot196file hoặc unit161 của pha2 thành kết quả source mới.

## Pha4 — Runtime LOGIN và cấp lại quyền,06/11/2026

[Bằng chứng mới](T43_RUNTIME_LOGIN_2026-11-06.md) có **19/19 nhóm** PostgreSQL/API compiled thực, owner NOLOGIN/migrator LOGIN/runtime LOGIN tách biệt. Template reset direct ACL cả cột trước cấp lại;7 cấu hình nguy hiểm bị từ chối22023 và giữ ACL. Quyền dư database/schema/table/column/sequence được thu hồi;21 lệnh cấm deny42501 và policy UPDATE trigger23514. Auth/user/access, CREATE/RENEW/REVOKE worker, reject/cancel, audit rollback, policy/Admin concurrency, expiry/IN_APP, fake email bookkeeping và password rotation đạt. Database/ba role con đã dọn, ngoài test giữ8 danh tính; application source backend giữ nguyên qua resume.

Backend **186/186**,25 file/build đạt trong lượt05/11; frontend131/131 và browser23 mỗi Edge/Chrome giữ phạm vi pha cũ, không chạy lại trong pha4. [Snapshot203 file](tools/test-artifacts/frontend-artifacts/runtime-login-20261106-final/source-manifest.json) SHA-256 `dafe558ffd6a73e5e5abef15d4e1d2cbc1a3ba683273a3329fa0269bab44a90c`. Parent Compose vẫn bootstrap/apply, chỉ API con dùng runtime/validate. Ngoại lệ UPDATE khóa dòng và rollout chưa hoàn tất; không dùng19 nhóm để tuyên bố toàn bộ T43 đã nghiệm thu.

Backup/restore pha4 **11/11**,17 bảng/sequence khớp; cleanup test0/0/0, giữ8 container ngoài test. [Verifier203 file](tools/test-artifacts/frontend-artifacts/runtime-login-20261106-final/evidence-verification.json) đạt current source/build/compiled/report/dump/cleanup và kiểm các invariant guard/reset/LOGIN/rotation. Không gán audit hoặc browser của pha trước thành lần chạy mới.

## Pha5 — T30 GET thật chờ PostgreSQL,06/11/2026

[Bằng chứng mới](T30_DELAYED_GET_2026-11-06.md): full integration **26/26 mỗi Edge156/Chrome157**, thêm route change, logout→account khác và ADMIN→USER trong khi GET assets thật chờ relation lock. `pg_stat_activity`/`pg_blocking_pids` xác nhận waiter tới đúng holder; browser abort read cũ, không hiện asset ngoài owner/scope sau nhả khóa. Cả sáu ca giữ một document/script ban đầu, không business mutation/pageerror; cùng scope giữ shell, account/role boundary thay shell. Session holder remaining0, không thêm schema/trigger/function.

[Backup11/11](tools/test-artifacts/integration/crypta-t30-test-0dc1e30490b6/backup-restore-cbc2664e5ca7/results.json),17 bảng/sequence khớp; [cleanup](tools/test-artifacts/integration/crypta-t30-test-0dc1e30490b6/cleanup-report.json) test0/0/0 và giữ8 danh tính ngoài test. [Snapshot204 file](tools/test-artifacts/frontend-artifacts/delayed-navigation-20261106-final/source-manifest.json) SHA-256 `a3b19f63e0179384610909d97c454bce7776ae19a664366c0f59d23f3566c907`. Product FE/BE và hai build giữ hash pha4; unit không chạy lại. Race Assets desktop không thay mọi endpoint/mobile/Gecko/NAV20/network/performance hoặc runtime-role rollout.

## T30/N6 và các phần còn mở

Lượt CSS tiếp06/11 sửa [viền focus nhạt và radio không có chỉ báo trên nhãn](T30_FOCUS_CONTRAST_2026-11-06.md). Before đã kiểm đủ100:96 viền có cận trên dưới3:1,4 radio label outline none; sau sửa600/600 trên Edge/Chrome/Firefox ON/OFF, cận thấp nhất4,64449:1. Native radio keyboard12/12 và hai build đạt; JS hai mode giữ byte pha trước, chỉ styles.css đổi trong source ứng dụng. CSS mớiCWPkO1Nq, JSfileBYt9mBPj/C1Inveug. Snapshot206 file/verifier màu độc lập/cleanup đạt; không chạy lại unit131 hoặc full180 vì thay đổi chỉ CSS. Các lượt đo bị giới hạn được giữ riêng; screen reader/toàn WCAG/N6 vẫn mở.

Lượt tiếp06/11 đã sửa [focus trap dialog đang gửi](T30_DIALOG_FOCUS_2026-11-06.md): fieldset disabled làm control native `:disabled` dù thiếu attribute riêng; bộ lọc cũ chọn nhầm tab stop, Tab thoát body. Before0/16 → sau96/96 nhóm/480 phím trên Edge/Chrome/Firefox, ON/OFF ×desktop/mobile ×light/dark. FE131/131 và hai build đạt, JS ON/OFF mới `BWV_OzFu/DFRUkWzt`, CSS giữCRAMZK9_. Hồi quy **180/180 mỗi Edge/Chrome/Firefox** chạy toàn suite trên bundle mới, visual4/4 đạt. Snapshot205 file SHA-256 `b3ad45e4f6c23780d8e1c491abef26629f8250f9649431181a0d1e963ab2cd25`; chỉ WorkspaceUi.tsx là application file thay đổi so pha5. Verifier source/build/report đạt;11 preview process, port4173/esbuild còn0. Không chạy lại DB/API thật hoặc nghe screen reader trong lượt này.

NAV20 đã bổ sung [network baseline12/12 mẫu](T30_USERS_NETWORK_2026-11-06.md) Edge/Chrome: tái dựng8 Git files trước routing, cold Users7→3 GET, Users503+retry14→4; journey Dashboard/menu/quay lại được đếm riêng. Fixture chỉ adapt top-level array contract cho baseline, cùng underlying records; không phải latency/bytes/DB thật. Product frontend82 file và6 build files trước/sau đã kiểm hash; preview/esbuild0. Khoảng trống fixture baseline được thu hẹp, còn deployment trace và toàn ma trận.

Ứng viên gộp25 hàng skeleton thành1 hàng/6 ô ngày06/11 đạt40/40 state/geometry, nhưng24/24 mẫu/288 windows không có lợi ích ổn định: Users render union OFF desktop/mobile tăng1,44%/2,87%, ON desktop−0,31%/mobile+2,06%, delta đổi dấu. **Không tích hợp**, product giữ nguyên. [Bằng chứng và giới hạn](T30_SKELETON_BANDS_2026-11-06.md); bộ extras/refetch chỉ chuẩn bị, chưa chạy hoặc coi là pass.

Cập nhật06/11: đúng artifact không span từ render đầu đạt **40/40 nhóm** đối chứng:32 nhóm normal/empty/short/multiline × ON/OFF ×1440/390 ×light/dark,8 nhóm503→retry pending→403→phục hồi. Geometry/nội dung/hidden semantics khớp, không pageerror/mutation; source/build giữ hash. Đã xem ảnh mobile dark pending/loaded, đóng bốn preview và xác minh port/esbuild0. [Bằng chứng](T30_SKELETON_PERFORMANCE_2026-11-05.md) giữ lượt0 nhóm do sandbox riêng;40 nhóm không đo lại performance hoặc chứng minh background refetch/screen reader. Chưa tích hợp, N6 vẫn mở.

Artifact Users không span từ render đầu đã build ON/OFF, đạt16/16 live resize/theme và hoàn tất24/24 mẫu performance/288 route windows. Users render union trung bình giảm11,39%/9,06% desktop OFF/ON và2,32%/10,86% mobile OFF/ON; OFF mobile tăng ở hai vòng, nên chưa tích hợp/đóngN6. Product source/build giữ nguyên. [Đối chứng và giới hạn](T30_SKELETON_PERFORMANCE_2026-11-05.md).

Lượt geometry tiếp theo đạt **32/32 nhóm**, đủ ON/OFF/1440/390/light/dark/normal/empty/short/multiline, giữ25 hàng/150 ô/175 vạch và64 đối chiếu hidden/visible. Source/build không đổi; SVG nền khác raster nhỏ ở mép bo tròn và chưa được đo hiệu năng hoặc tích hợp. [Bằng chứng và giới hạn](T30_SKELETON_GEOMETRY_2026-11-05.md). Các kết quả geometry không thay phạm vi diagnostic3/4 bên dưới.

[Checkpoint N6](tools/test-artifacts/spa/users-layout-diagnostic-20261006/CHECKPOINT_2026-11-05.md) giữ enumeration rỗng và0/4 ban đầu. Probe phát sự kiện xác nhận **7/7 predicate** trên Edge156. Capture ứng dụng sau đó **3/4**, ON390 lỗi route assertion ở650ms, trace lỗi được giữ. Attribution có25 TR/150 TD/175 span skeleton trước Users Layout lớn; chưa xác định toàn bộ chi phí native hoặc chứng minh bỏ span sẽ cải thiện. [Đề xuất geometry](tools/test-artifacts/spa/users-layout-diagnostic-20261006/SKELETON_GEOMETRY_PROPOSAL_2026-11-05.md) giữ loading180ms và footprint; chưa chạy hoặc tích hợp. Debug timings không thay performance baseline/physical-display acceptance.

46 task chính được đối chiếu ít nhất một phần, 8 chưa đối chiếu riêng và 6 task mở rộng chưa nghiệm thu. [Thống kê 54+6](TASK_STATUS_2026-11-05.md).

T09 đã có migration 009 và API nháp riêng tư, gửi, hủy. Runtime LOGIN 23/23 gồm bốn nhóm mới cho privacy, gửi/hủy đồng thời và rollback. Lượt UI tiếp theo thêm các nút lưu/sửa/gửi, xác nhận hủy, giữ nội dung sau xung đột và đối chiếu lost response. Edge/Chrome mới 24/24 nhóm, FE133/133. Còn ma trận vai trò, dữ liệu cũ và nghiệm thu nghiệp vụ. [Bằng chứng T09](T09_REQUEST_DRAFTS_2026-11-06.md).

CI hiện gọi unit test JSON cho cả backend/frontend và `npm audit --audit-level=high` trên registry công khai. Hai nhánh matrix chạy độc lập, timeout15 phút; bước `always()` giữ report audit/unit14 ngày kể cả khi thất bại. YAML đã parse và kiểm cấu hình local; chưa có bằng chứng remote run hoặc required checks. [Rà T43](T43_DB_HARDENING_REVIEW_2026-11-05.md) xác định cần tách runtime/migrator và xử lý quyền row-lock trước kiểm quyền DB thực; chưa triển khai role hạn chế vào DB vận hành.

[Snapshot cuối](tools/test-artifacts/frontend-artifacts/security-parser-20261105-final/source-manifest.json) gồm **196 file nguồn**, archive SHA-256 `58c851eabe5c1661ff4ff44029b3048cc7e1ffff2c6471fdb886574ba64b4351`. [Verifier cuối](tools/test-artifacts/frontend-artifacts/security-parser-20261105-final/evidence-verification.json) đạt: source lúc chốt pha2 khớp archive, sáu build file và ba asset đang phục vụ khớp, compiled service/filter khớp report, tám migration, dump/cleanup và ba audit0 được đối chiếu. Đây là kiểm bằng chứng đã lưu, không chạy lại test hay nghiệm thu release. Sáu tài liệu mới đã kiểm107 liên kết local; đủ54+6 dòng task,13 task chính chưa đối chiếu riêng.

Provider mật mã, SMTP và môi trường triển khai thật chưa được người dùng chọn: [điều kiện dịch vụ thật](CAU_HINH_DICH_VU_THAT.md). Nháp/reset, recovery workflow, hardening quyền DB, UAT và các tiêu chí còn lại vẫn thuộc kế hoạch; không đóng Goal từ các suite xanh của pha này.

Lượt T05 tiếp ngày 06/11 sửa request quản trị đã qua guard nhưng chờ khóa: sau khi người gửi bị thu hồi quyền hoặc khóa, transaction đọc lại actor và từ chối trước khi ghi. Đối chứng 2/8 → 8/8 nhóm API/DB; backend202/202/build, runtime LOGIN23/23, Edge integration26/26. [Bằng chứng T05](T05_USER_ADMINISTRATION_2026-11-06.md). Source ứng dụng chỉ đổi UsersService; frontend giữ byte pha T09. Backup/restore11/11, cleanup0/0/0, giữ tám container ngoài test. Chưa nghiệm thu toàn bộ T05 hoặc release.

Lượt T24 tiếp ngày06/11 thêm tám mẫu thư nghiệp vụ có link/múi giờ và hai mẫu tài khoản chờ T07; worker enqueue kết quả cùng transaction qua migration010. Backend233/233, FE133/133/hai build, SMTP loopback10/10, preview20/20, link thật3/3, worker23/23, runtime LOGIN23/23, ledger10/10 và Edge26/26. [Bằng chứng T24](T24_EMAIL_TEMPLATES_2026-11-06.md). T24 còn nối token tài khoản/T07 và nghiệm thu nội dung/tần suất; T25 còn SMTP/Inbox thật. Backup11/11, cleanup0/0/0 và giữ tám container ngoài test.
