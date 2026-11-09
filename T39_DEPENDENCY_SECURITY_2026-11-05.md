# T39/T45 — Dependency security, 05/11/2026

Đã cập nhật dependency và kiểm lại bằng image/runtime mới: audit trên lock đạt **0 phát hiện cả ba scope**, backend **161/161**, frontend **131/131**, ba build đạt và HTTP parser **3/3** trên image `a2ce8053…`. Các kết quả dưới đây chứng minh lát cắt dependency/parser; chưa nghiệm thu toàn bộ security hoặc release.

| Scope | Baseline trước sửa | Sau sửa lock |
| --- | --- | --- |
| Backend toàn bộ | 13 package: 3 critical, 6 high, 4 moderate | [0, exit 0](tools/test-artifacts/security/dependencies-20261105/backend-all-after.json) |
| Backend production | 8 package: 1 critical, 4 high, 3 moderate | [0, exit 0](tools/test-artifacts/security/dependencies-20261105/backend-production-after.json) |
| Frontend toàn bộ | 4 package: 2 high, 2 moderate | [0, exit 0](tools/test-artifacts/security/dependencies-20261105/frontend-all-after.json) |

Đếm theo package có ảnh hưởng, gồm meta-vulnerability parent; không phải số exploit độc lập. [Phân tích đầy đủ](tools/test-artifacts/security/dependencies-20261105/README.md), [dependency paths/hash baseline](tools/test-artifacts/security/dependencies-20261105/dependency-analysis.json), [delta trước/sau](tools/test-artifacts/security/dependencies-20261105/package-delta.json) giữ đúng phạm vi.

## Các thay đổi thực tế

- Backend giữ các range dependency runtime. Lock chuyển body-parser **2.3.0→2.4.0**, proxy-addr **2.0.7→2.0.8**, nodemailer **10.0.0→10.3.1**, Swagger **11.4.7→11.4.8** cùng js-yaml **5.3.0→5.5.0**, qs **6.16.0→6.17.1**. Scoped override của `@nestjs/platform-express` dùng **multer 2.5.0**; các parent Nest 11.2.6–11.2.8 được kiểm metadata vẫn pin 2.4.0 có advisory nên chỉ nâng parent chưa đủ.
- Backend dev Vitest **3.2.7→4.1.12** theo range manifest mới `^4.1.12`; loại Tinypool cũ có critical gadget. Scoped override `vitest → vite ^7.3.7` giữ branch 7 đang dùng, tránh resolver chuyển sang Vite 8. Source-map-js **1.2.2**.
- Frontend chỉ đổi lock: Vite **6.4.3→6.4.5**, Vitest/mocker **4.1.11→4.1.12**, source-map-js **1.2.1→1.2.2**. Manifest, React/ReactDOM và React Router **7.18.2** giữ nguyên; Router không có finding trong audit này.

Scope cập nhật dependency đúng ba file: [backend manifest](backend/package.json), [backend lock](backend/package-lock.json), [frontend lock](frontend/package-lock.json). Bước đầu dùng `--package-lock-only --ignore-scripts --audit=false` và explicit public registry; bước cài/chạy phase 2 được ghi riêng bên dưới. Bản filter HTTP cũng được sửa và kiểm thử ở phase này. Snapshot phase worker trước vá dependency vẫn là bằng chứng lịch sử, không thay image đã vá.

## Reachability và giới hạn

Body-parser high có đường vào đáng kiểm: Nest dùng parser Express mặc định, không tắt compressed body. Advisory mô tả valid compressed frame kèm dữ liệu thừa có thể làm process crash trước routing/authentication; bản vá 2.4.0. Đây là suy luận từ source, chưa tái hiện exploit. [Advisory upstream](https://github.com/advisories/GHSA-27r3-jxmh-p828).

Critical production là proxy-addr. Advisory cần trust subnet IPv4-mapped IPv6 sai; source hiện không đặt `trust proxy`, nên chưa xác nhận cấu hình dự án khai thác được. Đã vá 2.0.8 và cần kiểm cấu hình reverse proxy khi triển khai. [Advisory upstream](https://github.com/advisories/GHSA-jqcg-44mw-7w3h).

Critical Tinypool/Vitest chỉ nằm dev tree theo Dockerfile runtime `npm ci --omit=dev`. Advisory Tinypool cần prototype đã bị pollute và options object phù hợp; không có bằng chứng HTTP nghiệp vụ của Crypta gọi nó. Backend đổi major test tool nên phải chạy lại test thật, không dùng audit zero thay compatibility check. [Tinypool advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), [Vitest mocker advisory](https://github.com/advisories/GHSA-qxg6-89mg-rqv8).

Các điều kiện Multer upload/async fileFilter, YAML không tin cậy, parser recipient SMTP, dev-server Windows và source-map do attacker kiểm soát được ghi riêng trong phân tích; không suy package tồn tại thành exploit đã xảy ra. [Multer](https://github.com/advisories/GHSA-q7qp-rjg7-q26m), [Nodemailer](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8), [js-yaml](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm), [qs](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw), [Vite](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

## Kiểm chứng phase 2 với dependency đã cài

[npm ci backend](tools/test-artifacts/security/dependencies-20261105/backend-npm-ci.log) và [npm ci frontend cuối](tools/test-artifacts/security/dependencies-20261105/frontend-npm-ci-retry.log) đã cài dependency và báo không có vulnerability. [Lượt frontend đầu](tools/test-artifacts/security/dependencies-20261105/frontend-npm-ci.log) gặp EPERM khi unlink esbuild.exe đang bị giữ; giữ log lỗi, không coi lượt đầu là pass.

| Kiểm tra sau cài dependency | Kết quả / bằng chứng |
| --- | --- |
| Backend unit cuối, gồm parser filter | [161/161](tools/test-artifacts/unit/security-parser-final-20261105-backend/results.json), success=true, không test fail |
| Backend build | [tsc build](tools/test-artifacts/unit/security-parser-final-20261105-backend/build.log) đạt |
| Frontend unit | [131/131](tools/test-artifacts/unit/security-patched-20261105-frontend/results.json), success=true |
| Frontend ON/OFF build | [ON](tools/test-artifacts/unit/security-patched-20261105-frontend/build-on.log), [OFF](tools/test-artifacts/unit/security-patched-20261105-frontend/build-off.log), Vite 6.4.5; đủ sáu file khớp byte/hash [manifest phase 1](tools/test-artifacts/frontend-artifacts/worker-guards-20261105-phase1/manifest.json) |
| Stack image mới | [Report d375cbb5e29e](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/report.json): Nginx/API smoke đạt, MOCK/SMTP=false, database/volume test riêng |
| HTTP parser trên backend thật | [3/3, success=true](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/body-parser-06976459b2b8/results.json), không ghi DB hoặc dùng credential |

Trong hồi quy parser, lỗi ngoài `HttpException` từng bị filter map thành 500 dù mang status 400/413/415 hợp lệ. [ApiExceptionFilter](backend/src/common/api-exception.filter.ts) nay chỉ nhận nhóm parser error xác định, kiểm type/status/statusCode/expose hoặc zlib code 400 đã biết, rồi trả thông báo chung không echo payload/message/stack. Unit đối chứng [BEFORE 8/16](tools/test-artifacts/unit/parser-filter-20261105/results-before.json) → [AFTER 16/16](tools/test-artifacts/unit/parser-filter-20261105/results-after.json); không gán unit BEFORE thành một lượt tái hiện crash HTTP.

HTTP report chạy `2026-11-05T15:41:45Z`–`15:41:47Z`, backend image **`sha256:a2ce8053e25c95d441eefc06f4488338bf4b2837ed316be0cf1aa81c119776e1`**. Resolver theo actual Nest Express adapter cho **Nest platform 11.2.3 → Express 5.2.1 → body-parser 2.4.0**, Node **22.23.4**. Parser `lib/read.js` SHA-256 `c77982d481a9fe5b13c0fdd68515a5931729961e7135124f70236d5a30bdd701`; compiled filter SHA-256 `2484d1870f79e9409caaceaf8d6e2afc4f9e1e9f03e4784412ec7fd7c3eb1e27` khớp `backend/dist`, năm source hash trong report khớp file hiện tại khi đối chiếu.

Ba POST lần lượt: gzip JSON **38 byte→404** ở unknown route; gzip lỗi **4 byte→400**; frame cùng trailer **1.063 byte→404**, trailer 1.024 byte được gửi sau 50 ms. Mỗi request giữ socket trong cửa sổ quan sát 200 ms sau response, health tiếp theo đều **200**. Backend giữ nguyên PID **30914**, StartedAt, container/image ID và restart count **0**; inventory **11→11**, tám container ngoài test cùng full ID/name/project, comparison có subjects. Đây là kết quả thực của [runner](tools/test-real-body-parser.cjs), không chỉ kiểm package version hoặc health sau một lần restart.

Runner từ chối image body-parser cũ trước gửi request; chỉ nhận stack test đã xác minh label/DB/volume/loopback, MOCK/SMTP=false. Ba POST giới hạn 2 KiB/request, deadline 4 giây, không retry, chạy trực tiếp backend loopback để Nginx không gom chunk. Trailer nhỏ/delay và writable completion **không chứng minh mọi thứ tự decoder hoặc full upstream crash reproduction**; không thử crash image cũ, stress hoặc compression bomb. Bộ này không kiểm proxy behavior, provider hoặc SMTP.

[Workflow CI](.github/workflows/ci.yml) hiện chạy npm ci, audit mức high với explicit registry public, build và npm test cho cả backend/frontend. Chưa có bằng chứng remote workflow/required checks từ lần chỉnh này; các hồi quy DB/browser cần liên kết đúng phase/image riêng. Audit và parser pass không thay kiểm quyền DB/secret/TLS, object scope, provider/SMTP thật hoặc nghiệm thu T39/T43/T45/T54.

## Base image ứng dụng ngày 09/11/2026

Image frontend trước dùng Nginx 1.27.5, thuộc dải phiên bản bị ảnh hưởng của CVE-2026-42533. Image ứng viên dùng Nginx stable 1.30.6. Node.js giữ bản vá 22.23.4 đã dùng trong backend và ghim cùng digest cho build lẫn runtime. Hai digest đều là OCI index có manifest `linux/amd64` và `linux/arm64`. [Khuyến cáo Nginx](https://nginx.org/en/security_advisories.html) · [Bản vá Node.js](https://nodejs.org/en/blog/release/v22.23.4) · [Đóng gói](RELEASE_RUNBOOK.md)

Trivy 0.76.2 quét gói hệ điều hành trong đúng hai base image công khai theo digest trên `linux/amd64`. Cả hai được nhận diện là Alpine 3.24.4 và ghi 0 Critical/High với cơ sở dữ liệu cập nhật ngày 08/11/2026 lúc 18:58 UTC. Phạm vi này là gói hệ điều hành của base image. Các phụ thuộc npm tiếp tục được kiểm riêng trong CI. [Kết quả Nginx](tools/test-artifacts/t43-public-base-scan/nginx.json) · [Kết quả Node.js](tools/test-artifacts/t43-public-base-scan/node.json) · [Trivy 0.76.2](https://github.com/aquasecurity/trivy/releases/tag/v0.76.2)

Stack cách ly xác nhận phiên bản của cả hai tiến trình và cấu hình Nginx hợp lệ. Bộ kiểm đạt 193/193 Chromium với fixture, 2/2 nhóm phiên HTTPS, 2/2 ca SIGTERM và log, cùng ca phục hồi backend ở IP mới trong 3,27 giây. Đã dọn stack. [Phiên bản](tools/test-artifacts/integration/crypta-t30-test-39d8dcac3e52/runtime-base-versions.json) · [Chromium](tools/test-artifacts/integration/crypta-t30-test-39d8dcac3e52/spa-workspace/results-chromium.json) · [Phiên HTTPS](tools/test-artifacts/integration/crypta-t30-test-39d8dcac3e52/expiry-chromium-1794187626645/results.json) · [Phục hồi proxy](tools/test-artifacts/integration/crypta-t30-test-39d8dcac3e52/proxy-recovery-f55e8849b3dc/results.json)

## Quét image ứng dụng trước khi bàn giao

Cổng Trivy từ chối image backend dựng từ `5a29df6` vì 10 mục High trong thư viện đi kèm npm dưới `/usr/local/lib/node_modules/npm`. Backend mới cài dependency trong lúc build rồi gỡ npm và npx khỏi hệ thống tệp runtime. Stack cách ly đạt smoke API, ledger 11/11, quyền runtime 51/51 và nâng cấp, phục hồi 7/7. [Đối chứng](tools/test-artifacts/releases/0.0.0-rehearsal.20261109.scan-before-5a29df6412e1/image-security.json) · [Diễn tập nâng cấp](tools/test-artifacts/integration/crypta-t30-test-99edae45de39/release-upgrade-7709657c08fb/results.json)

Hai image `linux/amd64` dựng từ `11163cd86497159f1dab1027525dd836ef40e947` đạt 0 Critical/High trên các gói OS và thư viện được nhận diện. Trivy thấy 19 gói OS và 170 thư viện ở backend, cùng 71 gói OS ở frontend. Đã kiểm tag, nhãn, image ID và SHA-256 của archive 102.487.552 byte. Cổng CI quét image từ manifest và lưu báo cáo rút gọn. [Báo cáo bảo mật](tools/test-artifacts/releases/0.0.0-rehearsal.20261109.scan-after-11163cd86497/image-security.json) · [Manifest gói diễn tập](tools/test-artifacts/releases/0.0.0-rehearsal.20261109.scan-after-11163cd86497/manifest.json) · [Phạm vi CI](tools/ci/README.md)
