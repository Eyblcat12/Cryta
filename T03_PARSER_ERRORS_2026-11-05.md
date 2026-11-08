# T03 — Mã lỗi HTTP parser, 05/11/2026

[ApiExceptionFilter](backend/src/common/api-exception.filter.ts) trước đây chỉ giữ status của Nest `HttpException`; lỗi gzip/body parser dùng `http-errors` là một `Error` khác nên bị trả thành HTTP 500. Đã sửa lát cắt này: lỗi parser có marker/status hợp lệ giữ HTTP **400/413/415** và dùng thông báo chung, không trả nguyên message, body, details hoặc stack của parser. T03 chưa nghiệm thu toàn bộ hợp đồng API/validation.

## Đối chứng và thay đổi

[Bộ test mới](backend/test/api-exception.spec.ts) tạo lỗi thực bằng `gunzipSync` với bốn byte gzip hỏng, rồi bọc qua `createError(400, error)` giống luồng `body-parser/lib/read.js`. Các ca còn lại tạo `http-errors` mang type của body-parser/raw-body, cùng payload bí mật trong message/body/details để kiểm nội dung phản hồi. Không dùng mock shape đơn thuần thay cho lỗi gzip.

| Bằng chứng | Kết quả |
| --- | --- |
| [BEFORE](tools/test-artifacts/unit/parser-filter-20261105/results-before.json) | **8/16**, exit 1: tám ca parser sai status; Nest business exception và bảy nhóm unknown/inconsistent error giữ đúng hành vi |
| [AFTER focused](tools/test-artifacts/unit/parser-filter-20261105/results-after.json) | **16/16**, exit 0: gzip và typed parser error giữ status, không echo các trường nhạy cảm |
| [Full backend cuối](tools/test-artifacts/unit/security-parser-final-20261105-backend/results.json) | **161/161**, gồm cả 16 ca filter và 32 ca worker |
| [Lệnh unit/build](tools/test-artifacts/unit/security-parser-final-20261105-backend/commands.json) | Unit exit 0, build exit 0, host Node v25.9.0; ghi lúc `2026-11-05T15:39:39Z` |

Filter chỉ phân loại parser khi giá trị là một `Error`, `status === statusCode`, `expose === true` và có cặp type/status được chấp nhận. Lỗi zlib đã được `http-errors` bọc có `Z_DATA_ERROR` hoặc `Z_BUF_ERROR` với status 400 cũng được nhận; loại này giữ prototype `Error` gốc và không có parser type riêng.

| Status giữ lại | Type/code được nhận | Message trả về |
| --- | --- | --- |
| 400 | `entity.parse.failed`, `request.aborted`, `request.size.invalid`, `querystring.parse.rangeError`; hoặc zlib `Z_DATA_ERROR`/`Z_BUF_ERROR` đã bọc đúng status | Dữ liệu yêu cầu không hợp lệ. |
| 413 | `entity.too.large`, `parameters.too.many` | Dữ liệu yêu cầu vượt quá giới hạn cho phép. |
| 415 | `charset.unsupported`, `encoding.unsupported` | Định dạng hoặc mã hóa yêu cầu không được hỗ trợ. |

Response dùng `HTTP_<status>` và `details: []` cho các lỗi parser này. Không lấy code/message/details từ nội dung lỗi bên ngoài; lỗi parser được nhận cũng không bị ghi server-error stack qua nhánh logger 500.

Plain object giả status, `Error` chỉ gắn status nhưng không có marker parser, status/type không khớp, status và statusCode mâu thuẫn, `http-errors` 401/500 hoặc unknown error đều tiếp tục trả 500 với message chung. Đây là bộ phân loại giới hạn cho lỗi middleware đã biết, không phải cơ chế chứng minh nguồn gốc không thể giả mạo của object trong cùng process. Nest `HttpException` hợp lệ giữ business code/status/message/details như trước; test xác nhận `VERSION_CONFLICT`/409 không bị thay đổi.

Source filter SHA-256 `17c631ae542f25107ed3683ef532d9a37dfa5fade047fe83f8840da32c7c3e67`; test SHA-256 `287f7c8855d63bcea07422c13390b99eb482582b629782f7170680207f9ecd3c`. Không thêm production dependency cho phép phân loại; test dùng package `http-errors` có trong dependency tree thực tế.

## HTTP runtime — 3/3 trên image mới

[Report HTTP thực](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/body-parser-06976459b2b8/results.json) đạt **3/3**, `success=true`, trên stack cách ly `crypta-t30-test-d375cbb5e29e`. [Runner](tools/test-real-body-parser.cjs) đi trực tiếp tới IPv4 loopback `127.0.0.1:3000` trong container backend, bỏ qua Nginx request buffering; chỉ gọi route parser không tồn tại và GET health, không dùng credentials hoặc ghi nghiệp vụ vào DB. Mỗi request tối đa 2 KiB, deadline 4 giây, không tự retry.

| Probe HTTP | Body gửi | Status thực | Sau response |
| --- | --- | --- | --- |
| Gzip JSON hợp lệ, route không tồn tại | 38 byte | **404** | Request finish/response end đều có; GET health 200 sau quan sát 200 ms |
| Gzip hỏng bốn byte | 4 byte | **400** | Request finish/response end đều có; GET health 200 sau 200 ms |
| Gzip với trailing data nhỏ gửi muộn | 1.063 byte tổng; 1.024 byte trailer sau 50 ms | **404** | Request finish/response end đều có; GET health 200 sau 200 ms |

Runtime thực: **Node 22.23.4**, Nest Express adapter **11.2.3**, Express **5.2.1**, body-parser **2.4.0**. Runner resolve Express từ package của Nest adapter và body-parser từ Express đó; từ chối parser cũ hoặc version prerelease thay vì kiểm nhầm bản hoisted. Hash `body-parser/lib/read.js` thực trong container: `c77982d481a9fe5b13c0fdd68515a5931729961e7135124f70236d5a30bdd701`.

Backend image **`sha256:a2ce8053e25c95d441eefc06f4488338bf4b2837ed316be0cf1aa81c119776e1`** chứa filter mới. Cả năm `sourceHashes` trong report khớp source hiện tại khi đối chiếu; compiled filter hash **`2484d1870f79e9409caaceaf8d6e2afc4f9e1e9f03e4784412ec7fd7c3eb1e27`** khớp `backend/dist/common/api-exception.filter.js`. Không gán image phase trước cho kết quả parser HTTP mới này.

PID container backend **30914→30914**, `StartedAt` giữ `2026-11-05T15:41:01.105119055Z`, restart count **0→0**, running=true và container/image identity giữ nguyên. Inventory có 11 container trước/sau; tám ngoài test có full ID/name/project khớp, `comparisonHasSubjects=true`; ba container test cũng giữ nguyên. Runner không tạo temporary resource, không restart backend và không chạy probe crash đối với image cũ. Cleanup toàn stack có báo cáo riêng.

Ba request nhỏ này chỉ chứng minh các timing/status/health quan sát được trong lượt chạy, không phải stress test hoặc tái lập đầy đủ mọi decoder event order. Trailer 1 KiB nhỏ hơn coverage upstream; request writable/response completion không chứng minh từng event bên trong decoder. HTTP probe không lưu response body, nên bằng chứng không echo parser payload lấy từ unit test; runtime hiện chỉ kiểm status, completion, health và process/inventory preservation. HTTP 413/415 chưa được probe trực tiếp ở lượt ba ca này.

## Giới hạn giữ mở

Nest `RoutesResolver.mapExternalException` hiện chuyển `SyntaxError`/`URIError` thành `BadRequestException(err.message)` trước global filter và không giữ parser type gốc. Lát cắt này không phân biệt lại các lỗi đã bị bọc như vậy với Nest business/validation exception có chủ đích. Vì thế **chưa chứng minh mọi JSON parse message đều không chứa đoạn input**, hoặc toàn bộ response/log lỗi đều đã được redaction. Các ca 400 typed parser trong unit gọi filter trực tiếp; chúng không thay bằng chứng toàn pipeline Nest.

Nhánh logger cho unknown/server error vẫn theo hành vi hiện có; chưa kiểm kê/redact mọi stack/log nguồn. Bộ 16 test không thay fuzzing, toàn ma trận charset/content-encoding/body limit, reverse proxy, lỗi stream/timing, production security review hoặc cổng dependency/release. [Ma trận T02](T02_STATE_MATRIX_2026-10-06.md) và toàn bộ T03/T21/T37/T39/T43/T54 vẫn còn các tiêu chí khác.

Chạy lại focused từ thư mục `backend`:

```powershell
npm.cmd test -- test/api-exception.spec.ts
npm.cmd run build
```

Chỉ gán kết quả cho source/image của chính lượt chạy, giữ BEFORE/AFTER và report lịch sử nguyên phạm vi. Báo cáo này không đóng T03 hoặc toàn dự án.

## Phản hồi trước khi khớp route ngày 08/11/2026

Ca HTTP trên image cũ tái hiện thông báo JSON sai cú pháp chứa một đoạn input giả. Với HTTP 400 và 404 chưa khớp route, filter hiện dùng thông báo cố định nếu lỗi chưa có mã nghiệp vụ. `path` trong phản hồi là mẫu route, ví dụ `/api/v1/requests/:id`. Khi chưa có mẫu route, giá trị là `/`. Client có thể dùng `error.code` và `requestId` để xử lý và tra cứu. OpenAPI mô tả ý nghĩa mới của trường `path`. [Ca trước sửa](tools/test-artifacts/integration/crypta-t30-test-3bd7b013c677/body-parser-e972c33b7c21/results.json) · [Xử lý lỗi của NestJS](https://docs.nestjs.com/exception-filters)

Image mới đạt 8/8 ca HTTP trực tiếp. Các ca gồm gzip hợp lệ, gzip hỏng, trailer đến muộn, JSON sai cú pháp, dữ liệu vượt giới hạn sau giải nén, encoding không hỗ trợ, phần trăm mã hóa sai trong tham số và route không tồn tại. Mỗi ca kiểm status, error envelope, mã truy vết trùng header, dữ liệu giả vắng mặt và health 200 sau yêu cầu. Unit backend đạt 505/505, gồm kiểm giữ mã nghiệp vụ và thông báo validation ở route đã khớp. Hồi quy T21 qua Nginx/PostgreSQL đạt. [Tám ca HTTP](tools/test-artifacts/integration/crypta-t30-test-be092ef8698d/body-parser-2a8bf74324b4/results.json) · [T21](tools/test-artifacts/integration/crypta-t30-test-be092ef8698d/real-chromium-1794132902779/results.json)

T03 còn tiêu chí đối chiếu hợp đồng DTO, validation và kết quả provider cho toàn bộ luồng nghiệp vụ. Bộ này kiểm các nhánh lỗi HTTP nêu trên.
