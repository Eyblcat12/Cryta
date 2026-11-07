# X06 — Adapter khóa ký OpenBao Transit

Adapter dùng OpenBao Transit 2.7.2 và giữ hợp đồng HTTP T16 của Crypta. OpenBao được chọn cho sandbox cách ly. Nhà cung cấp, tài khoản và phạm vi production sẽ được cấu hình theo môi trường đích. [Bản phát hành OpenBao](https://github.com/openbao/openbao/releases/tag/v2.7.2)

| Khả năng | Hỗ trợ |
| --- | --- |
| Cấp khóa ký | RSA 2048/3072/4096 và ECDSA P-256/P-384/P-521 |
| Gia hạn | Tạo khóa mới với tham chiếu riêng, đối chiếu tham chiếu tiền nhiệm |
| Tra cứu | `GET /operations/:operationId` đọc journal và xác nhận trạng thái từ Transit |
| Thu hồi | Soft-delete, đọc lại trạng thái và giữ khả năng phục hồi cho người vận hành có quyền riêng |
| Thời hạn | Lưu ngày theo policy trong journal. Khi hết hạn, tra cứu trả `EXPIRED` và lần cấp lại cùng operation ID bị từ chối |
| Chứng thư, AES, xuất private key | Ngoài phạm vi adapter này |

Crypta xác nhận fingerprint SHA-256 từ public key SPKI và chỉ nhận biên nhận hợp lệ. Adapter lưu digest yêu cầu, mốc hiệu lực và tham chiếu trong KV v2 với CAS tạo mới. Hai lần gửi đồng thời dùng cùng tên Transit. Yêu cầu dùng lại operation ID với nội dung khác nhận 409. Khi upstream gián đoạn, adapter trả lỗi có mã để Crypta chuyển sang luồng đối soát hiện có. [API Transit](https://openbao.org/docs/api/secret/transit/) · [KV v2 và CAS](https://openbao.org/docs/secrets/kv/kv-v2/)

## Triển khai thử

1. Cấp hai mount riêng cho Crypta. Một mount Transit chứa khóa ký và một mount KV v2 giữ journal. Token dịch vụ chỉ có quyền trên các đường dẫn dưới đây. Thay tên mount và namespace theo môi trường.

   ```hcl
   path "crypta-transit/keys/+" {
     capabilities = ["create", "update", "read"]
   }
   path "crypta-transit/keys/+/soft-delete" {
     capabilities = ["delete"]
   }
   path "crypta-journal/data/crypta/operations/*" {
     capabilities = ["create", "read"]
   }
   ```

2. Khởi động adapter bằng Node 22 với `node providers/openbao-transit/server.cjs`. Môi trường đích dùng `NODE_ENV=production`, `OPENBAO_URL` HTTPS, `OPENBAO_TRANSIT_MOUNT`, `OPENBAO_JOURNAL_MOUNT`, `OPENBAO_NAMESPACE`, `BIND_ADDRESS` và `PORT`. Đặt token Crypta, token OpenBao, chứng thư TLS và khóa TLS ở tệp bảo mật riêng qua `CRYPTA_BRIDGE_TOKEN_FILE`, `OPENBAO_TOKEN_FILE`, `CRYPTA_BRIDGE_TLS_CERT_FILE` và `CRYPTA_BRIDGE_TLS_KEY_FILE`.
3. Trỏ Crypta ở chế độ `HTTP` vào HTTPS endpoint của adapter. Dùng token Crypta trong cấu hình provider T16 và một `CRYPTO_PROVIDER_SCOPE` duy nhất cho cụm, namespace và mount. Khi cấp khóa, chỉ mở policy ký tương thích với capability đã công bố. Chứng thư cần một adapter CA có hỗ trợ riêng. [Cấu hình provider T16](../CAU_HINH_DICH_VU_THAT.md)

Thời hạn trong journal điều khiển trạng thái hiển thị và việc cấp lại. Tài khoản ký trực tiếp trên Transit cần chính sách thu hồi hoặc lịch vô hiệu hóa riêng nếu môi trường yêu cầu chặn thao tác khi quá hạn. Tài khoản adapter không có quyền ký, xuất private key hoặc phục hồi khóa đã soft-delete.

## Kiểm thử

OpenBao native Windows 2.7.2 đạt 4/4 nhóm trên loopback. Ca cấp lại đi qua client HTTP của Crypta. Ca thu hồi xác nhận khóa cũ không sinh chữ ký, khóa gia hạn vẫn ký được. Kiểm thêm tra cứu hết hạn, token thiếu quyền, từ chối chứng thư và mất kết nối. Binary thử đã đối chiếu SHA-256 `b058d30eac461e78e56305d3aa7371c061405a060f364aa20999dc3a309264f4` của archive phát hành. Tiến trình và token thử đã được dọn.

Pipeline có cùng bộ kiểm hợp đồng và image sandbox ghim digest `sha256:5046911075e137e154ce49ab051502f4ec7cf367d484ae4a4dce665d9b90561f`.
