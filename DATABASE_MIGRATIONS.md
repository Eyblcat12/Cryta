# Migration operator và startup runtime

API mặc định dùng `DATABASE_MIGRATION_MODE=validate`. Startup chỉ đọc `public.schema_migrations` trong transaction repeatable-read/read-only và kiểm đủ version/checksum đã biết. Nó không CREATE/ALTER, áp migration hoặc backfill checksum. Ledger thiếu, version pending/unknown và checksum NULL/sai đều chặn startup; sửa cấu hình/database qua quy trình migration trước khi khởi động lại.

`database_schema.sql` dùng để khởi tạo database mới trong một transaction. Tệp tạo schema cơ sở và từ chối đối tượng đã có. Chạy CLI migration sau đó để có đầy đủ ledger hiện hành. Dữ liệu demo nằm riêng trong `seed_data.sql`. Cài mới production dùng [CLI tạo Admin đầu tiên](RELEASE_RUNBOOK.md#khởi-tạo-admin-đầu-tiên) sau migration.

Operator chạy migration bằng **process riêng**, sau build backend:

```powershell
# Chạy trong backend; file chỉ dành cho operator, không đưa vào runtime container.
node --env-file=.env.migration dist/database/migrate.js
```

File bảo vệ `.env.migration` của operator cung cấp `DATABASE_URL` có quyền migration; tên này được Git ignore bằng `.env.*`. Không gửi URL/mật khẩu vào chat hoặc đưa file vào Git. Có thể dùng `npm run migrate` khi môi trường process đã cấp đúng URL; script có thể đọc `.env` tại backend, nên không dùng nhầm file cấu hình runtime hoặc thư mục khác. CLI không khởi động API, worker, timer hoặc email service; pool tối đa một connection và được đóng cả khi thất bại. Lỗi CLI chỉ ghi thông báo chung, không in URL hoặc lỗi driver thô.

Operator có thể cấp `DATABASE_MIGRATION_OWNER_ROLE` để CLI chạy `SET ROLE` trên cùng connection trước transaction migration. Giá trị chỉ nhận tên role chữ thường bắt đầu bằng chữ, tiếp theo là chữ/số/underscore, tối đa63 ký tự; giá trị sai bị từ chối trước khi mở pool. Role owner nên là NOLOGIN, migrator LOGIN được phép chuyển sang owner. Biến này không được API sử dụng.

Sau migration, runtime chỉ nhận URL của role runtime và `DATABASE_MIGRATION_MODE=validate`; không truyền credential migrator hoặc đặt runtime làm thành viên owner. Không sửa SQL001–008 đã phát hành. Migration checksum không phải checksum toàn schema: kiểm ledger không chứng minh mọi object/trigger/permission đều đúng, không thay schema audit hoặc kiểm nghiệp vụ.

### Migration 017 và chỉ mục tìm kiếm Audit Log

Kiểm `pg_available_extensions` để xác nhận máy PostgreSQL có `pg_trgm`. Nếu DBA đã cài extension ở schema riêng, migration dùng operator class trong schema đó. Cấp `USAGE` trên schema extension cho migration owner. Nếu chưa cài và migration owner thiếu quyền `CREATE` trên database, DBA cài trước trong schema được kiểm soát. API chạy với các quyền đọc và ghi nghiệp vụ hiện có. [Tài liệu pg_trgm của PostgreSQL 17](https://www.postgresql.org/docs/17/pgtrgm.html)

Lên lịch nâng cấp trong cửa sổ bảo trì vì `CREATE INDEX` trong transaction giữ khóa chặn ghi audit khi xây dựng chỉ mục. Migration giới hạn chờ lấy khóa chỉ mục ở 5 giây. Kiểm thời gian tạo trên bản sao dữ liệu trước khi chạy, đặc biệt với bảng lớn vì CLI đặt `statement_timeout` 30 giây. Nếu có lỗi, kiểm ledger và index sau rollback, xử lý nguồn chặn rồi thử lại theo runbook. [Quy trình nâng cấp và phục hồi](RELEASE_RUNBOOK.md)

[Compose local/demo](docker-compose.yml) khai báo `apply` với bootstrap role để khởi động bằng launcher. Chế độ này có thể chạy DDL và bổ sung checksum cho ledger cũ.

[Compose production](docker-compose.production.yml) đọc URL runtime từ `DATABASE_URL_FILE`. URL phải có tên máy, database, tài khoản và mật khẩu, với tham số duy nhất `sslmode=verify-full`. Tên máy phải khớp chứng thư PostgreSQL và chuỗi CA phải được Node tin cậy. Startup kiểm TLS, role LOGIN riêng có NOINHERIT, membership, các đặc quyền cluster, ownership của database/schema/relation/function và quyền CREATE/TEMP. Sau đó runtime kiểm ledger trong cùng transaction chỉ đọc. Đối chiếu quyền ứng dụng và các ngoại lệ cấp cột trước rollout. [TLS của node-postgres](https://node-postgres.com/features/ssl) · [T43 review](T43_DB_HARDENING_REVIEW_2026-11-05.md) · [Runbook](RELEASE_RUNBOOK.md)

Các runner worker/policy/expiry tạo database con mới dùng `applyPending()` rõ ràng trước khi gọi service. Runner [runtime-ledger](tools/test-real-runtime-ledger.cjs) kiểm compiled CLI/validator, role chỉ SELECT ledger, các lệnh ghi bị từ chối và cleanup. Role test được kích hoạt qua SET ROLE trên pool riêng; chưa chứng minh đăng nhập/password rotation hoặc toàn API bằng role hạn chế.

Runner [runtime privileges](tools/test-real-runtime-privileges.cjs) bổ sung ba role riêng và API compiled kết nối bằng LOGIN/password thực trong database test mới. Đây là bước kiểm riêng, không tự chuyển Compose local/demo sang role hạn chế. Template [runtime-grants.sql](tools/testing/runtime-grants.sql) phải được operator xem xét trước khi dùng với môi trường đã chọn:

```powershell
psql -X -v ON_ERROR_STOP=1 -v database=<database> -v runtime_role=<runtime-login-role> -f tools/testing/runtime-grants.sql
```

Template kiểm ownership của database, schema, relation và function bên cạnh membership/đặc quyền của runtime LOGIN. Nó từ chối database sai và PUBLIC grants trên bảng/cột/sequence ứng dụng hoặc CREATE database. Trong cùng transaction, nó reset quyền trực tiếp trên database, schema public, bảng/cột và sequence audit rồi cấp lại bộ quyền khai báo. Nó cũng thu hồi PUBLIC CREATE schema và TEMPORARY database. Rà các tài khoản cùng database và inventory object/extension/schema trước rollout.

PostgreSQL yêu cầu UPDATE trên ít nhất một cột để khóa dòng. Template cấp UPDATE `policies.is_active` cho luồng ngừng áp dụng và khóa policy. Quyền UPDATE `policy_versions.id` đã được thu hồi vì các caller hiện khóa bảng cha `policies`. Worker vẫn có UPDATE trên `cryptographic_keys.asset_id` để lấy `FOR SHARE`. Migration 018 chặn thay đổi giá trị cột này bằng trigger `KEY_ASSET_LINK_IMMUTABLE`, giữ liên kết metadata với tài sản đã cấp.

### Migration 018 và liên kết khóa

Operator chạy CLI migration trước rồi áp lại `runtime-grants.sql` để thu hồi quyền cột cũ. Template từ chối thay ACL khi trigger bảo vệ liên kết khóa thiếu hoặc bị tắt. Migration thêm function/trigger, không chuyển hoặc sửa các liên kết khóa hiện có. Khởi động runtime trên ledger 017 sẽ báo thiếu migration 018. Chạy trong cửa sổ bảo trì như các migration DDL khác và kiểm lại việc gia hạn/thu hồi sau nâng cấp.

Trigger áp dụng cho các lệnh UPDATE làm đổi `asset_id`, bao gồm lệnh của migration owner. Dữ liệu nhập sai cần quy trình sửa có kiểm soát với bằng chứng provider và lịch sử riêng. Việc khóa dòng của worker vẫn hoạt động, còn thuật toán/kích thước/usage tiếp tục được bảo vệ bằng ACL runtime.

API T20 dùng schema hiện có. Áp lại `runtime-grants.sql` trước khi đưa API mới vào môi trường chạy bằng runtime LOGIN. Template thêm INSERT trên `policies.code`, `policies.name` và chỉ cho cập nhật `policies.is_active`. [Kiểm chứng T20](T20_POLICY_LIFECYCLE_2026-11-06.md).

Với migration 009, chạy CLI migration trước khi áp lại `runtime-grants.sql`. API cần UPDATE các cột nội dung khi sửa nháp, mốc gửi khi submit và lý do khi hủy. Grant của PostgreSQL áp theo cột, còn giới hạn nháp, người tạo và trạng thái được kiểm tại API. Rà giới hạn quyền theo hàng trước khi nghiệm thu hardening. [Bằng chứng T09](T09_REQUEST_DRAFTS_2026-11-06.md).

Nếu validation thất bại:

1. Giữ API chưa sẵn sàng, ghi nhận mã lỗi và backup database bằng quy trình vận hành.
2. Kiểm đúng database, phiên bản ứng dụng và ledger; không tự xóa dòng lạ hoặc sửa checksum để vượt cổng.
3. Operator dùng phiên bản migration tương thích để nâng cấp hoặc phục hồi theo runbook. Legacy checksum NULL cần kiểm chứng baseline trước backfill.
4. Chạy validator lại, rồi kiểm health/nghiệp vụ. Không tự reset volume hoặc chạy bootstrap DROP/CASCADE lên dữ liệu cần giữ.

Migration `010_execution_notifications` chỉ mở rộng check constraint loại thông báo cho `REQUEST_COMPLETED` và `REQUEST_RECONCILIATION_REQUIRED`. Không sửa SQL/checksum001–009 hoặc thêm quyền DB. Chạy CLI apply trước khi chạy backend mới; runtime validate sẽ từ chối ledger thiếu010. Trước khi quay lại code cũ cần xem các loại thông báo mới và ledger; không xóa checksum hoặc sửa migration đã phát hành để ép startup. [Bằng chứng T24](T24_EMAIL_TEMPLATES_2026-11-06.md).

Migration `011_department_administration` thêm cột `departments.version` với mặc định 1 và ràng buộc giá trị dương. Chạy migration trước khi áp lại quyền runtime. Bộ quyền mới cấp INSERT cho `departments`, UPDATE cho `departments.code`, `name`, `is_active`, `version` và `users.department_id`. [Quản lý đơn vị T08](T08_DEPARTMENT_ADMINISTRATION_2026-11-06.md).

Migration `012_account_actions` thêm `account_actions`, `account_action_limits`, `users.invitation_pending` và khóa ngoại của thư mời/reset. Chạy migration trước khi áp lại quyền runtime. Các tài khoản hiện có nhận `invitation_pending=false`. Bảng cấp link giữ mã băm, thời hạn và dấu thời gian sử dụng hoặc thu hồi. Backup cần giữ cùng phiên bản ứng dụng và cấu hình khóa của môi trường. [Vận hành email](EMAIL_OPERATIONS.md).

Migration `013_provider_recovery` mở rộng nhật ký `provider_operations` bằng thông tin claim, lịch thử lại và biên nhận đã kiểm tra. Nó cũng thêm trạng thái kết thúc của operation và loại thông báo `REQUEST_FAILED`. Các dòng cũ giữ nguyên tham chiếu và được xem là chưa đủ bằng chứng để thử lại hoặc áp dụng kết quả. Chạy CLI migration rồi áp lại quyền runtime trước khi khởi động bản mới. [Đối soát T15](T15_PROVIDER_RECOVERY_2026-11-06.md).

Migration `014_asset_provider_scope` thêm liên kết phạm vi provider trên tài sản. Nó gắn `MOCK` cho mẫu seed xác định được và cho tài sản có audit hệ thống cấp hoặc gia hạn thành công ở chế độ MOCK. Các tài sản thiếu bằng chứng tiếp tục hiển thị lịch sử nhưng cần xác minh tham chiếu và tài khoản provider trước khi mở thao tác ghi. Runtime có thể ghi phạm vi khi tạo tài sản mới. Thay đổi phạm vi tài sản cũ cần quy trình đối soát vận hành riêng. Chạy CLI migration trước khi khởi động phiên bản mới. [Cấu hình provider](CAU_HINH_DICH_VU_THAT.md#provider).

Migration `015_demo_asset_provider_scope` bổ sung liên kết MOCK cho ba UUID khóa mẫu bị ghi sai ở danh sách của 014. Chỉ các dòng đúng cả ID và reference mẫu, có scope NULL mới được cập nhật. Checksum 001–014 được giữ nguyên. Các dòng asset được backfill ở 014/015 đi qua trigger cập nhật `updated_at`. Runtime LOGIN đã kiểm 015 trên PostgreSQL. [Hướng dẫn nâng cấp và phục hồi](RELEASE_RUNBOOK.md)

Migration `016_demo_certificate_provider_scope` sửa liên kết MOCK cho `CRT-FIN-ACTIVE` có UUID chính xác, loại `CERTIFICATE`, đúng reference mẫu và scope NULL. Giữ nguyên checksum 001–015. Tài sản nhập cũ chưa xác minh vẫn cần đối soát trước khi thao tác với provider.

Migration `021_auth_oidc` thêm bảng liên kết định danh, challenge, phiên và thu hồi SSO. Phiên và challenge MFA cũ giữ giá trị liên kết SSO rỗng. Chạy migration rồi áp lại `runtime-grants.sql` trước khi nâng backend, kể cả khi SSO đang tắt. Runtime chỉ đọc liên kết. Thao tác cấp hoặc thu hồi do role DB vận hành thực hiện và ghi audit. [Cấu hình và kiểm thử X03](docs/X03_OIDC.md)

Migration `022_report_exports` thêm hàng đợi và vùng lưu tạm tệp xuất báo cáo. Chạy migration rồi áp lại quyền runtime trước khi nâng backend. Tệp tải được trong một giờ, sau đó worker xóa nội dung và giữ trạng thái tác vụ trong một ngày để người dùng tra cứu. [Xuất báo cáo X04](docs/X04_REPORT_EXPORTS.md)

Migration `023_audit_anchor_source` thêm view chuẩn hóa Audit Log và hàm chụp đoạn cho checkpoint ngoài DB. Cấp riêng quyền đọc và thực thi cho tài khoản ký/xác minh bằng `deploy/audit-anchor-grants.sql`. Dữ liệu audit và quyền runtime hiện có được giữ nguyên. [Kiểm chứng Audit Log X05](docs/X05_AUDIT_ANCHOR.md)

Migration `024_asset_expiry_page_index` tạo B-tree trên `crypto_assets(expires_at, id)` cho thứ tự phân trang mặc định. Migration chạy trong transaction và giới hạn chờ khóa ở 5 giây. Lên lịch nâng cấp trong cửa sổ bảo trì vì lúc tạo chỉ mục, PostgreSQL có thể chặn ghi trên bảng. Nếu migration thất bại, kiểm tra phiên đang giữ khóa trước khi chạy lại. [Đo tải và kế hoạch truy vấn T50](T50_CAPACITY_2026-11-06.md)

Migration `025_expiry_scan_status` thêm một dòng trạng thái quét dùng chung. Áp migration rồi áp lại template quyền runtime trước khi bật ứng viên. Runtime có quyền đọc và cập nhật ba cột trạng thái. Dòng mới dùng thời điểm cài đặt làm mốc ban đầu cho đến lần quét thành công đầu tiên. [Tín hiệu T44](T44_HEALTH_READINESS_2026-11-06.md)

Migration `026_audit_correlation_index` tạo chỉ mục một phần trên `metadata->>'correlationId'`, thời gian và ID audit để phục vụ bộ lọc chính xác. Chỉ mục chứa giá trị dài đúng 40 byte, tương ứng độ dài `req_UUID`. Chạy trong cửa sổ bảo trì vì PostgreSQL có thể chặn ghi audit trong lúc xây chỉ mục. Migration giới hạn chờ lấy khóa ở 5 giây. Đo thời gian tạo trên bản sao nếu bảng lớn. Sau khi áp, kiểm `indisvalid` của `public.idx_audit_correlation_time`. [Tra cứu T22](T21_AUDIT_CORRELATION_2026-11-06.md)
