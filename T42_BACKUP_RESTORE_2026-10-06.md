# T42 — Diễn tập backup/restore, 06/10/2026

Đã chạy script PowerShell trên PostgreSQL 17 thật trong hai project Compose test riêng, database `crypta_t30_test`, provider `MOCK`, SMTP tắt. Backend test dừng trong lúc chụp dữ liệu ổn định. Đây là diễn tập dữ liệu test nhỏ; chưa nghiệm thu lịch backup, nơi lưu độc lập hoặc RPO/RTO production.

## Lượt mới nhất sau migration 008

[Report](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/backup-restore-b6d4af919a06/results.json) đạt **11/11**, exit 0, sau worker/policy/expiry và integration mới. **17 bảng**, toàn bộ row count/hash cùng sequence khớp; 32 user test và tám migration. Dump **91,591 byte**, SHA-256 `cc3cb444819718f23076b5d0bcfef374097112a44cf08ebc2c9d82f7a82b089d` đúng manifest. Restore+verify **15.841 giây**, toàn diễn tập **56.692 giây**; chưa phải RTO production. Inventory 11→11, tám container ngoài test giữ nguyên full ID/name/project, comparison có subjects.

[Cleanup mới](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/cleanup-report.json) đạt: ba test container đã dọn, container/volume/network còn **0/0/0**, trigger/function t30_ **0/0**. Inventory đầy đủ **11→8**, tám container ngoài test trước/sau khớp và comparison có subjects. [Stack report](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/report.json) nay `cleanupCompleted=true`, `keptStack=false`. Hai database restore của lượt này đi cùng volume test khi dọn; dump/manifest/report còn giữ. Không suy trạng thái running hoặc health từ việc giữ nguyên identity.

## Lượt kiểm lại sau sửa inventory

[Report mới](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/backup-restore-f3ba3842611a/results.json) đạt **11/11**, exit 0, trên stack mới `crypta-t30-test-84612a8a6a2d`. Đủ **17 bảng và sequence** khớp nguồn, có 8 user test. Dump 68.827 byte; SHA-256 `9443b3cc65d13d33b1ca3ae04401ede4eaa213960be6e769f1bdfde9a3e4525c` khớp manifest. Restore cùng đối chiếu mất 16,768 giây; toàn diễn tập 60,677 giây. Thời gian không phải RTO production.

Inventory mới lấy toàn bộ container `docker ps -a --no-trunc`, lưu stdout/exit code trước parse, lọc exact project bằng PowerShell. Không dùng biểu thức label `project!=...` đã cho danh sách rỗng ở lượt trước. Report lưu **11 container trước/sau**, trong đó **8 ngoài project test**, `otherContainerIdentityComparisonHasSubjects=true`, `otherContainerIdsPreserved=true`; full ID/name/project khớp. Bao gồm bốn container project `crypta`, ba `crypta-local` và một `rev_wandering_linux`. Đây là bằng chứng preservation trong thao tác backup/restore; chưa tự thay kết quả cleanup lượt cũ.

[Unit mocks PS5.1/PS7](tools/test-artifacts/unit/container-inventory-20261006/source-and-readonly-verification.json) đạt 15/15 mỗi runtime; kiểm Docker chỉ đọc nhận cùng 11 full-ID rows. Các nhánh kiểm malformed/duplicate/native failure và ID/name/project thay đổi đã được kiểm. Report cũ được giữ nguyên để không che giới hạn trước sửa.

## Lượt trước sửa inventory — giữ lịch sử

[Report diễn tập](tools/test-artifacts/integration/crypta-t30-test-f653de41c7d3/backup-restore-1cb0a58a8b08/results.json) đạt **11/11**, exit 0. Dump custom-format có 90.512 byte, SHA-256 `1614edf545a5fd8864aa6bdafb55a061f3fdf64dc2a32d972a0271ef92b96b2b` khớp manifest. Database đích mới `crypta_restore_e72cc324f929` có đủ **17 bảng**, row count và hash toàn bộ dòng khớp nguồn; giá trị sequence cũng khớp. Có 32 user test. Restore cùng kiểm tra mất 15,729 giây; toàn diễn tập 56,187 giây. Các thời gian này chỉ mô tả lượt test này.

| Kiểm tra | Kết quả |
| --- | --- |
| Dump không rỗng, SHA-256 đúng manifest | Đạt |
| Thiếu manifest bị từ chối trước tạo database | Đạt |
| Checksum sai bị từ chối trước tạo database | Đạt |
| Tên database nguồn bị từ chối làm đích | Đạt |
| Các lượt từ chối không tạo database phụ | Đạt |
| Row count/hash của mọi bảng public khớp | Đạt |
| Sequence public khớp | Đạt |
| Database đích đã tồn tại bị từ chối | Đạt |
| Lượt từ chối không thay dữ liệu đã restore | Đạt |
| Dữ liệu nguồn không đổi sau diễn tập | Đạt |
| Tập ID container ngoài project test trước/sau khớp | Đạt; xem giới hạn bên dưới |

Script dùng chung [database-context.ps1](tools/testing/database-context.ps1) để xác minh project/service/container và database test. Lỗi PowerShell 5.1 đã được sửa: đọc toàn bộ stdout Docker rồi lưu exit code trước khi chọn ID, tránh pipeline `Select-Object -First 1` cắt tiến trình native và trả exit -1.

[restore-crypta-test.ps1](tools/restore-crypta-test.ps1) bắt buộc file `.dump.json` với SHA-256 hợp lệ; từ chối ghi đè nguồn và database đã tồn tại. Backup cũ không có manifest cần được kiểm chứng nguồn/checksum theo quy trình vận hành trước khi sử dụng; không tạo manifest giả để vượt kiểm tra. Nếu restore lỗi sau tạo database, database đích riêng được giữ để điều tra, không tự xóa hoặc ghi đè.

## Chạy lại trên stack test mới

Từ thư mục gốc, tạo stack cách ly mới và giữ report; không dùng lại namespace đã dọn:

```powershell
./tools/test-isolated-stack.ps1 -Port 18080 -KeepStack
```

Dùng đúng project/env-file trong report mới, dừng **backend test** để dữ liệu không tiếp tục đổi trong lúc đối chiếu:

```powershell
docker compose --project-name <project-trong-report> --env-file <test.env-cua-project> --file tools/testing/compose.t30.yml stop backend
./tools/test-backup-restore.ps1 -ReportPath <report.json-cua-project>
./tools/cleanup-isolated-stack.ps1 -ReportPath <report.json-cua-project>
```

[test-backup-restore.ps1](tools/test-backup-restore.ps1) chỉ nhận report stack test do runner tạo, PostgreSQL phải chạy và backend phải dừng. Dump/report chứa dữ liệu test được lưu trong thư mục artifact Git bỏ qua. Lệnh backup mặc định không có `-IsolatedReport` vẫn dùng cấu hình vận hành; lượt này chỉ chạy nhánh cách ly.

## Cleanup lượt trước và phần còn mở

[Cleanup report](tools/test-artifacts/integration/crypta-t30-test-f653de41c7d3/cleanup-report.json) xác nhận container/volume/network test còn **0/0/0**, trigger/function `t30_` còn **0/0**. [Stack report](tools/test-artifacts/integration/crypta-t30-test-f653de41c7d3/report.json) có `cleanupCompleted=true`, `keptStack=false`. Database restore đã đi cùng volume test khi dọn; file dump/manifest/report còn giữ để kiểm tra.

Report cleanup ghi `otherContainerIdsPreserved=true`, nhưng `otherContainers=[]`. Vì vậy lượt cleanup này chỉ chứng minh hai tập container ngoài project test mà script quan sát được khớp; không tự chứng minh bốn container vận hành lịch sử còn chạy. Quyền sở hữu namespace/container/volume test được xác minh trước khi dọn.

T42 còn cần lịch và nơi lưu backup, kiểm tra truy cập, dữ liệu gần production, phục hồi trên máy khác, quyền DB tối thiểu, tương thích phiên bản/migration và RPO/RTO được chủ dự án chốt. Chưa coi diễn tập này là đóng T42 hoặc T46.
