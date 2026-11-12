# T43 — Rà quyền runtime/migration, 05/11/2026

Cập nhật06/11: [runtime LOGIN19/19](T43_RUNTIME_LOGIN_2026-11-06.md) đã kiểm API/grants/rotation trong database cách ly; các mô tả chưa provision bên dưới là baseline trước implementation. Rollout và ngoại lệ UPDATE khóa dòng vẫn còn mở.

**Baseline trước implementation.** Nhánh startup và CLI đã được thay đổi/kiểm chứng sau lượt rà này: [runtime ledger](T43_RUNTIME_LEDGER_2026-11-05.md). Các mô tả một pool startup luôn DDL bên dưới giữ phạm vi source trước sửa; role nghiệp vụ hoàn chỉnh vẫn còn phải làm. CI hiện đã có report JSON/upload khi thất bại; mô tả CI trước thay đổi ở cuối là lịch sử.

Đây là đối chiếu source và đề xuất triển khai local, **chưa phải kiểm thử quyền DB hoặc nghiệm thu T43**. Không chạy Docker, build, unit hoặc thay quyền database trong lượt rà này. Không đọc `.env` hay in credential. [Tiêu chí T43](KE_HOACH_HOAN_THIEN_DU_AN.md) vẫn yêu cầu ứng dụng hoạt động bằng tài khoản runtime hạn chế, các lệnh cấm bị DB từ chối thật và có kịch bản rotate secret.

## Kết luận từ mã hiện tại

- [Compose vận hành](docker-compose.yml) truyền `DATABASE_URL` của chính `POSTGRES_USER` khởi tạo PostgreSQL vào backend. [Compose test](tools/testing/compose.t30.yml) có cấu trúc tương tự, dùng `crypta_t30_test`. Chưa có runtime role, owner role hoặc migrator riêng trong hai file. Đây là kết luận cấu hình source; chưa query `pg_roles` của container thực để xác nhận attribute/owner đang tồn tại.
- [DatabaseModule](backend/src/database/database.module.ts) tạo đúng một pool từ `DATABASE_URL`; [MigrationService](backend/src/database/migration.service.ts) dùng cùng pool trong `onModuleInit`. Ngay cả khi đủ tám migration, startup vẫn `CREATE TABLE IF NOT EXISTS schema_migrations` và `ALTER TABLE ... ADD COLUMN IF NOT EXISTS checksum`. Chỉ thay URL sang role ít quyền sẽ làm startup thất bại; không thể gọi đây là tách tài khoản hoàn chỉnh.
- [Bootstrap](database_schema.sql) được ghi rõ local/demo, có DROP/CASCADE, tạo extension, bảng, function và trigger; [seed](seed_data.sql) được mount vào init của cả hai Compose. Không dùng lại bootstrap này để nâng cấp DB có dữ liệu. Migration 001–008 cần giữ nguyên byte/checksum đã công bố; thay đổi hardening phải additive hoặc là công cụ provision riêng.
- Trigger `trg_audit_log_immutable`, `trg_request_decision_immutable` và `trg_policy_versions_immutable` chặn UPDATE/DELETE từng row. Chúng không tạo quyền phân tách role, không chặn TRUNCATE và không bảo vệ trước chủ sở hữu/superuser có thể thay trigger. Quyền thay/hủy object thuộc owner; tước DML khỏi một owner không loại quyền đó. [PostgreSQL 17 privileges](https://www.postgresql.org/docs/17/ddl-priv.html).
- [Backend Dockerfile](backend/Dockerfile) đã dùng OS user `node` ở runtime. Đây là quyền hệ điều hành của container, không chứng minh PostgreSQL user hạn chế. `.env`/backup/artifact đã có [ignore](.gitignore), [startup](start-crypta.ps1) tạo secret DB/JWT ngẫu nhiên khi chưa có `.env`; chưa có bằng chứng scan image/bundle hoặc rotation trong lượt này.

## Điểm dễ làm hỏng ứng dụng khi cấp quyền

[RequestsService.create](backend/src/requests/requests.service.ts) chọn `policy_versions pv JOIN policies p ... FOR SHARE` không chỉ rõ `OF`. [PoliciesController.version](backend/src/policies/policies.controller.ts) khóa `policies ... FOR UPDATE`. PostgreSQL yêu cầu UPDATE trên ít nhất một cột của mỗi bảng được row-lock, kể cả FOR SHARE; chỉ SELECT/INSERT trên policy version sẽ chưa đủ cho câu SQL create hiện hành. Đây là yêu cầu của [SELECT PostgreSQL 17](https://www.postgresql.org/docs/17/sql-select.html), không phải bằng chứng runtime đã được thử.

Không giải quyết bằng `GRANT ALL` hoặc cho backend kế thừa owner. Hai cách cần cân nhắc trước implementation:

1. **Giữ SQL hiện hành:** cấp UPDATE một cột hẹp để row-lock. Trên `policy_versions`, trigger vẫn phải chặn mọi UPDATE thực tế; permission đã cấp chỉ nhằm row lock và kết quả deny sẽ là trigger, không còn privilege deny trên cột đó. Đây là giới hạn phải ghi rõ, không gọi là SELECT/INSERT-only.
2. **Hạn chế quyền chặt hơn:** giữ `policy_versions` append-only ở lớp privilege, chuyển khóa policy sang helper SQL cố định do owner sở hữu hoặc cơ chế khóa được cả publish/create tuân thủ. Nếu dùng helper SECURITY DEFINER, chỉ khóa/đọc đúng object được định danh schema, cố định search_path tin cậy, không nhận SQL động, REVOKE EXECUTE FROM PUBLIC rồi GRANT đúng runtime. Phải test tương tranh để giữ publish/create contract. Việc đổi `FOR SHARE` thành `FOR SHARE OF p` giảm bảng cần UPDATE, nhưng vẫn còn privilege cho khóa `policies`; không tự coi đó là hoàn tất.

Ngoài ra [EmailWorker.claim](backend/src/notifications/email-worker.service.ts) JOIN `notifications` và `users` rồi FOR UPDATE không có OF; runtime hiện cần UPDATE users cho login/status nên không tạo thêm grant, nhưng test nhiều worker phải giữ hành vi và thứ tự khóa. Worker guard đang hoàn thiện ngày 05/11 đã tách target query: khóa `crypto_assets FOR UPDATE`, sau đó `cryptographic_keys ... FOR SHARE`. Vì vậy chính subtype KEY nay cũng cần quyền UPDATE ít nhất một cột để row-lock, dù product không UPDATE metadata subtype. Ma trận strict SELECT/INSERT-only bên dưới là đích đề xuất và **chưa tương thích câu SQL mới này** nếu chưa có phương án lock helper hoặc ngoại lệ UPDATE cột hẹp được kiểm chứng. Không tự mở rộng thành UPDATE toàn bảng để làm xanh test.

## Mô hình role đề xuất cho stack test mới

Tên dưới là vai trò dự kiến, chưa được tạo:

| Role | Trách nhiệm | Giới hạn |
| --- | --- | --- |
| Bootstrap/admin PostgreSQL | Tạo database/role, cài extension, provision owner/schema và chuyển ownership có kiểm soát | Credential chỉ ở bước setup/khôi phục; không truyền cho backend |
| `crypta_owner` NOLOGIN | Sở hữu schema, bảng, sequence, function và trigger | Không phải role runtime kế thừa hoặc được SET ROLE tới |
| `crypta_migrator` LOGIN | Được SET ROLE owner trong command migration riêng | Không superuser/CREATEDB/CREATEROLE/BYPASSRLS; chỉ dùng lúc nâng cấp, kết nối đóng sau command |
| `crypta_runtime` LOGIN | API, worker, scan, health và ledger check chỉ đọc | Không owner hoặc thành viên owner/migrator, không quyền tạo schema/table/function, TRIGGER, TRUNCATE hay GRANT OPTION |

Trong database mới, thu hồi quyền database/schema không cần thiết từ PUBLIC rồi cấp CONNECT, schema USAGE cho đúng role. Nếu cấm TEMP, phải thu hồi TEMPORARY từ PUBLIC trong chính database test; việc chỉ REVOKE từ runtime không loại quyền được thừa hưởng từ PUBLIC. Không sửa cluster/DB khác. Ownership khi upgrade phải inventory từng object, không dùng REASSIGN OWNED trên role bootstrap một cách rộng ở hệ thống có nhiều database. Database role/default privileges cần kiểm thực tế thay vì suy từ phiên bản PostgreSQL.

## Ma trận DML theo source hiện có

Đây là **điểm bắt đầu cấp quyền**, không phải GRANT đã chạy. Các ô không ghi nghĩa là chưa có nhu cầu từ source đã rà. Ngoại lệ row-lock policy ở trên phải được giải quyết trước khi dùng ma trận strict.

| Object public | Runtime cần | Cấm / lưu ý |
| --- | --- | --- |
| `departments`, `roles` | SELECT | Chưa có route CRUD tương ứng; không cấp INSERT/UPDATE/DELETE dự phòng |
| `policies` | SELECT; khóa publish/create phải giải quyết riêng | Không cấp DELETE/TRUNCATE/DDL; không tự cấp UPDATE toàn bảng |
| `policy_versions` | SELECT, INSERT | Không UPDATE/DELETE/TRUNCATE; immutable trigger là lớp bổ sung. SQL FOR SHARE hiện tại cần refactor hoặc ngoại lệ được mô tả rõ |
| `users` | SELECT, INSERT; UPDATE các cột login/password/status/token đang được service ghi | Không DELETE; không cấp quyền DDL. Hash password phải đọc ở runtime để verify, không đưa vào report |
| `auth_sessions` | SELECT, INSERT, UPDATE | Không DELETE/TRUNCATE; hiện service thu hồi bằng revoked_at, chưa có retention job xóa |
| `user_roles`, `approver_scopes` | SELECT, INSERT, DELETE | DELETE cần cho replaceAccess; không cấp UPDATE/DDL/GRANT OPTION chỉ vì role quản trị ứng dụng |
| `crypto_assets` | SELECT, INSERT, UPDATE những cột worker/expiry thực ghi | Không DELETE/TRUNCATE; cần row lock asset trong lifecycle |
| `cryptographic_keys`, `certificates` | SELECT, INSERT cho DML; KEY row-lock ngày 05/11 phải giải quyết riêng | Chưa có service UPDATE/DELETE subtype. `cryptographic_keys FOR SHARE` vẫn cần UPDATE privilege; không gọi ma trận strict này là đã chạy được với worker mới |
| `requests` | SELECT, INSERT, UPDATE những cột lifecycle thực ghi | Không DELETE/TRUNCATE; row lock và conditional update vẫn cần |
| `request_decisions` | SELECT, INSERT | Không UPDATE/DELETE/TRUNCATE; trigger bất biến giữ nguyên |
| `provider_operations` | SELECT, INSERT, UPDATE | Không DELETE/TRUNCATE; ledger cần giữ receipt/attempt |
| `audit_logs` | SELECT, INSERT | Không UPDATE/DELETE/TRUNCATE; không ALTER/DROP/disable trigger |
| `audit_logs_id_seq` | USAGE | BIGSERIAL cần nextval; không cấp UPDATE/setval. Các UUID khác dùng gen_random_uuid, không cần tự cấp ALL SEQUENCES |
| `notifications` | SELECT, INSERT, UPDATE những cột read/delivery/attempt/schedule thực ghi | Không DELETE/TRUNCATE; test IN_APP + EMAIL queue local không thay SMTP delivery |
| `schema_migrations` | SELECT cho runtime checker | Không INSERT/UPDATE/DELETE/DDL; migrator mới được viết ledger |

Danh sách UPDATE cột cụ thể nên tạo từ SQL source rồi đóng băng trong provision script. Ví dụ users hiện ghi `password_hash, must_change_password, token_version, failed_login_attempts, locked_until, last_login_at, status`; không tự cấp đổi `department_id` khi chưa có workflow chuyển đơn vị. Trigger tự gán updated_at không đồng nghĩa application phải được UPDATE trực tiếp mọi cột. Mỗi feature thêm mutation phải có migration/grant/test rõ.

Đừng dùng `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO runtime`. Default privileges phụ thuộc role tạo object, áp cho object tương lai và không chữa object đã có; grant mỗi migration mới theo nhu cầu. Nên tước EXECUTE mặc định của PUBLIC cho function do owner tạo rồi grant function cần thiết được rà. [ALTER DEFAULT PRIVILEGES PostgreSQL 17](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

## Lát cắt implementation khả thi không cần provider/SMTP thật

1. Tách definitions/checksum migration khỏi startup runner. Thêm command migration duy nhất có pool riêng do operator truyền URL an toàn; runtime không được nhận hoặc fallback sang URL migrator. Giữ SQL 001–008 nguyên vẹn.
2. Runtime startup mặc định chỉ kiểm ledger bằng SELECT và so đủ version/checksum; missing/unknown/mismatch phải fail với mã lỗi an toàn. Không tự CREATE/ALTER/backfill checksum trong nhánh runtime. Legacy checksum NULL phải được migrator xử lý trước, không bỏ qua trong runtime.
3. Thêm provision SQL/công cụ chỉ nhận namespace test/role do harness cấp phát, ownership và grants rõ như trên; resolve policy row-lock trước khi kỳ vọng strict grant. Không đổi `.env` vận hành hoặc volume cũ trong bước này.
4. Tạo stack/database test mới, provision role tách biệt, apply migration bằng migrator, bỏ URL migrator khỏi backend runtime env. Backend chạy runtime, cùng image chứa worker guard đã kiểm thử ở lát cắt riêng. Report phải ghi role attributes/owner/grants và hashes, không ghi URL/password.
5. Chạy đủ test quyền thực bên dưới rồi browser/API/worker/policy/expiry hồi quy; dùng backup/restore/cleanup helpers đã kiểm namespace. Chỉ sau đó mới đề xuất rollout cấu hình trên DB có dữ liệu với backup và runbook ownership upgrade.

Đây là đề xuất thay đổi kỹ thuật trong scope T43/T04, không cần chọn provider/SMTP trước. Chuyển DB vận hành sang role khác cần kiểm rollout, không thực hiện tự động trong lượt rà.

## Ma trận kiểm chứng phải chạy với role thật

| Nhóm | Bằng chứng cần có |
| --- | --- |
| Identity | `current_user`, attributes NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS; runtime không own DB/schema/object và không có membership/SET ROLE lên owner/migrator |
| Migration | Migrator áp pending migration và giữ checksum; runtime startup/checker chỉ SELECT. Runtime với pending/unknown/mismatch/NULL ledger fail, không DDL/ledger mutation; unit không đủ chứng minh privilege |
| DDL denial | Runtime CREATE schema/table/function, ALTER/DROP table/trigger/function, disable trigger, SET ROLE owner và đổi `session_replication_role` bị từ chối. Cần actual statement + SQLSTATE, không chỉ `has_*_privilege` |
| Immutable denial | Runtime UPDATE/DELETE/TRUNCATE audit/decision/policy version bị từ chối, kể cả zero-row/multirow attempts; kiểm row count/hash trước/sau. Nếu row-lock ngoại lệ dùng trigger, phân biệt SQLSTATE 23514/trigger error với 42501 privilege deny |
| Ledger/sequence denial | INSERT/UPDATE/DELETE/TRUNCATE schema_migrations và setval audit sequence bị từ chối; INSERT audit với default ID thành công và không trùng |
| Positive app paths | Login/refresh/logout/password change; create user/status/access/last-admin concurrency; create/approve/reject/cancel; policy publish/stale/concurrent; CREATE/RENEW/REVOKE worker + expiry warning/expire + IN_APP read; audit/filter/history, queue local đều chạy được qua compiled services/API |
| Rollback/race | Lỗi audit/notification rollback nghiệp vụ; migration đồng thời; hai worker claim/sweep; policy publish/create race giữ snapshot và không deadlock từ cơ chế khóa mới |
| Secrets/rotation | Scan allowlisted source/build/image/config metadata bằng sentinel test credential; không log secret. Đổi runtime password trên DB test + recreate runtime pool, URL cũ không mở connection mới; kết nối cũ không được giả định tự bị thu hồi. Revoke/terminate phiên cũ phải có runbook explicit |
| Preservation | Harness chỉ ghi test DB/role có prefix cấp phát, inventory ID/name/project ngoài namespace trước/sau có subjects, cleanup role/DB/resource test; không dùng so sánh tập rỗng làm chứng cứ |

Role runtime vẫn có quyền ghi nhiều bảng để phục vụ API quản trị/nghiệp vụ; credential DB bị chiếm có thể vượt object-scope checks trong application. Tách owner/runtime giảm DDL/immutable-data risk, không tự tạo per-user RLS hoặc thay toàn ma trận phân quyền T39. Không tuyên bố chống DBA/superuser.

## Điểm nối unit/CI đang có

- [migration-service.spec.ts](backend/test/migration-service.spec.ts) hiện pin checksum 001–007 và 008/unknown/mismatch/transaction behavior; cần thêm nhánh runtime read-only và CLI mode, giữ các test cũ meaningful.
- [database-pool.spec.ts](backend/test/database-pool.spec.ts) kiểm pool error log an toàn; cần tách lifecycle pool migrator/runtime mà không để pool/secret leak.
- [compose.t30.yml](tools/testing/compose.t30.yml), [database-context.ps1](tools/testing/database-context.ps1) và [hướng dẫn test](tools/testing/README.md) là nền harness cách ly hiện hành. Test quyền mới phải fail khi chạy nhầm source/operational DB và không tự sửa quyền production.
- [CI hiện tại](.github/workflows/ci.yml) đã được sửa trong lượt 05/11 để chạy npm ci/build/**npm test** cho cả backend và frontend; baseline trước lượt này chỉ gọi unit backend. Frontend unit local mới đạt [131/131](tools/test-artifacts/unit/resume-20261105-frontend/results.json). Workflow vẫn chưa có DB integration/browser E2E hoặc upload proof thất bại. Chưa có bằng chứng remote CI đã chạy thay đổi này hoặc required checks chặn release; T45 vẫn mở.

T43 vẫn cần môi trường triển khai để chốt TLS/origin/cookie, secret store, rotation operator và provider/email exposure. Phần role/migration/proof local ở trên có thể triển khai ngay theo thứ tự phụ thuộc; chưa chuyển trạng thái task thành đã nghiệm thu từ tài liệu rà này.
