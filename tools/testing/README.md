# T30 — Stack tích hợp cách ly

## Quay demo từ stack thật

`node tools/record-crypta-demo.cjs <report.json> <node_modules-co-playwright>` quay Chrome trên stack mới đã qua smoke. Bộ quay dùng seed và phiên API, tạo cấp mới/gia hạn/thu hồi/từ chối từ giao diện rồi kiểm kết quả PostgreSQL. Mỗi lượt thay đổi policy và quyền của tài khoản mẫu. Video có 12 mốc, provider MOCK và SMTP tắt. [Video và cách dựng lại](../../docs/DEMO_VA_BAN_GIAO.md)

## Đo tải với fixture lớn

`node tools/test-real-capacity.cjs <report.json> <nhãn-lượt-đo> --seed` dùng stack cách ly đã chạy smoke và volume mới. Runner xác minh namespace Docker, cổng loopback, SMTP tắt và provider MOCK trước khi nạp dữ liệu. Lượt sau bỏ `--seed`. Tùy chọn `--pages` thêm đo Chrome với `CRYPTA_CAPACITY_PLAYWRIGHT`. Tùy chọn `--jobs` gửi 12 yêu cầu cấp mới sau pha đo đọc, vì vậy dùng ở lượt so sánh cuối. [Dữ liệu, cách đo và kết quả](../../T50_CAPACITY_2026-11-06.md)

Thêm `--monitor` để đo 48 lượt collector song song với 32 luồng đọc nghiệp vụ. Trước khi dựng stack, đặt `T30_TEST_MONITOR_TOKEN_SHA256` bằng SHA-256 của token thử như diễn tập monitor ở dưới. Đặt `CRYPTA_CAPACITY_MONITOR_TOKEN_FILE` trỏ tới file token đó trong `tools/test-artifacts/`. Bài thử dùng bốn trạng thái retry, đối chiếu tín hiệu và sự kiện mở/đóng, rồi dọn fixture. Xóa file token thử khi dọn stack.

## Email và thông báo kết quả

`npm --prefix backend run test:smtp` kiểm sáu ca Nodemailer với SMTP IPv4 loopback và DB mô phỏng. Các ca gồm accept, 550, mất ACK sau DATA, lỗi audit sau accept, từ chối STARTTLS và cấu hình cổng hoặc auth sai. Bộ unit thông thường không chạy file `.integration.ts` này. CI backend có bước riêng bắt buộc. Nghiệm thu hộp thư bên ngoài theo T25.

`./tools/test-real-shutdown.ps1 -ReportPath <report.json>` gửi SIGTERM cho API của một stack test. Ca thử giữ một giao dịch PostgreSQL ở bước ghi tài sản để đối chiếu thứ tự dừng. Chạy sau các bài API/trình duyệt vì ca này để backend test ở trạng thái đã dừng. Dùng `run-integration.ps1` để chạy và dọn stack tự động. [Cách chạy CI local](../ci/README.md)

Runner runtime LOGIN ghép thêm `email-test-operations-runner.cjs` vào SMTP loopback T07 và có 49 nhóm trên migration 018. Ca liên kết khóa kiểm quyền UPDATE, trigger và khóa dòng thực. Provisioning còn kiểm việc từ chối template khi trigger thiếu hoặc bị tắt. Kết quả gửi thư được kiểm bằng SMTP loopback trong runner.

`node tools/test-real-email-delivery.cjs <report.json>` tạo DB email-test riêng và kiểm10 nhóm: ba kết quả CREATE/RENEW/REVOKE, đối soát không replay, rollback khi enqueue lỗi, hai worker claim, tám loại thư qua SMTP loopback, cấu hình lỗi và Message-ID trong MIME có folding. Nó không gửi SMTP ra ngoài; DB test được dọn bởi wrapper đã kiểm ownership/inventory.

`node tools/preview-email-templates.cjs <report-email.json> <node_modules-co-playwright>` render10 mẫu dữ liệu giả ở800/320, có20 ảnh, kiểm keyboard/link/overflow và không có request mạng. Hai mẫu tài khoản chưa được bật gửi qua T07. `node tools/test-real-email-links.cjs <report.json> <node_modules-co-playwright>` kiểm3 nhóm link thư qua login, nhãn thông báo hoàn tất thật và từ chối tài khoản ngoài quyền. Kiểm SMTP/Inbox/email client thật thuộc T25.

## Tương phản viền focus

`node tools/test-spa-focus-contrast.cjs <node_modules-co-playwright>` kiểm100 control trong6 flow ×1440/390 ×light/dark. Dùng `CRYPTA_TEST_BROWSER`, `CRYPTA_FOCUS_CONTRAST_MODE=on|off`, `CRYPTA_FOCUS_CONTRAST_OUTPUT=<thư mục mới>`; Firefox dùng runtime có sẵn qua `PLAYWRIGHT_BROWSERS_PATH`. Preview4173 phải trống, runner tự đóng browser/preview; không submit form hoặc gửi API/SMTP thật.

Màu computed lấy từ browser; alpha source-over trong sRGB, sau đó tính WCAG relative luminance/contrast không làm tròn trước ngưỡng3:1. Với gradient trắng3.2% của panel dark, dùng bao4% và cận luminance độc lập để kiểm conservative lower bound; gradient/opacity/backdrop khác bị từ chối thay vì tự coi là pass. Radio input opacity0 được kiểm trên label là phần hiển thị focus, đồng thời xác nhận native input có `:focus-visible`. Chưa là mọi control/nền hoặc audit WCAG toàn bộ.

`CRYPTA_FOCUS_CONTRAST_BASELINE=dialog-focus` chỉ phục vụ bản before đã giải nén của snapshot205, kiểm từng build file hash trước chạy. Trong mode này runtime CSS do archive xác định; `sourceHashes` ghi workspace tại thời điểm đo, không thay provenance của build cũ. Các lượt có lỗi setup/unsupported background phải giữ riêng; chỉ matrix không có lỗi đo mới dùng để kết luận tỷ lệ pass/fail.

## Focus dialog khi mutation đang chờ

`node tools/test-spa-dialog-focus.cjs <node_modules-co-playwright>` tạo preview riêng tại4173 và kiểm4 dialog request/decision/create-user/test-email ×1440/390 ×light/dark. `CRYPTA_TEST_BROWSER=msedge|chrome|firefox`, `CRYPTA_DIALOG_FOCUS_MODE=on|off`, `CRYPTA_DIALOG_FOCUS_OUTPUT=<thư mục mới>` chọn matrix/build/report; Firefox cần `PLAYWRIGHT_BROWSERS_PATH` trỏ runtime đã cài. Runner từ chối port đang dùng và tự đóng preview/browser; không dùng chung listener không rõ chủ sở hữu.

HTTP fixture giữ mutation pending để fieldset disabled thật. Từ nút Đóng,5 lần Tab/Shift+Tab phải giữ focus trong dialog, chỉ một mutation fixture. Lỗi trước sửa: input/textarea không có attribute disabled nhưng `:disabled` là true vì fieldset cha; trap chọn nhầm tab stop và focus thoát body. Hook nay loại native `:disabled`, gồm semantics fieldset/legend của browser. Report ghi tag/trạng thái disabled và focus, không ghi body/password được sinh. SMTP/provider/API thật không được gọi; đây không thay nghiệm thu screen reader hoặc toàn accessibility.

## Luồng nghiệp vụ và điều hướng với PostgreSQL

`node tools/test-real-integration.cjs <report.json> <node_modules-co-playwright> msedge` (hoặc `chrome`) hiện có 35 nhóm. T49 thêm chuỗi cấp mới, gia hạn và thu hồi từ giao diện qua Approver tới worker MOCK. Hai nhóm từ chối kiểm bàn phím, tên người duyệt, lý do và các mốc sau F5 ở 1440 px sáng và 390 px tối. [Kịch bản nghiệm thu](../../docs/NGHIEM_THU_UAT.md)

Ba nhóm trong [delayed-navigation.cjs](delayed-navigation.cjs) kiểm route change, logout/đổi tài khoản và ADMIN→USER khi GET assets đang chờ PostgreSQL. Các report cũ giữ nguyên source và image theo từng lượt.

Helper chỉ chạy qua context của runner đã xác minh stack cách ly. Nó mở process psql riêng trong PostgreSQL test, đặt application_name ngẫu nhiên, giữ ACCESS EXCLUSIVE trên crypto_assets trong transaction rollback. Chờ xác nhận `pg_stat_activity` có API COUNT assets chờ relation lock và `pg_blocking_pids` trỏ đúng holder, rồi thao tác UI thật. Không intercept/fulfill HTTP hoặc sửa schema/function. Có15s safety sleep, statement_timeout20s/lock_timeout3s; bình thường hủy đúng session holder bằng PID+application_name+database+user và chờ psql thoát trong finally. Không dùng helper lên DB vận hành.

Report lưu waiter PID/blocker, browser read bị abort, một document/không tải thêm script, scope/shell boundary và holder remaining0. Browser đã abort request không được coi là đã nhận late200 body; query DB đang chờ được quan sát độc lập. Đây là race GET assets trên desktop hiện hành, không chứng minh mọi endpoint/mobile/browser engine, NAV20 network baseline toàn bộ hoặc production TLS/provider/SMTP.

## Quyền Admin sau khi chờ khóa

`node tools/test-real-user-administration.cjs <report.json>` kiểm tám nhóm HTTP/DB trên stack cách ly đang giữ. Sáu ca cho request đổi trạng thái/quyền qua xác thực rồi chờ advisory lock; một Admin khác thu hồi quyền hoặc khóa người gửi trước khi nhả khóa. Request cũ phải bị từ chối, không thay dữ liệu hoặc audit của đối tượng. Hai nhóm còn lại kiểm rollback khi audit lỗi và thu hồi phiên/token khi cập nhật thành công. Holder PostgreSQL có tên riêng và giới hạn 25 giây; runner kết thúc đúng PID/name/database/user, dọn trigger/function lỗi trong finally và kiểm residue bằng 0. Token và mật khẩu chỉ ở bộ nhớ.

## Runtime LOGIN và cấp lại quyền

`node tools/test-real-runtime-privileges.cjs <report.json>` yêu cầu stack mới đang giữ với ba service chạy, MOCK/SMTP=false và port loopback. Nó tạo database cùng ba role riêng: owner NOLOGIN, migrator LOGIN chuyển sang owner qua CLI, runtime LOGIN không membership/ownership. API compiled con chạy port3309 bên trong backend container, chỉ nhận runtime URL và startup validate. Parent Compose vẫn là bootstrap/apply local/demo; không coi ma trận này là rollout môi trường vận hành.

Ma trận có 23 nhóm. Ngoài 19 nhóm migration, quyền, API và worker, bốn nhóm T09 kiểm nháp riêng tư, tranh chấp sửa/gửi, rollback khi ghi thông báo lỗi, gia hạn cạnh tranh và hủy. Guard lỗi được rollback trên cùng client và đối chiếu ACL trước/sau. SMTP network bằng 0, provider MOCK. Runner xóa đúng database và ba role test trong finally rồi đối chiếu inventory ngoài namespace.

`node tools/test-real-request-draft-ui.cjs <report.json> <node_modules-co-playwright> msedge` hoặc `chrome` kiểm luồng nháp hoàn toàn qua UI trên stack test đang giữ. Mỗi browser có 12 nhóm, gồm hai tab sửa cùng bản nháp, mất phản hồi sau PUT đã commit thật và giữ cờ khẩn cấp/tham số khi chỉ sửa lý do. Runner mô phỏng mất phản hồi bằng cách chuyển tiếp request rồi ngắt response, ghi rõ trong tên ca kiểm. Ca giữ tham số tạo nháp qua UI rồi chuẩn bị dữ liệu cũ bằng UPDATE đúng ID trong DB test; tên ca và report ghi rõ phần fixture này. Báo cáo đối chiếu audit, thông báo và provider operation bằng truy vấn chỉ đọc. Các request fixture thuộc DB test và được dọn cùng stack.

Template [runtime-grants.sql](runtime-grants.sql) reset direct ACLs rồi cấp lại quyền cho17 bảng/cột và sequence audit. Guard từ chối PUBLIC table/column/sequence grants và PUBLIC CREATE database trước thay đổi. Nó thu hồi PUBLIC CREATE schema/TEMPORARY database; operator phải xem phạm vi ảnh hưởng theo [runbook](../../DATABASE_MIGRATIONS.md). Ba ngoại lệ UPDATE phục vụ khóa dòng (`policies.updated_at`, `policy_versions.id`, `cryptographic_keys.asset_id`) vẫn là quyền thực; immutable trigger chỉ bảo vệ policy đã phát hành. Chưa là audit mọi object trong cluster, RLS, bảo vệ DBA hoặc nghiệm thu production.

Runtime startup mặc định nay `DATABASE_MIGRATION_MODE=validate` và chỉ đọc ledger; migration operator gọi CLI `dist/database/migrate.js` hoặc `MigrationService.applyPending()`. Compose test khai báo `${T30_TEST_MIGRATION_MODE:-apply}` để bootstrap DB riêng. Worker/policy/expiry runner gọi `applyPending()` rõ ràng, không dùng startup validate để bootstrap. [Runbook](../../DATABASE_MIGRATIONS.md). `node tools/test-real-runtime-ledger.cjs <report.json>` tạo DB/role test riêng, kiểm CLI/SELECT-only validator và DDL/DML deny, rồi dọn đúng DB/role đó; không kiểm toàn API bằng role runtime hạn chế.

Ngày 05/11/2026: worker dùng chung `resolveProvisionParameters`, kiểm request/policy/target trong transaction ngắn trước provider, rồi kiểm lại snapshot trong transaction hoàn tất. Không giữ row lock qua provider call. AFTER hiện cần **23/23 nhóm**; các report 12/12 ngày 06/10 thuộc source/image cũ. [Bằng chứng execution guards](../../T14_EXECUTION_GUARDS_2026-11-05.md) ghi 145/145 backend unit, 23/23 worker DB, 8/8 policy và 13/13 expiry trên image kiểm thử riêng; receipt/drift không đồng nghĩa fencing, OS-crash hoặc provider thật đã nghiệm thu.

Dependency security và parser error có pha source/image sau: [dependency report](../../T39_DEPENDENCY_SECURITY_2026-11-05.md). Backend Vitest 4 và scoped overrides được ghi trong package manifest; CI chạy unit cho cả hai package và audit mức high/critical. Không gán kết quả image trước cập nhật dependency cho pha sau.

Để kiểm gzip trên image đã vá, dùng `node tools/test-real-body-parser.cjs <report.json-cua-stack-test>`. Runner xác minh namespace, labels, env, port, volume và phiên bản body-parser thực được Nest/Express load, rồi chạy ba POST nhỏ trực tiếp trên loopback trong backend container. Không qua Nginx buffering, không dùng credential hoặc endpoint nghiệp vụ. Giới hạn body 2 KiB, deadline 4 giây, không tự thử lại; ghi health sau phản hồi, PID/start/restart count và inventory trước/sau. Đây là bounded HTTP regression, không thay stress test hay toàn bộ coverage upstream.

`compose.t30.yml` và `../test-isolated-stack.ps1` tạo project Compose mới cho mỗi lượt. PostgreSQL 17 dùng database `crypta_t30_test` và volume thuộc project sinh ngẫu nhiên; schema/seed được mount chỉ đọc. Backend và Nginx build từ source hiện tại. Cổng mặc định `127.0.0.1:18080`, SMTP tắt và crypto provider `MOCK`.

Từ thư mục gốc dự án, chỉ chuẩn bị metadata và secret test:

```powershell
./tools/test-isolated-stack.ps1 -PrepareOnly
```

Khi Docker daemon hoạt động, chạy smoke Nginx/direct route và API với seed demo:

```powershell
./tools/test-isolated-stack.ps1
```

Có thể đổi cổng bằng `-Port 18081`. Script kiểm tra namespace container/volume mới, config volume do project quản lý và binding loopback trước khi chạy. Smoke API tạo tài khoản test, đổi mật khẩu, kiểm tra token cũ bị thu hồi và phân quyền/policy; các thay đổi chỉ ở database mới này. Thông tin xác thực test nằm trong `tools/test-artifacts/integration/<project>/test.env`, đã được Git bỏ qua; report không chứa secret.

Mặc định `finally` dừng và xóa **volume của project test vừa sinh**, kể cả khi build/smoke lỗi. `-KeepStack` giữ stack để điều tra. Chỉ dùng project/env-file được ghi trong report để dọn stack đó:

```powershell
docker compose --project-name <project-trong-report> --env-file <duong-dan-test.env> --file tools/testing/compose.t30.yml down --volumes --remove-orphans
```

`report.json` ghi `PREPARED`, `FAILED`, `PASSED` hoặc `PASSED_CLEANUP_FAILED`, cùng hash asset frontend sau smoke và cờ cleanup. Cleanup thất bại sau smoke làm script trả lỗi; nếu smoke đã lỗi thì giữ nguyên lỗi đó và thêm thông tin cleanup vào report. `PREPARED` và config hợp lệ không phải kết quả integration. `PASSED` chỉ chứng minh các smoke đã chạy. Bộ `test-spa-workspace.cjs` dùng HTTP fixture, không tự chuyển thành integration khi có stack này.

Để kiểm tra cookie/F5/logout, scope/SoD, thu hồi quyền và race trên DB thật, tạo stack với `-KeepStack`, rồi chạy tuần tự mỗi browser:

```powershell
node tools/test-real-integration.cjs tools/test-artifacts/integration/<project>/report.json <thu-muc-node_modules-co-playwright> msedge
node tools/test-real-integration.cjs tools/test-artifacts/integration/<project>/report.json <thu-muc-node_modules-co-playwright> chrome
```

Runner này từ chối origin vận hành, yêu cầu namespace mới do runner stack sinh, kiểm tra label ba container, DB/volume, MOCK/SMTP=false trước khi ghi. Nó không đọc `.env` vận hành, không intercept HTTP, không lưu token/cookie/password hoặc trace/HAR phiên thật. Report lưu tên asset đang phục vụ, phiên bản browser, image ID và kết quả đã lọc. Có một ca tạo trigger tạm trên `auth_sessions` trong DB test để làm chậm rotation 2 giây; trigger/function được gỡ trong `finally`. Không chạy hai lượt tích hợp đồng thời trên cùng stack vì ca Admin cuối tạm đổi trạng thái seed và phục hồi trong `finally`.

Sau kiểm tra stack giữ lại, dùng helper xác minh ownership, residue và inventory trước/sau:

```powershell
./tools/cleanup-isolated-stack.ps1 -ReportPath tools/test-artifacts/integration/<project>/report.json
```

Helper chỉ dọn đúng namespace test và kiểm ID/name/project của mọi container ngoài test, kể cả container đã dừng hoặc không có label Compose. Không dùng runner thật với stack có dữ liệu cần giữ. Có thể lọc tên ca bằng `CRYPTA_REAL_TEST_FILTER` khi điều tra; lượt lọc không thay nghiệm thu toàn suite.

Ngày 01/10/2026: Docker đã hoạt động, stack cách ly mới vượt qua Nginx/API smoke và 18/18 nhóm tích hợp thật mỗi Edge/Chrome, gồm hai Approver khác nhau chỉ ghi một decision/audit. [Báo cáo mới](../../T30_PROGRESS_2026-10-01_N4_ZOOM_N6.md) ghi N4 danh sách, zoom thật và trace; [M/N4 trước](../../T30_PROGRESS_2026-10-01_M_N4.md) giữ đối chứng deadlock/rollback. Các report preflight thất bại giữ làm lịch sử.

`../test-spa-zoom.cjs <node_modules-co-playwright>` tạo profile riêng, đổi Settings page zoom 200% với viewport:null, kiểm tra ba role/hai theme bằng fixture. Mặc định Chrome; `CRYPTA_TEST_BROWSER=msedge` dùng Settings Accessibility của Edge, `chrome` dùng Appearance. Mặc định thư mục artifact mới theo timestamp; `CRYPTA_ZOOM_OUTPUT` cần trỏ một thư mục/profile chưa chạy. Không dùng profile browser cá nhân. Report ghi outer/inner viewport, DPR, visual scale, CSS zoom và giới hạn screen reader. `../measure-spa-motion.cjs` đo serialized on/off, tắt snapshot Playwright và chạy sequence bấm link DOM trong trang để tránh locator polling tạo thêm công việc trong animation; pointer/keyboard/hit testing kiểm tra riêng ở regression. `../analyze-spa-motion.cjs <comparison.json>` phân tích root/lifetime/từng route từ trace; chạy measurement sau khi build/browser/DB tests đã kết thúc để giảm nhiễu. RunTask count có công việc DevTools, khác PerformanceObserver; không đóng N6 từ riêng root setup hoặc counts.

Lượt 04/10 bổ sung kiểm tra hai tab dùng chung cookie với Web Locks native và logout/đổi tài khoản ở tab còn mở. Chỉ opaque revision được lưu để chặn response của phiên cũ; JWT vẫn trong bộ nhớ, refresh cookie vẫn HttpOnly. Context không hỗ trợ Web Locks/storage giữ giới hạn đã ghi trong report.

`../test-spa-asset-picker.cjs <node_modules-co-playwright>` kiểm tra pending, 503, 403 và chính sách detail hiện tại bằng fixture. Dùng `CRYPTA_PICKER_OUTPUT` cho artifact mới, `CRYPTA_TEST_BROWSER=chrome` để đổi browser, `CRYPTA_PICKER_WIDTH=390` và `CRYPTA_PICKER_THEME=dark` để review mobile. Bộ đầy đủ dùng `CRYPTA_UI_TEST_OUTPUT` và `CRYPTA_UI_TEST_FILTER` khi điều tra; lượt lọc không thay kết quả toàn suite.

Để kiểm chứng hết hạn bằng đồng hồ server thật, tạo stack riêng với `-AccessTtlSeconds 12 -KeepStack`, rồi chạy `../test-real-session-expiry.cjs <report.json> <node_modules-co-playwright> msedge` (hoặc `chrome`). Runner chỉ chấp nhận TTL 10–30 giây đã khai báo trong report và đúng container backend thực. Không dùng TTL ngắn với suite tích hợp thường vì credential của các actor sẽ hết hạn trong khi suite chạy. Có thể dùng phase riêng trên stack test đang giữ, cập nhật env/report TTL và recreate **backend test** trước khi chạy; lưu metadata phase để phân biệt kết quả 15 phút và 12 giây.

Measurement mặc định tắt cả filmstrip Chrome. Đặt `CRYPTA_MOTION_FILMSTRIP=1` nếu cần filmstrip; phải dùng cùng giá trị ở đối chứng trước/sau. `VITE_ROUTE_MOTION=off` là công tắc build; `CRYPTA_MOTION_OUTPUT` và `CRYPTA_MOTION_REPEATS=3` giữ artifact/ba vòng riêng. Không chạy đo cùng build hoặc browser/DB suite khác.

Khi chạy `test-spa-workspace.cjs`, đặt `CRYPTA_UI_TEST_MOTION=off` cho bản build tắt fade và `on` cho bản build bật. Report ghi chế độ cùng browser và bundle. Cả hai chế độ kiểm giữ bản nháp qua Back, menu và đóng tab, giữ bộ lọc khi đổi query, và giảm chuyển động khi người dùng đổi tùy chọn trong phiên.

Ngày04/10: backend logout sửa format/actor/hashsecret đạt **21/21 nhóm thật mỗi Edge/Chrome**, gồm malformed200, session actor/secret sai được giữ, own session bị thu hồi và logout lặp200. Phase TTL12s2/2 mỗi browser thuộc image trước sửa logout. Generated stack đã dọn và xác minh trigger/function0/0, không còn test container/volume/network, ID vận hành giữ nguyên; [report04/10](../../T30_PROGRESS_2026-10-04_SESSION_PICKER_PERF.md) phân biệt từng image/bundle/phase. Docker lỗi `dockerInference` đã phục hồi qua `docker desktop stop --timeout 30` rồi mở Desktop; socket tự gỡ khi dừng, không factory reset hoặc xóa dữ liệu.

Analyzer ngày04/10 bổ sung union khoảng renderer main trong650ms từ click của từng route. UpdateLayoutTree/Layout/PrePaint/Paint/Layerize được clip và merge, tránh đếm trùng Paint cha/con; FireAnimationFrame có union riêng, có thể trùng render nên không cộng. Report lưu comparison/analyzer SHA-256 và cấu hình/build/scenario; các đại lượng này không phải latency, compositor/GPU hoặc bằng chứng causal acceptance.

## Hồi quy ngày 05–06/10/2026

Workspace đầy đủ mới nhất đạt **180/180 mỗi Edge, Chrome và Firefox**, thêm NAV-28 kết hợp mười route và đổi display role lúc bốn phản hồi ADMIN đang chờ. Các lượt179 giữ lịch sử đúng harness. Firefox dùng Playwright Gecko thật; cần cài runtime Firefox tương ứng và khai báo `PLAYWRIGHT_BROWSERS_PATH` nếu đặt browser trong artifact workspace. Menu/detail/dialog/mutation hỗ trợ `CRYPTA_TEST_BROWSER=msedge|chrome|firefox`, origin mặc định `http://127.0.0.1:4173`; menu cần cả bản motion-off tại4174. Zoom native chỉ Edge/Chrome.

Từ thư mục gốc, truyền đúng thư mục `node_modules` có Playwright, không phải thư mục package Playwright:

```powershell
node tools/test-spa-menu-matrix.cjs <node_modules-co-playwright>
node tools/test-spa-detail-loading.cjs <node_modules-co-playwright>
node tools/test-spa-dialog-references.cjs <node_modules-co-playwright>
node tools/test-spa-navigation-mutations.cjs <node_modules-co-playwright>
```

| Runner | Artifact/config riêng | Phạm vi |
| --- | --- | --- |
| Menu matrix | `CRYPTA_MENU_OUTPUT`, `CRYPTA_MENU_FILTER`, `CRYPTA_UI_BASELINE_URL` | 24 nhóm/128 link mỗi browser: role × theme × 1440/390 × ON/OFF |
| Detail loading | `CRYPTA_DETAIL_OUTPUT`, `CRYPTA_DETAIL_FILTER`, `CRYPTA_DETAIL_WIDTH`, `CRYPTA_DETAIL_THEME` | 16 ca cho hai viewport; pending/retry/403/empty/short/multiline/navigation |
| Dialog references | `CRYPTA_DIALOG_OUTPUT`, `CRYPTA_DIALOG_FILTER`, `CRYPTA_DIALOG_WIDTH`, `CRYPTA_DIALOG_THEME` | 11 ca; loading/error/empty/handler guard/focus/draft |
| Navigation mutations | `CRYPTA_NAV_MUTATION_OUTPUT`, `CRYPTA_NAV_MUTATION_FILTER`, `CRYPTA_NAV_MUTATION_WIDTH`, `CRYPTA_NAV_MUTATION_THEME` | 8 ca; access và CREATE/RENEW/REVOKE từ UI/direct URL |

Đổi viewport/theme bằng các biến riêng trước khi chạy; artifact nên là thư mục mới. Lượt lọc chỉ dùng điều tra. Các bộ này dùng HTTP fixture, không ghi database vận hành và không thay E2E provider/email thật. [Báo cáo06/10](../../T30_PROGRESS_2026-10-06.md) liên kết đầy đủ kết quả cuối và các lỗi harness trước đó.

Real integration mới nhất **23/23 mỗi Edge/Chrome** trên backend image `73fdb9c…` sau migration 008, với guest direct link asset/request → login → metadata/history và F5. Stack `crypta-t30-test-84612a8a6a2d` đã qua backup 11/11 rồi dọn 0 container/volume/network; tám container ngoài test giữ full ID/name/project. Lượt stack05/10 `f653de41c7d3` và các số 18/20/21 giữ phạm vi source/image lịch sử. Cần tạo stack mới để chạy lại.

## Backup, restore và cleanup cách ly

[backup-crypta.ps1](../backup-crypta.ps1) và [restore-crypta-test.ps1](../restore-crypta-test.ps1) có `-IsolatedReport <report.json>` để chỉ dùng database/container test đã xác minh. Không có tham số này thì chúng dùng `.env` vận hành. Restore bắt buộc `.dump.json` chứa SHA-256 đúng, từ chối database nguồn và database đích đã tồn tại; khi restore lỗi, đích riêng được giữ để điều tra.

Sau khi tạo stack mới với `-KeepStack`, dừng chỉ backend test bằng Compose project/env-file đúng report, rồi chạy:

```powershell
./tools/test-backup-restore.ps1 -ReportPath <report.json>
./tools/cleanup-isolated-stack.ps1 -ReportPath <report.json>
```

Rehearsal yêu cầu backend test đã dừng và PostgreSQL còn chạy; đối chiếu tất cả bảng public và sequence, checksum/missing manifest, đích đã tồn tại và nguồn không đổi. [Bằng chứng T42](../../T42_BACKUP_RESTORE_2026-10-06.md) ghi diễn tập dữ liệu test nhỏ; chưa nghiệm thu production RPO/RTO. Cleanup helper xác minh namespace/label/volume, residue trigger/function và chỉ dọn project test trong report; ghi `cleanup-report.json` và cập nhật cờ stack report. Danh sách container ngoài project phải được lưu trước/sau, không dùng so sánh rỗng để khẳng định container vận hành lịch sử còn tồn tại.

## Liveness và readiness trên DB thật

Từ PowerShell 7, chạy với report của stack mới tạo bằng `test-isolated-stack.ps1 -KeepStack`. Harness dừng rồi khởi động lại PostgreSQL của đúng project test, kiểm ba route trước, trong và sau outage, xác nhận PID backend và đăng nhập sau phục hồi.

```powershell
./tools/test-real-health-readiness.ps1 -ReportPath <report.json>
./tools/cleanup-isolated-stack.ps1 -ReportPath <report.json>
```

Kết quả lưu cạnh report gốc tại `health-readiness.json`. Harness cũng kiểm log JSON của hai lỗi 503 theo request ID trả về và xác nhận chuỗi thử từ query/header vắng mặt trong log backend. [Bằng chứng T44](../../T44_HEALTH_READINESS_2026-11-06.md).

Chạy `./tools/test-real-operations-metrics.ps1 -ReportPath <report.json>` trên stack test đang giữ để kiểm quyền Admin, snapshot qua bảng tạm và cách metrics phục hồi sau khóa bảng. Báo cáo lưu tại `operations-metrics.json`.

Để diễn tập monitor, sinh token riêng trong `tools/test-artifacts/`, đặt SHA-256 của chuỗi hex token tại `T30_TEST_MONITOR_TOKEN_SHA256` trước khi tạo stack mới với `-KeepStack`. Chạy `node tools/test-real-operations-monitor.cjs <report.json> <file-token-test>`. Runner dừng rồi khởi động lại riêng PostgreSQL test, tạo và dọn hai fixture cần đối soát, lưu `operations-monitor.json`. Sau đó dọn stack và file token thử. Chạy `node --test tools/testing/monitor-operations.test.cjs` để kiểm CLI và fixture HTTP loopback.

## Worker, expiry và phiên bản policy trên DB thật

Backend06/10 đạt **119/119 unit test** và build. Worker kiểm tra request PROCESSING quá hạn ở mỗi poll, đưa sang đối soát; giữ receipt và không tự gọi lại provider. Migration008 chặn UPDATE/DELETE phiên bản policy đã phát hành; luồng append version mới vẫn hoạt động. Đã diễn tập nâng DB test đang giữ từ7→8 migration, checksum001–007 và ID PostgreSQL giữ nguyên.

Các harness sau yêu cầu report của stack do runner sinh, MOCK/SMTP=false, ba service chạy và binding loopback; từ chối `.env` vận hành hoặc report đã dọn. Mỗi lượt tạo database mới mang prefix riêng, xác minh rỗng trước bootstrap và dọn đúng database đó trong finally. Không gửi thư hoặc chạy provider thật. Chạy tuần tự trên stack test đang giữ:

```powershell
node tools/test-real-worker-recovery.cjs <report.json> after
node tools/test-real-policy-version.cjs <report.json> after
node tools/test-real-expiry-scan.cjs <report.json>
```

Worker **12/12**, policy **8/8**, expiry **13/13** đạt trên image backend sau sửa. Các mode `before` ghi đối chứng lỗi và có thể trả exit1; không đổi mode để che lỗi trong AFTER. Worker trước sửa2/3 và policy trước sửa6/8 còn giữ. Report có image ID, hash compiled service, source hash, inventory đầy đủ trước/sau và cờ cleanup database con. Clock có kiểm soát chỉ trong database con; hai instance dùng connection PostgreSQL thật trong một Node process. Đây không phải OS-kill, timer/scheduler hoặc delivery acceptance.

[Worker proof](../../T14_WORKER_RECOVERY_2026-10-06.md), [expiry proof](../../T27_EXPIRY_SCAN_2026-10-06.md) và [policy proof](../../T19_POLICY_VERSION_2026-10-06.md) ghi các giới hạn. Triggers không thay quyền DB tối thiểu hoặc bảo vệ trước DBA có quyền tắt trigger; legacy policy sai JSON, provider lookup/reconciliation workflow và SMTP/scheduler vẫn cần hoàn thiện. Sau các harness, chạy hồi quy browser/API rồi backup/restore trước khi dọn stack.
