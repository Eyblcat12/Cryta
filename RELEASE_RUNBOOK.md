# Đóng gói, nâng cấp và phục hồi Crypta

## Chọn bản phát hành

Đối chiếu điều kiện R1 và quyết định pilot trước khi chọn bản phát hành. [Cổng nghiệm thu T54](docs/CONG_NGHIEM_THU_RELEASE.md)

Chọn commit đã qua CI và nghiệm thu, cùng một phiên bản duy nhất cho backend và frontend. Mốc nâng cấp đang kiểm là `105d104c41b0804410b12782434b89d522c341d6`, có migration 001–003. Phiên bản làm việc tiếp theo được đề xuất là `0.2.0-rc.1`. Ghi phiên bản chính thức và commit đã duyệt trong changelog khi phát hành.

Từ thư mục dự án, build hai image từ đúng cây Git của commit đã chọn. Script dùng `git archive --mtime` với thời điểm commit để context có cùng SHA-256 qua các lượt chạy. Cần phiên bản Git hỗ trợ tham số này. Script ghi nhãn OCI version/revision, image ID, platform và SHA-256 của context cùng mẫu cấu hình vào manifest. Nó từ chối tag local đã tồn tại.

```powershell
node tools/build-release-images.cjs <full-commit-sha> <release-version>
```

Sau khi kiểm tích hợp đạt, GitHub Actions tạo và kiểm archive trên commit của lượt chạy với phiên bản tạm `0.0.0-ci.<run-id>.<attempt>`. Artifact `release-build-manifest` lưu SHA commit, nhãn, ID của hai image, hash của context và checksum archive. Archive của lượt CI nằm trên runner tạm. Khi bàn giao, lưu image với phiên bản đã duyệt theo quy trình dưới đây. [Workflow](.github/workflows/ci.yml)

Đối chiếu thêm artifact `release-image-security` của cùng lượt CI. Có thể chạy lại cổng Critical/High trên hai image local sau khi build. Backend dùng CLI Node đã biên dịch trong image runtime. Các lệnh npm để phát triển vẫn chạy từ mã nguồn hoặc trong giai đoạn build. [Phạm vi kiểm](tools/ci/README.md)

```powershell
node tools/ci/scan-release-images.cjs tools/test-artifacts/releases/<version>-<short-sha>/manifest.json
```

Giữ manifest, `.env.example` và changelog cùng bản phát hành. Thêm `--archive` để đóng gói hai image thành `images.tar` và ghi kích thước, SHA-256 vào manifest. Chuyển archive và manifest đã duyệt cùng nhau. Nếu dùng registry, ghi lại digest được registry trả và dùng digest đó khi triển khai. Dùng đúng image đã lưu để cài lại cùng bản build. Cất cấu hình thực và thông tin bí mật trong hệ thống quản lý cấu hình của môi trường.

Hai Dockerfile ghim digest của manifest OCI đa kiến trúc cho Node.js 22.23.4 và Nginx 1.30.6 trên Alpine. Khi cập nhật bản vá, xác minh tag chính thức và thay cả tag lẫn digest trong cùng thay đổi. Build lại rồi chạy smoke, kiểm phiên HTTPS và kiểm proxy phục hồi khi backend đổi IP. [Node.js 22.23.4](https://nodejs.org/en/blog/release/v22.23.4) · [Bản vá Nginx](https://nginx.org/en/security_advisories.html)

```powershell
node tools/build-release-images.cjs <full-commit-sha> <release-version> --archive
```

Trên máy nhận, dùng Node.js và `tar`. Đặt `$packageDirectory` thành thư mục có `manifest.json` và `images.tar` từ kênh bàn giao đã duyệt. Lệnh đầu kiểm checksum, tag, kiến trúc, nhãn và danh mục OCI nếu có. Lệnh thứ hai kiểm lại rồi nạp hai image vào Docker. Script từ chối tag đã tồn tại và đối chiếu danh tính image sau khi nạp. [Script nạp image](tools/load-release-images.cjs)

```powershell
node tools/load-release-images.cjs $packageDirectory
node tools/load-release-images.cjs $packageDirectory --load
```

Diễn tập 08/11/2026 dùng phiên bản cục bộ `0.0.0-rehearsal.20261108.1` của commit `fd45771`. Bản sao archive bị đổi một byte bị chặn bởi kiểm hash. Bản hợp lệ nạp lại hai tag đã gỡ, khôi phục đúng image ID và nhãn trong 9,4 giây. Stack PostgreSQL/Nginx dùng đúng hai image đã nạp, chạy smoke trong 20,37 giây với `--no-build --pull never`, rồi được dọn. Lượt này dùng Docker trên cùng máy, dữ liệu giả, provider MOCK và SMTP tắt. [Manifest](tools/test-artifacts/releases/0.0.0-rehearsal.20261108.1-fd4577145db8/manifest.json) · [Báo cáo nạp lại](tools/test-artifacts/releases/0.0.0-rehearsal.20261108.1-fd4577145db8/archive-rehearsal.json)

Ngày 09/11, script mới đạt 7/7 ca với gói `11163cd` trên Docker Desktop `linux/amd64`. Script chặn archive sai checksum, tag lạ trong từng danh mục Docker và OCI dù checksum khớp, cùng tag local đã tồn tại. Nạp đúng hai image trong 13,39 giây. Stack cách ly dùng đúng hai image, qua smoke trong 19,88 giây với `--no-build --pull never` và được dọn. [Báo cáo nạp và smoke](tools/test-artifacts/releases/0.0.0-rehearsal.20261109.scan-after-11163cd86497/archive-loader-rehearsal.json)

Frontend đóng gói mặc định dùng `VITE_ROUTE_MOTION=off`. Thay đổi riêng hiệu ứng chuyển trang chỉ cần đổi image frontend tương thích với API hiện tại. Giữ digest frontend trước khi thử image khác, rồi chạy smoke URL sâu và điều hướng sau khi chuyển image. [Điều hướng và kết quả đo](IMPLEMENTATION_TRACKER.md)

## Cấu hình Docker production

1. Điền [mẫu cấu hình](deploy/production.env.example) vào tệp riêng của máy đích. Dùng hai image theo digest đã duyệt. Chọn một `APP_ORIGIN` HTTPS chính xác, dạng scheme và tên máy kèm cổng nếu có, bỏ dấu gạch chéo cuối. Proxy TLS trên máy đích chuyển cả SPA và `/api/` đến `127.0.0.1:18080` hoặc cổng `CRYPTA_PROXY_PORT` đã chọn. Backend nằm trong mạng nội bộ Compose. Kiểm login và cookie qua HTTPS trước khi mở lưu lượng.
2. Cấp PostgreSQL riêng và tài khoản runtime theo [quy trình migration](DATABASE_MIGRATIONS.md). Xác nhận đích là database mới và rỗng trước khi nạp `database_schema.sql`. Schema cài mới tạo đối tượng trong một transaction và từ chối đối tượng đã tồn tại. Tiếp đó, operator chạy CLI migration từ image mới bằng credential migration, cấp quyền runtime và khởi tạo Admin theo phần dưới. Với database hiện hữu, bắt đầu từ phần nâng cấp. Compose production khởi động hai dịch vụ ứng dụng.
3. Cấp năm tệp bí mật theo đường dẫn tuyệt đối trong mẫu. Mỗi tệp chứa một giá trị trên một dòng. Materialize tệp từ kho bí mật, dùng ACL của máy đích và kiểm người dùng `node` trong container đọc được chúng. Tạo JWT từ ít nhất 32 byte ngẫu nhiên mã hóa base64url và khóa account actions riêng từ 32 byte ngẫu nhiên mã hóa hex. Bản production yêu cầu provider HTTPS, SMTP có xác thực qua TLS và bật luồng mời/reset. [Cấu hình dịch vụ](CAU_HINH_DICH_VU_THAT.md)
4. Chạy lệnh sau với đường dẫn đến tệp cấu hình của máy đích. Kiểm `ps` và readiness, rồi tiếp tục smoke qua proxy.

```powershell
$taskConfigPath = 'deploy/.env.production'
$taskComposeFiles = @('-f', 'docker-compose.production.yml')
docker compose --env-file $taskConfigPath @taskComposeFiles config --quiet
docker compose --env-file $taskConfigPath @taskComposeFiles up -d --wait
docker compose --env-file $taskConfigPath @taskComposeFiles ps
```

Nếu PostgreSQL, provider, SMTP hoặc OIDC dùng CA nội bộ, đặt `CRYPTA_PRIVATE_CA_BUNDLE_FILE` thành đường dẫn tuyệt đối tới tệp PEM chỉ chứa chứng thư CA công khai đã được phê duyệt. Thêm `$taskComposeFiles += @('-f', 'deploy/compose.private-ca.yml')` sau khi khai báo mảng ở trên và trước các lệnh Compose. Tệp được mount chỉ đọc vào backend, và Node thêm CA đó vào bộ tin cậy hiện có. Cấp quyền đọc tệp cho người dùng `node`. Tiếp tục dùng hostname khớp chứng thư của từng dịch vụ. [Cấu hình CA nội bộ](deploy/compose.private-ca.yml)

Khi xoay bí mật hoặc đổi CA trong cửa sổ bảo trì, cập nhật tệp và tạo lại backend bằng `docker compose --env-file $taskConfigPath @taskComposeFiles up -d --no-deps --force-recreate --wait backend`. Nginx tra lại tên `backend` qua DNS nội bộ Docker khi địa chỉ thay đổi. Chạy lại smoke qua HTTPS sau khi backend báo healthy.

Nginx trong image frontend ghi `nginx.access` dạng JSON. Dùng `correlationId` để tra log API và audit. Khi backend chưa trả mã, dùng `proxyRequestId`, thời điểm và trạng thái upstream để khoanh vùng sự cố. Kiểm cấu hình log của ingress TLS và hệ thống thu thập riêng trên máy đích. Lưu `audit.http_failure_not_persisted` ở đích độc lập với PostgreSQL và thử khả năng truy xuất trong diễn tập mất DB. [Bằng chứng T21](T21_AUDIT_CORRELATION_2026-11-06.md)

Chạy smoke từ máy operator qua điểm vào HTTPS mà người dùng sẽ truy cập. Thay URL ví dụ bằng `APP_ORIGIN` của môi trường. Nếu proxy dùng CA nội bộ, cấp CA công khai đã xác minh qua `NODE_EXTRA_CA_CERTS` trước khi chạy Node. Smoke chỉ đọc, dùng URL cố định không chứa thông tin đăng nhập và trả mã thoát khác 0 khi có lỗi.

```powershell
node tools/smoke-deployment.cjs https://crypta.example.org
```

Smoke kiểm liveness, readiness của PostgreSQL, trang SPA qua URL sâu, chính sách referrer của hai luồng tài khoản, MIME của JS/CSS và HTTP 404 cho chunk mất và API lạ. Đối chiếu image/digest với manifest riêng trước khi mở lưu lượng.

Ngày 09/11, diễn tập Compose production với hai image từ `3b872fa` dùng CA riêng sinh cho stack cách ly. PostgreSQL từ chối kết nối khi thiếu CA hoặc hostname sai. Sau khi mount CA chỉ đọc, runtime LOGIN kết nối PostgreSQL qua TLS, 10 probe HTTPS đạt và cookie Secure/HttpOnly xoay qua refresh. Relay SMTP thử xác thực qua TLS và nhận thư. Một yêu cầu cấp khóa đi qua provider HTTPS thử đúng một lần, rồi chuyển sang hoàn tất. Đã dọn container, network, volume và tệp bí mật của lượt thử. [Báo cáo diễn tập](tools/test-artifacts/crypta-ca-test-e51ae369d971/report.json)

## Khởi tạo Admin đầu tiên

Giữ API chưa chạy trong bước cấp tài khoản đầu tiên. Điền [mẫu operator](deploy/bootstrap-admin.env.example) vào tệp được bảo vệ và ghi nhận người duyệt. `BOOTSTRAP_DATABASE_NAME` phải trùng tên database đích. `DATABASE_URL_FILE` chứa URL của migrator/owner với tham số duy nhất `sslmode=verify-full`. Nếu dùng migrator LOGIN tách biệt, đặt `DATABASE_MIGRATION_OWNER_ROLE` thành owner NOLOGIN đã cấp quyền chuyển role.

Cấp mật khẩu tạm qua `BOOTSTRAP_ADMIN_PASSWORD_FILE`. CLI áp cùng quy tắc mật khẩu mới của ứng dụng, từ 12 đến 64 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt, tối đa 72 byte UTF-8 cho bcrypt. Các tệp bí mật chứa một dòng và nằm trong kho bí mật của môi trường. Chạy CLI compiled bằng đúng Node/image ứng viên. Ví dụ khi backend compiled có trên máy operator, chạy từ thư mục `backend`.

```powershell
node --env-file=../deploy/.env.bootstrap-admin dist/database/bootstrap-admin.js
```

Nếu dùng image, mount một thư mục operator bảo vệ dưới dạng chỉ đọc tại `/run/operator`, đặt các đường dẫn trong tệp cấu hình theo đường dẫn trong container và chạy cùng CLI.

```powershell
$taskOperatorDirectory = (Resolve-Path (Read-Host 'Thư mục operator bảo vệ ngoài repo')).Path
$taskBackendImage = Read-Host 'Digest backend đã duyệt'
docker run --rm --mount "type=bind,source=$taskOperatorDirectory,target=/run/operator,readonly" --entrypoint node $taskBackendImage --env-file=/run/operator/.env.bootstrap-admin dist/database/bootstrap-admin.js
```

Thư mục operator ở ví dụ nằm ngoài repo, do người vận hành tạo với ACL phù hợp và chứa tệp cấu hình cùng hai tệp bí mật. Nếu dùng CA riêng, mount CA công khai và thêm `-e NODE_EXTRA_CA_CERTS=/run/operator/ca.crt` vào lệnh Docker. CLI kiểm TLS thực, tên database và ledger, dùng khóa chung với migration, rồi tạo đơn vị, ba mã vai trò, một Admin và một audit SYSTEM trong cùng transaction. Đơn vị đã có cần trùng tên và đang hoạt động. CLI từ chối nếu database đã có tài khoản, audit, yêu cầu hoặc tài sản.

Thành công trả mã 0 với `BOOTSTRAP_ADMIN_CREATED`. Lệnh chạy lại trả mã 1 với `BOOTSTRAP_DATABASE_ALREADY_INITIALIZED`. Nếu client mất kết nối khi commit, operator kiểm audit và tài khoản đã tạo trước khi thử lại. Giao mật khẩu tạm qua kênh riêng, yêu cầu Admin đổi mật khẩu tại lần đăng nhập đầu, rồi thu hồi quyền truy cập tệp mật khẩu tạm theo quy trình của môi trường.

## Sao lưu PostgreSQL ngoài Compose

Chạy từ máy operator kết nối được đến đúng PostgreSQL. Cấp tài khoản sao lưu có quyền đọc đủ dữ liệu cần phục hồi, tệp mật khẩu định dạng `pgpass` và PEM CA phù hợp. Giới hạn quyền đọc tệp mật khẩu và thư mục đích cho tài khoản operator. Nạp sẵn image PostgreSQL client được phê duyệt theo digest và chọn phiên bản phù hợp với máy chủ. Dùng manifest của phiên bản Crypta đang chạy.

```powershell
$taskBackupArguments = @(
  '--host', 'postgres.example.org', '--database', 'crypta', '--user', 'crypta_backup',
  '--password-file', 'C:\crypta-operator\backup.pgpass',
  '--ca-file', 'C:\crypta-operator\postgres-ca.pem',
  '--client-image', '<postgres-image@sha256:digest>',
  '--release-manifest', 'C:\crypta-operator\release-manifest.json',
  '--output', 'C:\crypta-operator\backups'
)
node tools/backup-production.cjs @taskBackupArguments
```

Thêm `--port` nếu khác 5432. Nếu PostgreSQL chỉ truy cập được từ mạng Docker đã cấp, thêm `--network` và tên mạng đó. Client dùng TLS `verify-full` và kiểm hostname. Lệnh ghi archive custom, kiểm mục lục bằng `pg_restore --list` rồi mới công bố cặp dump và manifest SHA-256. Manifest ghi phiên bản, Git SHA, digest client và thời điểm sao lưu. Tệp mật khẩu nằm ngoài cặp bàn giao. [Lệnh sao lưu](tools/backup-production.cjs) · [TLS PostgreSQL](https://www.postgresql.org/docs/17/libpq-ssl.html#LIBPQ-SSL-CERTIFICATES) · [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)

Chuyển cả cặp tệp vào kho sao lưu đã duyệt. Đối chiếu SHA-256 trước khi nạp vào database thử mới và áp lại quyền runtime sau khi phục hồi. Người vận hành chốt lịch, retention, mã hóa, cảnh báo lỗi và nơi lưu ngoài máy theo RPO/RTO của môi trường. [Kiểm sau phục hồi](#trước-khi-nâng-cấp)

Diễn tập 09/11 dùng PostgreSQL 17 TLS cách ly và tài khoản sao lưu chỉ đọc. Lệnh từ chối sai CA, sai hostname và sai mật khẩu, đồng thời dọn tệp tạm. Dump 144.151 byte khớp checksum và manifest ứng viên. Sao lưu mất 2,53 giây. Tạo database đích và nạp dump mất 2,48 giây trước bước đối chiếu. Dữ liệu 28 bảng và sequence audit khớp. Database phục hồi thu hồi quyền `CONNECT` của `PUBLIC`. Đây là số đo cục bộ với dữ liệu thử. [Báo cáo](tools/test-artifacts/crypta-ca-test-2c030d164f7e/report.json)

### Phục hồi vào PostgreSQL thử bên ngoài Compose

Dùng cặp dump và manifest từ kho đã duyệt. Chọn PostgreSQL cách ly, tài khoản operator được cấp quyền tạo database và tên `crypta_restore_*` mới. Tệp `pgpass` của operator cần cho phép kết nối vào database quản trị `postgres` và database thử. Nếu database quản trị có tên khác, truyền `--maintenance-database`.

```powershell
$taskRestoreArguments = @(
  '--host', 'postgres-restore.example.org', '--database', 'crypta_restore_pilot',
  '--user', 'crypta_restore_operator', '--password-file', 'C:\crypta-operator\restore.pgpass',
  '--ca-file', 'C:\crypta-operator\restore-ca.pem', '--client-image', '<postgres-image@sha256:digest>',
  '--backup', 'C:\crypta-operator\backups\crypta-example.dump'
)
node tools/restore-production-test.cjs @taskRestoreArguments
```

Lệnh cần đủ chỗ trống trong thư mục tạm của operator để chép một bản dump. Nó xác minh checksum và giải mã toàn bộ archive trước khi kết nối đích. Sau đó lệnh tạo database mới, thu hồi quyền `PUBLIC` trước khi mở kết nối cho owner, nạp dump trong một transaction và kiểm quyền hàm checkpoint audit. Đích đã tồn tại bị từ chối. Nếu một bước lỗi sau khi tạo database, giữ database thử để điều tra. [Lệnh phục hồi](tools/restore-production-test.cjs)

Áp quyền runtime trên database thử trước khi dựng API kiểm tra. Đối chiếu phiên bản ledger, số liệu, sequence audit, đăng nhập, lineage và trạng thái provider. Dùng dịch vụ thử cách ly cho lần khởi động sau phục hồi. [Quyền runtime](DATABASE_MIGRATIONS.md) · [Quay lui](#trước-khi-nâng-cấp)

Ngày 09/11, operator có `CREATEDB` và `NOSUPERUSER` phục hồi qua TLS vào database cách ly. Bốn ca bị từ chối gồm checksum sai, dump bị cắt dù checksum đã tính lại, tên database nguồn và tên đích đã có. Lệnh phục hồi hợp lệ mất 6,25 giây. Dữ liệu 28 bảng và sequence audit khớp. Sau khi cấp quyền runtime, API đăng nhập và đọc được yêu cầu đã hoàn tất, lịch sử tài sản và Audit Log. Provider thử vẫn ghi đúng một lần cấp sau khi khởi động lại. [Báo cáo](tools/test-artifacts/crypta-ca-test-e498bf0e5acb/report.json)

### Giám sát bản sao đã bàn giao

Kiểm từ nơi lưu độc lập hoặc thư mục đã nhận bản sao. Dùng một thư mục riêng cho mỗi database và giữ nguyên tên dump cùng manifest. Giá trị `1440` dưới đây là ngưỡng ví dụ tính bằng phút. Đặt ngưỡng thực theo RPO được duyệt.

```powershell
node tools/check-backup.cjs --directory C:\crypta-operator\offsite-copy --database crypta --max-age-minutes 1440
```

Lệnh kiểm manifest được công bố gần nhất, tuổi snapshot, kích thước và SHA-256. Lệnh trả `0` khi đạt, `1` khi cần cảnh báo và `2` khi cấu hình sai. Một dòng JSON `operations.backup_check` có `owner=database` cho collector định tuyến theo `code`. Đưa cả lỗi của lệnh sao lưu và tín hiệu kiểm bản sao vào kênh người trực. Dùng diễn tập phục hồi để xác nhận dữ liệu, khả năng khởi động API và RTO. [Lệnh kiểm](tools/check-backup.cjs)

## Trước khi nâng cấp

1. Ghi lại Git SHA, image ID/digest, PostgreSQL major version, DB đích, ledger, role runtime/migrator và chế độ provider/SMTP. Đối chiếu phạm vi provider, `APP_URL`, cookie HTTPS và đường kết nối DB của bản mới với cấu hình vận hành. Giữ sẵn image cũ và cấu hình tương thích trong kho bí mật.
2. Thông báo cửa sổ bảo trì. Ngắt lưu lượng ghi tại proxy rồi gửi SIGTERM cho mọi replica API/worker. Chờ toàn bộ tiến trình thoát trước khi chạy migration hoặc bật lại API có thao tác gửi lại email. Compose cho backend 150 giây để các giao dịch đang chạy ghi kết quả. Nếu tiến trình bị buộc dừng, rà các operation đã gửi hoặc cần đối soát và thư `SENDING`. Kiểm bằng chứng bên ngoài theo operation ID và Message-ID trước khi lên lịch xử lý lại.
3. Tạo backup PostgreSQL trước migration và xác minh checksum. Giữ bản sao theo chính sách của môi trường. Dùng DB riêng để kiểm một lượt restore, số liệu, phiên bản ledger, login, lineage, audit và ánh xạ provider. Cấu hình quyền và tài khoản của môi trường restore sau khi nạp dump. Khóa vật lý trong KMS/CA có quy trình backup riêng. [Hướng dẫn backup và restore](README.md)
4. Diễn tập trên một bản dữ liệu đại diện. Với ledger cũ chỉ có version và thời điểm áp dụng, đối chiếu mã và schema gốc trước khi cho CLI bổ sung checksum. Kiểm migration mới thay đổi ràng buộc nào, dữ liệu nào được backfill và phiên bản cũ đọc/ghi được gì. [Hợp đồng migration](DATABASE_MIGRATIONS.md)

## Nâng cấp và xác nhận dịch vụ

1. Chạy CLI migration của đúng image mới với credential migrator. Chờ exit 0. Đối chiếu phiên bản và checksum trong ledger bằng validator của image đó. Kiểm `indisvalid` của các chỉ mục mới và các trigger `trg_key_asset_identity`, `trg_sensitive_request_approval`. Rà và áp lại template quyền runtime của cùng commit. Trên database demo, đối chiếu ba khóa mẫu và chứng thư `CRT-FIN-ACTIVE` với phạm vi MOCK. Trên database thật, xác minh mapping từng tài sản theo bằng chứng từ provider. Tài sản nhập cũ thiếu bằng chứng tiếp tục ở trạng thái phạm vi provider chưa xác minh. [Điều kiện migration và template quyền](DATABASE_MIGRATIONS.md)
2. Khởi động API với credential runtime và `DATABASE_MIGRATION_MODE=validate`. Kiểm `/api/v1/health/live` và `/api/v1/health/ready` qua điểm vào sẽ dùng. Kiểm lỗi startup, job và queue trước khi mở ghi. Migration lỗi hoặc API chưa ready thì giữ cửa sổ bảo trì.
3. Chạy `node tools/smoke-deployment.cjs <APP_ORIGIN>` qua proxy HTTPS. Tiếp tục kiểm login theo vai trò, tra tài sản và lịch sử, tra audit và luồng nghiệp vụ đã chọn. Dùng người nhận/provider được cấp phép cho kiểm thử có tác động. Đối chiếu số liệu trước/sau và dấu hiệu monitor.
4. Mở lại lưu lượng theo kế hoạch triển khai. Ghi thời gian migrate, restart, smoke và kết quả. Giữ backup trước nâng cấp tới khi hết cửa sổ rollback đã thống nhất.

## Chọn phương án phục hồi

| Tình huống | Hành động |
| --- | --- |
| Migration thất bại trong transaction | Kiểm ledger và schema đã rollback. Giữ bản cũ nếu dữ liệu và điều kiện vận hành còn tương thích. Sửa nguyên nhân trên bản sao rồi chạy lại theo lịch. |
| Migration đã commit và lỗi chỉ ở ứng dụng | Ưu tiên sửa tiến với image mới tương thích. Chỉ đổi về image cũ trên DB đã migrate nếu đã kiểm cả đọc và ghi của bản cũ trên schema đó. |
| Schema/dữ liệu không phù hợp bản cũ | Dừng ghi. Phục hồi dump trước nâng cấp vào DB mới, chạy lại image cũ với DB đã restore và kiểm smoke trước khi chuyển lưu lượng. Giữ DB lỗi để phân tích và đối soát thay đổi phát sinh sau backup. |

Mốc 001–003 đến 016 có thay đổi constraint, trạng thái và metadata. Cách quay lại đã chọn cho diễn tập là phục hồi snapshot trước nâng cấp vào DB riêng. Kết quả phát sinh bên ngoài PostgreSQL cần đối soát trước khi worker chạy lại. Không xóa dòng ledger, sửa checksum hoặc bootstrap schema lên volume đang giữ dữ liệu.

Khi phục hồi ứng viên đã migrate, DBA tạo database riêng dưới role owner `NOLOGIN`. Tạo với `ALLOW_CONNECTIONS false`, thu hồi `CONNECT` của `PUBLIC` từ database quản trị, rồi bật kết nối để operator nạp dump. Dùng `pg_restore --role=<owner> --single-transaction --no-owner --no-acl` khi chuyển sang role đích khác. Giữ quyền kết nối của ứng dụng và dịch vụ khác ở trạng thái đóng đến khi đã đối chiếu ledger, ownership và cấp lại quyền. PostgreSQL mặc định cấp quyền gọi hàm cho `PUBLIC` khi ACL bị bỏ. Template quyền runtime thu hồi quyền đó trên hàm checkpoint trước khi cấp lại `CONNECT` cho runtime trong cùng giao dịch. [PostgreSQL CREATE DATABASE](https://www.postgresql.org/docs/17/sql-createdatabase.html) · [Quyền mặc định](https://www.postgresql.org/docs/17/ddl-priv.html)

Sau khi áp [template quyền runtime](DATABASE_MIGRATIONS.md), kiểm runtime có thể chạy API bằng LOGIN riêng và không thể gọi `capture_audit_anchor_rows`, sửa/xóa audit hoặc tạo bảng. Nếu dùng X05, cấp lại đúng quyền ký/xác minh theo [template X05](deploy/audit-anchor-grants.sql), rồi xác minh checkpoint bằng đầu chuỗi từ kho độc lập trước khi mở ghi. Giữ image và dump tương ứng với đường quay lui đã chọn.

## Chạy lại diễn tập cách ly

```powershell
./tools/test-isolated-stack.ps1 -Port 18080 -KeepStack
node tools/test-release-upgrade.cjs <report.json-cua-stack-moi>
./tools/cleanup-isolated-stack.ps1 -ReportPath <report.json-cua-stack-moi>
```

Runner build backend cũ từ Git, dùng schema và seed của cùng commit, rồi tạo phiên qua API. Runner nâng cấp một database, phục hồi dump cũ để kiểm rollback và phục hồi dump của ứng viên để kiểm ownership cùng quyền runtime. Cả ba database được cấp mới trong stack test. Provider chạy MOCK và SMTP tắt. Nginx/SPA của bản hiện tại được kiểm bởi smoke lúc dựng stack. Các bước nâng cấp và phục hồi API chạy nội bộ trong mạng test. Đây là thời gian diễn tập local với fixture nhỏ. Môi trường thật cần đo lại trước khi chốt RPO/RTO.

Ngày 08/11, diễn tập nâng cấp và phục hồi đạt 7/7 nhóm. Database phục hồi dưới owner mới khớp nội dung 26 bảng, 24 dòng ledger có checksum, sequence audit và 144 quyền runtime trên đối tượng/cột. API bằng runtime LOGIN đạt smoke sau 18,60 giây tính từ lúc bắt đầu cấp database đích. Runtime bị từ chối khi gọi hàm checkpoint, sửa/xóa audit và tạo bảng. Bộ backup/restore riêng đạt 12/12 và kiểm quyền `PUBLIC`. [Diễn tập ứng viên](tools/test-artifacts/integration/crypta-t30-test-d90e8bf3b2b7/release-upgrade-1bb2250e9c8b/results.json) · [Bộ backup/restore](tools/test-artifacts/integration/crypta-t30-test-0e0ff1582d71/backup-restore-137a1505b980/results.json)

Sau migration 025, diễn tập đạt lại 7/7. Database phục hồi khớp 27 bảng, 25 checksum và 148 quyền runtime, gồm quyền đọc và cập nhật trạng thái quét hết hạn. API qua smoke sau 18,87 giây tính từ lúc bắt đầu cấp database đích thử. [Diễn tập 025](tools/test-artifacts/integration/crypta-t30-test-b97d86ae9c93/release-upgrade-b49020ced714/results.json)

## Kết quả diễn tập ngày 06/11/2026

Ngày 07/11 đã nâng baseline `105d104` lên migration 021 và kiểm 6/6 nhóm. Startup validate từ chối ledger cũ, lỗi DDL thử rollback được, migration lặp lại giữ dữ liệu cũ, các quyết định lịch sử nhận cấp 1 và phiên cũ giữ liên kết SSO rỗng. Runtime LOGIN đọc được dữ liệu sau nâng cấp. API baseline khởi động lại từ dump được phục hồi vào database riêng. Stack thử đã dọn. [Báo cáo diễn tập 021](tools/test-artifacts/integration/crypta-t30-test-94f13dd8b7b7/release-upgrade-00153d89cb95/results.json)

Ngày 07/11 đã nâng baseline `105d104` lên migration 018 và kiểm 6/6 nhóm. Trước nâng cấp, lệnh đổi liên kết khóa được minh họa trong transaction rollback. Sau nâng cấp, cùng thao tác bị chặn bằng `KEY_ASSET_LINK_IMMUTABLE`. Dữ liệu lịch sử và sequence audit được đối chiếu, chạy migration lặp lại đạt, runtime LOGIN phục vụ dữ liệu đã migrate và bản baseline khởi động được từ DB phục hồi riêng. Stack đã được dọn. [Diễn tập 018](tools/test-artifacts/integration/crypta-t30-test-580d3bc461ed/release-upgrade-95a3fa380c71/results.json) · [Runtime 49/49 và các ca cấu hình trigger](tools/test-artifacts/integration/crypta-t30-test-580d3bc461ed/runtime-privileges-d9b414d5b29e/results.json)

- **6/6 nhóm PostgreSQL/API.** Dựng commit `105d104`, tạo hai phiên qua login thật và backup DB cũ. Bản mới ở chế độ `validate` từ chối ledger cũ trước khi migrate. Lỗi DDL cố ý ở 009 rollback cả 005 và cột checksum mới. Sau khi bỏ lỗi, CLI nâng lên 016, giữ ngày áp dụng 001–003, nội dung nghiệp vụ trong 15 bảng cũ và sequence audit. Chạy CLI lần hai giữ nguyên ledger và dữ liệu. [Báo cáo diễn tập](tools/test-artifacts/integration/crypta-t30-test-b1dcabcb598c/release-upgrade-0d54f02b9cc5/results.json)
- **2,064 giây** cho lần migrate gồm chạy container. Backfill làm thay đổi timestamp của các tài sản mẫu qua trigger `updated_at`. Bản ghi import chưa xác minh giữ nguyên phạm vi NULL và timestamp. Migration 016 sửa đúng chứng thư `CRT-FIN-ACTIVE` bị sót trong 014 và giữ checksum 001–015.
- **17,332 giây** từ cấp DB phục hồi, nạp dump và đối chiếu dữ liệu đến khi API cũ phục vụ smoke thành công. DB phục hồi giữ ledger 001–003, khớp nội dung 15 bảng và sequence audit. Bản mới chạy bằng LOGIN hạn chế đã qua readiness, login, lineage và audit. [Báo cáo diễn tập](tools/test-artifacts/integration/crypta-t30-test-b1dcabcb598c/release-upgrade-0d54f02b9cc5/results.json)
- **Hai image đóng gói local** từ commit baseline, tag `0.1.0-rehearsal.20261106.2`. Đã tạo lại archive Git, khớp SHA-256 và nhãn OCI cho cả hai image. Lệnh lặp từ chối ghi đè manifest. [Manifest](tools/test-artifacts/releases/0.1.0-rehearsal.20261106.2-105d104c41b0/manifest.json) · [Kiểm nhãn và hash](tools/test-artifacts/release-upgrade-20261106/image-verification.json)
- **Hồi quy trên image 016.** Backend unit đạt 383/383. Runtime LOGIN đạt 48/48 và ledger đạt 10/10. Smoke API/SPA qua Nginx đạt. Hai DB diễn tập, role và container thử được dọn. Cleanup stack còn 0 container, volume và network, giữ danh tính chín container ngoài test. [Chỉ mục kiểm chứng](tools/test-artifacts/release-upgrade-20261106/integration-index.json)

- **Hồi quy trên image 017.** Nâng cấp từ `105d104` đạt 6/6, chỉ mục mới hợp lệ, 15 bảng lịch sử và sequence audit được đối chiếu. Bản cũ chạy lại từ database phục hồi sau 17,7 giây. Runtime LOGIN đạt 48/48 với `pg_trgm` ở schema riêng, ledger đạt 10/10 và backend unit đạt 383/383. [Nâng cấp và phục hồi](tools/test-artifacts/integration/crypta-t30-test-c9b39a1d64cc/release-upgrade-f765f40e4319/results.json) · [Runtime LOGIN](tools/test-artifacts/integration/crypta-t30-test-c9b39a1d64cc/runtime-privileges-d2e7ffbe6927/results.json) · [Ledger](tools/test-artifacts/integration/crypta-t30-test-c9b39a1d64cc/runtime-ledger-44cc7bdfc0fd/results.json)

Image của commit phát hành, tag chính thức, CI remote và diễn tập với dữ liệu/môi trường đích còn mở.
