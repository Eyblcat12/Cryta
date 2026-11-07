# T30 — GET thật chờ PostgreSQL qua route/session/role,06/11/2026

Ba khoảng trống GET nghiệp vụ trì hoãn trong NAV-07/11/28 đã có bằng chứng browser→Nginx→API→PostgreSQL thật. Full integration đạt **26/26 mỗi Edge và Chrome**, gồm23 nhóm cũ và3 nhóm mới. Không sửa frontend/backend application source hoặc dữ liệu vận hành; T30 vẫn còn các tiêu chí khác.

## Phương pháp và kết quả

[Runner tích hợp](tools/test-real-integration.cjs) chỉ nhận report stack test đang giữ, namespace sinh mới, MOCK/SMTP=false, volume riêng và port loopback. [Helper mới](tools/testing/delayed-navigation.cjs) mở psql riêng với application_name ngẫu nhiên trong PostgreSQL test, giữ ACCESS EXCLUSIVE trên crypto_assets trong transaction rollback. Chỉ thao tác UI sau khi `pg_stat_activity` xác nhận query COUNT assets của API chờ relation lock, `pg_blocking_pids` chứa đúng PID holder.

| Ca | Thao tác UI trong lúc GET bị chặn | Kết quả trên cả hai browser |
| --- | --- | --- |
| NAV-11 | Từ Requests mở Assets rồi quay Requests | GET bị abort; URL/title vẫn Requests sau nhả khóa, shell/document giữ identity, không hiện asset cũ |
| NAV-07 | Đăng xuất Dev rồi đăng nhập Finance | Shell scope đổi, document giữ; sau nhả khóa thấy CRT-FIN-ACTIVE, không thấy KEY-DEV-001 |
| NAV-28 | ADMIN+USER mở Assets, đổi sang Nhân viên rồi mở tài sản cá nhân | ADMIN projection trước đó có tài sản owner khác; GET cũ bị abort, projection mới gửi ownedOnly=true và không hiện tài sản Dev/Finance |

Mỗi ca giữ **1 document request và1 script request ban đầu**, không tải thêm script, không business mutation, pageerror hoặc toast lỗi từ GET đã bỏ. Cùng route giữ shell; đổi account/role thay shell đúng scope. Các token/cookie/password chỉ ở bộ nhớ; không trace/HAR/storage-state hoặc dump body/session.

Browser abort được quan sát độc lập với truy vấn DB chờ khóa; **không tuyên bố browser đã nhận một late200 body sau abort**. Hủy holder chỉ chọn đúng PID + application_name + database + user. Session psql thoát và holder remaining0 ở từng ca; không thêm trigger/function/schema. Có safety sleep15s, statement_timeout20s và lock_timeout3s; cả sáu ca đều nhả khóa chủ động sau3,748–4,063 giây, trước safety timeout.

## Bằng chứng và provenance

- [Edge26/26](tools/test-artifacts/integration/crypta-t30-test-0dc1e30490b6/real-msedge-1793900053902/results.json), **156.0.4314.58**.
- [Chrome26/26](tools/test-artifacts/integration/crypta-t30-test-0dc1e30490b6/real-chrome-1793900169766/results.json), **157.0.8103.39**. Đây là hai Chromium browser, không gán kết quả này cho Gecko.
- [Smoke stack](tools/test-artifacts/integration/crypta-t30-test-0dc1e30490b6/report.json)17 route+13 API. Stack `crypta-t30-test-0dc1e30490b6`, origin127.0.0.1:18080, cookie Secure=false.
- Backend image `sha256:a5c6336bf00aabd5a6f72e41226d08f07d25172495a9f4912afd75292800be1e`; frontend `sha256:52ea1da20cec32b87186b8400cdd72e032ab2d711f5280d7257ab4eb94749f16`.
- [Runtime provenance](tools/test-artifacts/integration/crypta-t30-test-0dc1e30490b6/runtime-provenance.json) ghi8 migration,12 compiled hashes,3 served asset hashes và holder remaining0 sau hai full suite.
- [Snapshot204 file](tools/test-artifacts/frontend-artifacts/delayed-navigation-20261106-final/source-manifest.json), SHA-256 `a3b19f63e0179384610909d97c454bce7776ae19a664366c0f59d23f3566c907`, gồm helper mới và hai build ON/OFF. Product frontend/backend giữ hash pha [runtime LOGIN](T43_RUNTIME_LOGIN_2026-11-06.md); BE186/186 và FE131/131 là bằng chứng unit trước, không gọi là chạy lại trong lượt này.
- [Backup/restore11/11](tools/test-artifacts/integration/crypta-t30-test-0dc1e30490b6/backup-restore-cbc2664e5ca7/results.json),17 bảng và sequence khớp; [cleanup](tools/test-artifacts/integration/crypta-t30-test-0dc1e30490b6/cleanup-report.json) test container/volume/network0/0/0, trigger/function test0/0, giữ8 container ngoài test theo full ID/name/project.
- [Verifier](tools/test-artifacts/frontend-artifacts/delayed-navigation-20261106-final/evidence-verification.json) xác nhận204 source files hiện tại,6 build files/3 served hashes,12 compiled hashes,8 migration, dump/cleanup và sáu invariant waiter/blocker/abort/scope. Đây là đối chiếu bằng chứng đã lưu, không chạy lại browser hoặc nghiệm thu toàn bộ T30.

## Phạm vi còn lại

Đây là ba race Assets trên desktop1440×1000, HTTP loopback, parent API bootstrap/apply. Chưa kiểm mọi endpoint, nhiều GET đồng thời, mobile, Gecko, permission revocation giữa query hoặc runtime role hạn chế trong cùng browser matrix. Số document/script ở ba ca không thay NAV-20 network baseline riêng của Users. Provider MOCK, SMTP=false, không production TLS/deployment.

[Artifact skeleton](T30_SKELETON_PERFORMANCE_2026-11-05.md)40/40 state/geometry vẫn chưa được tích hợp; N6 paired benefit mobile OFF/refetch/raster/token, screen reader và native close còn mở. Kết quả26/26 không thay nghiệm thu đủ NAV-01…30 hoặc [54+6 task toàn dự án](TASK_STATUS_2026-11-05.md).
