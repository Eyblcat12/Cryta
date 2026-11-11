# T43 — Runtime LOGIN và cấp lại quyền, 06/11/2026

API compiled đã hoạt động bằng PostgreSQL LOGIN/password của runtime role riêng trong database kiểm thử mới, startup `validate`. Migrator LOGIN chuyển sang owner NOLOGIN bằng CLI riêng; runtime không có membership/ownership. Đây là bước tiếp theo sau [ledger SELECT-only](T43_RUNTIME_LEDGER_2026-11-05.md), chưa phải nghiệm thu T43 hoặc rollout production.

## Thay đổi

- [CLI](backend/src/database/migrate.ts) nhận tùy chọn owner role đã kiểm tên; initializer chạy trên cùng connection trước transaction/advisory lock/DDL. API không dùng biến owner role. SQL/checksum001–008 giữ nguyên.
- [Template cấp quyền](tools/testing/runtime-grants.sql) từ chối database sai, role owner/migrator hoặc runtime nguy hiểm, PUBLIC grants trên bảng/cột/sequence ứng dụng và PUBLIC CREATE database. Transaction reset direct ACL trên database, schema public,17 bảng/cột, sequence audit rồi cấp lại quyền khai báo. Table-level REVOKE riêng không đủ thu hồi column ACL nên có bước reset cột rõ ràng.
- [Host runner](tools/test-real-runtime-privileges.cjs) chỉ nhận report stack cách ly còn giữ; [container runner](tools/testing/runtime-privileges-runner.cjs) dùng password ngẫu nhiên, không SET ROLE thay cho LOGIN runtime. Khi script cấp quyền lỗi, rollback dùng cùng client; kiểm ACL trước/sau. [Runbook](DATABASE_MIGRATIONS.md) ghi phạm vi và cách chạy operator.

## Bằng chứng thực chạy

[Ma trận cuối](tools/test-artifacts/integration/crypta-t30-test-0fc05271d9c5/runtime-privileges-0ca5693b3b59/results.json) đạt **19/19 nhóm**, PostgreSQL/API thật, MOCK/SMTP=false:

| Phạm vi | Kết quả |
| --- | --- |
| Migrator/owner | CLI áp đủ8 migration; ledger thuộc owner NOLOGIN |
| Guard cấp quyền |7 cấu hình bị từ chối22023; ACL trước/sau từng trường hợp giữ nguyên |
| Runtime identity |current_user = session_user = runtime LOGIN; không membership owner/migrator |
| Cấp lại quyền |Quyền dư database/schema/table/column/sequence từ true→false;6 lệnh thật deny42501 |
| DDL/immutable/ledger |21 lệnh deny42501; UPDATE policy id bị trigger chặn23514 |
| API con |Port đang dùng bị từ chối trước spawn/gửi credential; API validate chỉ có database connection runtime |
| Auth/user |Login, refresh, logout, tạo user, đổi mật khẩu bắt buộc, status/access/scopes và thu hồi token |
| Request/worker |CREATE, RENEW có lineage, REVOKE qua HTTP và worker poll; reject/cancel |
| Transaction/concurrency |Audit INSERT lỗi rollback request+notification; append policy201/409; hai Admin disable nhau giữ một active Admin |
| Job/read |Expiry→EXPIRED, IN_APP read; email claim/SENT bằng fake transport, SMTP network0;7 read endpoints |
| Rotation |Credential cũ bị từ chối khi mở connection mới28P01; connection cũ vẫn sống; API restart bằng password mới thành công |

Backend unit **186/186** trong25 file và build đạt ở lượt05/11 trước tạm dừng: [unit JSON](tools/test-artifacts/unit/runtime-role-20261105/full.json), [build log](tools/test-artifacts/unit/runtime-role-20261105/build.log). Có12 test owner-name và18 test migration service; kết quả full bao gồm cả hai. Sau resume chỉ thay template/harness/tài liệu, backend application/test source giữ byte hash của [snapshot18 nhóm](tools/test-artifacts/frontend-artifacts/runtime-login-20261105-18groups/source-manifest.json).

Stack mới `crypta-t30-test-0fc05271d9c5` có [smoke17 route+13 API](tools/test-artifacts/integration/crypta-t30-test-0fc05271d9c5/report.json). Backend image `sha256:df0f67f80f2a049a231781d757e5d7b199eb9cefe586fe6fac91372697a809b7`; frontend image `sha256:27c02c7ce580b4a0f3eb15b2f1f764cd6fa15e5ceb49765578c5ce03ac831fe0`. Report có8 source hashes và11 compiled hashes; database/ba role con đã xóa, remaining0, tám container ngoài test giữ danh tính. Log API không chứa credential đã quét và không có permission denial ngoài các probe SQL chủ động.

[Snapshot203 file](tools/test-artifacts/frontend-artifacts/runtime-login-20261106-final/source-manifest.json), SHA-256 `dafe558ffd6a73e5e5abef15d4e1d2cbc1a3ba683273a3329fa0269bab44a90c`, giữ source và hai build frontend. [Runtime provenance](tools/test-artifacts/integration/crypta-t30-test-0fc05271d9c5/runtime-provenance.json) ghi8 migration và3 served asset hashes. Frontend sản phẩm không đổi; không chạy lại browser matrix trong lượt này.

[Backup/restore cuối](tools/test-artifacts/integration/crypta-t30-test-0fc05271d9c5/backup-restore-144c8e1810b9/results.json) **11/11**,17 bảng và sequence khớp. [Cleanup](tools/test-artifacts/integration/crypta-t30-test-0fc05271d9c5/cleanup-report.json) container/volume/network test0/0/0, trigger/function test0/0, giữ8 danh tính ngoài test. [Verifier](tools/test-artifacts/frontend-artifacts/runtime-login-20261106-final/evidence-verification.json) khớp203 source files,6 build files/3 served hashes,8 source hashes/11 compiled hashes của ma trận,8 migrations, dump và cleanup; kiểm rõ guard/reset/identity/rotation thay vì chỉ tin cờ success. Đây là kiểm tính nhất quán bằng chứng đã lưu, không phải chạy lại test hoặc nghiệm thu release.

Lượt đầu sau resume [b16f62822500](tools/test-artifacts/integration/crypta-t30-test-0fc05271d9c5/runtime-privileges-b16f62822500/results.json) dừng sau2 nhóm vì kiểm placeholder nhận nhầm cast `::"char"`; DB/role đã cleanup. Không tính nó là19/19. Các lượt15/17/18 nhóm trước tạm dừng giữ source/ảnh riêng; template lúc đó chưa reset quyền dư.

## Giới hạn và phần còn lại

Parent Compose/Nginx vẫn dùng bootstrap credential và mode apply local/demo; chỉ API con port3309 bên trong container sử dụng runtime LOGIN. Backup của parent không phải diễn tập restore ownership/grants của ba role con. Chưa có rollout trên môi trường được chọn, secret store, TLS, máy khác hoặc credential trong orchestrator.

Ba ngoại lệ UPDATE phục vụ row lock vẫn là quyền thật: `policies.updated_at`, `policy_versions.id`, `cryptographic_keys.asset_id`. Trigger bảo vệ published policy nhưng không chặn runtime đổi `cryptographic_keys.asset_id`; cần thu hẹp thiết kế hoặc chấp thuận rủi ro trước nghiệm thu least privilege đầy đủ. Template không audit toàn cluster/object ngoài danh mục, không là RLS hoặc bảo vệ DBA. SMTP chỉ fake transport, provider MOCK; positive paths không thay toàn bộ failure matrix, UAT hoặc12 UC end-to-end.

T43 và [toàn bộ54+6 task](TASK_STATUS_2026-11-05.md) còn mở. Provider/SMTP/deployment thật chưa được chọn theo [thông tin đã xác nhận](CAU_HINH_DICH_VU_THAT.md).
