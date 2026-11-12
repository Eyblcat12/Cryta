# T16 — Adapter HTTP và phạm vi provider, 06/11/2026

Adapter hiện kiểm tra cấu hình trước khi API khởi động và trước mỗi thao tác. Chế độ nhận `MOCK` hoặc `HTTP`. HTTP cần endpoint HTTPS, token, mã tài khoản/môi trường ổn định và thời gian chờ hợp lệ. Kiểm thử loopback dùng process riêng ở môi trường test.

Mỗi kết quả cấp phải khớp operation ID, loại tài sản và trạng thái `ACTIVE`. Khóa phải khớp thuật toán, độ dài và mục đích đã duyệt. Với chứng thư, Crypta đọc khóa công khai, serial, fingerprint, thời điểm bắt đầu và hết hiệu lực từ một TLS server leaf PEM. Ngày hiệu lực lưu trong DB theo kết quả đã kiểm tra. Đọc thuộc tính chứng thư dùng `X509Certificate` của Node.js. [Tài liệu Node.js](https://nodejs.org/docs/latest-v22.x/api/crypto.html#class-x509certificate).

Phạm vi tài khoản provider được gắn khi tạo tài sản. API gửi yêu cầu và worker đều chặn gia hạn/thu hồi tài sản thiếu phạm vi hoặc thuộc endpoint/tài khoản khác. Bộ chọn tài sản chỉ đưa ra tài sản phù hợp. Chi tiết tài sản hiển thị `Mô phỏng`, `Provider HTTP` hoặc `Chưa xác minh nhà cung cấp` theo dữ liệu đã ghi.

## Kiểm chứng trước migration 015 và tích hợp UI T15

| Kiểm tra | Kết quả |
| --- | --- |
| Backend unit | [292/292](tools/test-artifacts/provider-http-20261106/backend-unit.json) |
| Worker trên PostgreSQL | [27/27](tools/test-artifacts/integration/crypta-t30-test-b01422d77ded/worker-recovery-after-a8bd254f8c71/results.json). Hai nhóm HTTP loopback kiểm ngày hiệu lực thật từ payload/PEM, tạo/gia hạn/thu hồi khóa, tham chiếu kế nhiệm, chặn khác tài khoản và kết quả sai operation ID. |
| API dùng runtime LOGIN | [39/39](tools/test-artifacts/integration/crypta-t30-test-b01422d77ded/runtime-privileges-a19994c67aa8/results.json). Có ca chặn cấu hình sai trước bootstrap, che token khỏi stderr và từ chối thao tác trên tài sản thiếu phạm vi. |
| Ledger PostgreSQL | [10/10](tools/test-artifacts/integration/crypta-t30-test-b01422d77ded/runtime-ledger-94e22e90f3ff/results.json), kiểm 14 migration |
| SMTP loopback | [10/10](tools/test-artifacts/integration/crypta-t30-test-b01422d77ded/email-delivery-after-1e18e2c83c27/results.json) |

Lượt worker đầu đạt 26/27 vì fixture HTTP trả cùng fingerprint cho hai khóa. Fixture đã sửa để mỗi operation có fingerprint riêng và lượt sau đạt 27/27.

Migration 015 nối tiếp sửa ba UUID khóa demo bị ghi sai trong danh sách backfill của 014. Unit và build sau thay đổi đạt [292/292 backend](tools/test-artifacts/provider-ui-20261106/backend-unit.json). Kiểm PostgreSQL sau 015 đang chờ hạn mức duyệt lệnh Docker. Stack test `crypta-t30-test-b01422d77ded` có báo cáo cuối `cleanupCompleted=false` và còn chờ xác nhận trạng thái rồi dọn.

## Phần nghiệm thu còn mở

Chủ dự án chưa chọn nhà cung cấp thật. Các ca HTTP ở trên dùng fixture loopback và chứng thư tự ký công khai. Cần chọn dịch vụ, xác minh chuỗi CA và danh tính được cấp, quyền token, thời hạn/idempotency, tra cứu operation bị mất biên nhận và hành vi retire sau gia hạn trên sandbox. [Thông tin cấu hình cần bổ sung](CAU_HINH_DICH_VU_THAT.md).

Lượt tích hợp mới đã áp dụng migration 015 và xác nhận ba khóa mẫu trong [runtime LOGIN 48/48](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/runtime-privileges-70488ce7aad4/results.json). [Worker 27/27](tools/test-artifacts/integration/crypta-t30-test-03f9d55db610/worker-recovery-after-ba4426afa367/results.json) đạt cả ca HTTP loopback. Nhà cung cấp thật và sandbox vẫn chờ chọn.
