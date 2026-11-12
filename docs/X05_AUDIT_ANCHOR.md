# X05 — Kiểm chứng Audit Log bằng checkpoint độc lập

## Mô hình kiểm chứng

Checkpoint phát hiện việc sửa, xóa hoặc chèn dòng vào phạm vi Audit Log đã được ký, ngay cả khi tài khoản quản trị PostgreSQL có thể bỏ trigger và sửa dữ liệu. Điều kiện kiểm chứng là khóa ký, danh sách khóa công khai và bản checkpoint tin cậy nằm ngoài quyền của tài khoản DB. Các dòng phát sinh sau checkpoint mới nhất được báo riêng để người vận hành biết đoạn nào đang chờ ký. Checkpoint đầu tiên lấy dữ liệu hiện có làm mốc.

Giữ các biện pháp hiện tại gồm trigger cấm sửa hoặc xóa và quyền runtime chỉ ghi thêm. Bên ký chạy tách khỏi backend. Bản kiểm thử dùng thư mục riêng với khóa riêng và khóa công khai tách biệt. Môi trường đích cần một kho độc lập có chính sách lưu giữ và khóa phiên bản, ví dụ object storage hỗ trợ WORM trong tài khoản khác với PostgreSQL. Retention checkpoint và khóa công khai cần dài ít nhất bằng cửa sổ lưu Audit Log và backup cần kiểm chứng.

## Checkpoint và xác minh

1. Bên ký đọc một đoạn có giới hạn theo thứ tự `audit_logs.id`. Khóa bảng ở chế độ `SHARE` trong lúc lấy đoạn để writer đã bắt đầu hoàn tất trước khi chốt ID cuối. `INSERT` lấy khóa xung đột ở cấp bảng. Giữ giao dịch ngắn và thử lại nếu chờ khóa quá thời hạn. [PostgreSQL 17 Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)
2. Tính SHA-256 trên biểu diễn UTF-8 có thứ tự trường cố định. Bảo toàn ID bigint dưới dạng chuỗi, timestamp UTC tới micro giây, giá trị null, IP và toàn bộ metadata ở dạng PostgreSQL JSONB đã chuẩn hóa. Mỗi checkpoint ký ID môi trường, số thứ tự, khoảng ID, số dòng, digest, digest của checkpoint trước và ID khóa.
3. Dùng Ed25519 để ký. Ghi checkpoint vào kho bên ngoài bằng thao tác tạo mới, với tên theo số thứ tự. Hai tiến trình ký cùng số thứ tự chỉ có một checkpoint được chấp nhận. Tiến trình còn lại đọc lại đầu chuỗi trước khi thử tiếp. Verifier dùng khóa công khai đã ghim và digest đầu chuỗi lấy từ kho tin cậy. [Ed25519 theo RFC 8032](https://www.rfc-editor.org/rfc/rfc8032)
4. Verifier kiểm chữ ký, thứ tự checkpoint, đầu chuỗi và số dòng/digest của từng đoạn hiện có trong DB. Sai khác trả lỗi kèm số checkpoint và khoảng ID, giữ chi tiết sự kiện trong hệ thống kiểm toán. Đầu chuỗi được cấp từ kho tin cậy giúp phát hiện mất checkpoint cuối.

## Khôi phục và xoay khóa

Giữ khóa công khai của các lần ký cũ để kiểm toàn bộ lịch sử. Sau khi chấp thuận khóa công khai mới, dùng khóa mới để ký checkpoint kế tiếp nối với digest trước đó. Khi phục hồi, kiểm DB trong môi trường riêng với cùng đầu chuỗi tin cậy trước khi mở ghi. Nếu bản sao thiếu đoạn đã ký, ghi nhận đoạn thiếu và phục hồi dữ liệu hoặc tạo nhánh lịch sử mới theo quy trình vận hành.

Nếu phục hồi với `--no-acl`, PostgreSQL áp quyền mặc định lên hàm checkpoint. Giữ database đóng với `PUBLIC` trong lúc phục hồi. Áp template runtime và cấp lại quyền riêng cho bên ký, bên xác minh trước khi mở kết nối của ứng dụng. [Runbook phục hồi](../RELEASE_RUNBOOK.md#chọn-phương-án-phục-hồi)

## Chạy công cụ độc lập

Áp dụng migration 023 rồi cấp quyền cho hai tài khoản DB riêng theo `deploy/audit-anchor-grants.sql`. Bên ký được đọc view chuẩn hóa và gọi hàm chụp đoạn. Bên xác minh chỉ đọc view. Runtime API không được cấp các quyền này.

| Biến môi trường | Giá trị |
| --- | --- |
| `AUDIT_ANCHOR_DATABASE_URL` | URL DB của tài khoản tương ứng, dùng TLS `sslmode=verify-full` ở môi trường thật |
| `AUDIT_ANCHOR_DEPLOYMENT` | Mã môi trường cố định, ví dụ `crypta-prod` |
| `AUDIT_ANCHOR_DIRECTORY` | Đường dẫn tuyệt đối tới thư mục checkpoint do hệ thống lưu độc lập quản lý |
| `AUDIT_ANCHOR_PUBLIC_KEYS_DIRECTORY` | Thư mục khóa công khai PEM, mỗi tệp đặt theo SHA-256 của SPKI DER và đuôi `.pem` |
| `AUDIT_ANCHOR_SIGNING_KEY_FILE` | Tệp Ed25519 PKCS#8 của bên ký, nằm ngoài thư mục checkpoint và chỉ cấp quyền đọc cho bên ký |
| `AUDIT_ANCHOR_EXPECTED_HEAD` | Digest đầu chuỗi đã được xác nhận ở kho tin cậy. Dùng `none` duy nhất khi ký lần đầu |

```bash
npm --prefix backend run audit:anchor -- seal
npm --prefix backend run audit:anchor -- verify
```

Mỗi lần ký có tối đa 1.000 dòng và trả digest mới để lưu làm đầu chuỗi. Kho dạng thư mục cần hỗ trợ hard link nguyên tử để công cụ từ chối ghi đè checkpoint đã tồn tại. Nếu tiến trình mất kết nối sau khi đã ghi, đối chiếu chữ ký của checkpoint mới và cập nhật đầu chuỗi từ kho tin cậy trước khi chạy lại. Giữ bản sao checkpoint, khóa công khai và đầu chuỗi bên ngoài backup PostgreSQL.

GitHub Actions đạt 5/5 nhóm X05 trên hai database PostgreSQL cách ly. Ca kiểm xác nhận thứ tự commit, phát hành đồng thời, sửa/xóa/chèn dòng, mất checkpoint cuối, xoay khóa và khôi phục `pg_dump` đối chiếu cùng đầu chuỗi. Hai database và khóa thử đã được dọn. Môi trường production cần chốt kho lưu giữ, lịch ký, chủ sở hữu khóa và thời hạn. [CI X05](https://github.com/Eyblcat12/Cryta/actions/runs/42367753777)
