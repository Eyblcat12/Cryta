# T30/NAV20 — Network Users trước và sau routing,06/11/2026

Đã bổ sung bảng đối chiếu network baseline cho Users: **12/12 mẫu** trên Edge và Chrome, cùng fixture records. Bản hiện tại chỉ đọc nguồn của Users và shell khi vào trực tiếp; retry lỗi Users không tải lại bảng khác. Không sửa product source/build trong lượt này.

## Baseline có thể tái lập

[Build script](tools/test-artifacts/spa/users-network-20261106/build-baseline.cjs) lấy đúng8 file frontend từ Git `ff1478c523a40a4291b102c2fcd03ef87a5dff08`, ghi byte hash trong [baseline manifest](tools/test-artifacts/spa/users-network-20261106/baseline-manifest.json). Đó là App trước routing, `loadData()` gọi7 nguồn bằng Promise.all sau đăng nhập; menu Users chỉ scroll tới section đã mount.

Build baseline dùng **dependency/Vite6.4.5 đang cài hiện tại**, không tái lập dependency/runtime lịch sử. Chỉ so HTTP read ownership/counts, không latency, transfer bytes hoặc hiệu năng. [Fixture copy](tools/test-artifacts/spa/users-network-20261106/fixture.cjs) giữ records và cách xử lý hiện tại; riêng baseline opt-in unwrap paged Users/Audit/Notifications về array để phù hợp original API. Không đổi business source baseline hoặc lén sửa bản hiện tại.

## Kết quả

[Report12/12](tools/test-artifacts/spa/users-network-20261106/run-01/results.json), mỗi browser chạy before/after của ba scenario, không chọn mẫu:

| Trigger/pha đếm GET | Baseline trước routing | Bản hiện tại |
| --- | ---: | ---: |
| Guest mở /users → đăng nhập → xem Users |7 nguồn|3 nguồn|
| Guest vào Dashboard → đăng nhập → menu Users, tính tới Users đầu tiên |7 nguồn|4 nguồn, gồm Dashboard đã được mở trước đó|
| Dashboard→Users→Policies→Users, toàn sequence |7 GET ban đầu, các menu chỉ scroll|6 GET, gồm2 Users do hai lần mount có chủ đích và1 Policies khi được mở|
| Users503 → bấm Thử lại, tổng cold entry +retry |14 GET, cả7 nguồn được gọi lại|4 GET:2 Users và2 shell ban đầu|

Ba GET ở entry Users hiện tại là:

- `/users?page=1&pageSize=25` đúng1 lần.
- `/dashboard/summary?role=ADMIN` đúng1 lần cho shell.
- `/notifications?page=1&pageSize=1&read=false` đúng1 lần cho unread shell.

Không Assets, Requests, Audit, Policies, dashboard charts, user summary hoặc email queue khi entry Users trực tiếp. Baseline đọc Assets/Requests/Policies/Dashboard/Notifications/Users/Audit. Policies hiện tại chỉ tải khi chọn menu Policies; quay Users tải đúng bảng Users lần nữa, không replay các GET shell. Retry Users chỉ thêm một GET Users; không business mutation hoặc tải lại script/document. POST auth/refresh và auth/login được ghi riêng, không tính thành GET nghiệp vụ.

Baseline không hỗ trợ direct-route Users; sau đăng nhập, harness bấm menu section Users thật. Bản hiện tại xử lý direct-route đúng và kiểm bảng ready. Vì mô hình điều hướng khác nhau có chủ đích, không gọi đây là so latency của hai route tương đương hoặc production benchmark. Scenario menu từ Dashboard được giữ riêng để tránh bỏ chi phí Dashboard của journey đó.

## Kiểm chứng và giới hạn

Edge **156.0.4314.58**, Chrome **157.0.8103.39**, headless1440×1000. Mỗi mẫu có1 document/1 script request, không script download thêm; giữ document/shell identity, không pageerror/business write. Không lưu body, token/cookie/password hoặc storage state; tất cả HTTP API được fixture fulfill, **không DB thật**. [Runner](tools/test-artifacts/spa/users-network-20261106/compare.cjs) lưu tên endpoint/query/status và đếm từng pha.

[Build manifests](tools/test-artifacts/spa/users-network-20261106/builds-manifest.json) ghi6 file before/after. [Verifier](tools/test-artifacts/spa/users-network-20261106/run-01/evidence-verification.json) khớp8 baseline Git files,82 current frontend files với snapshot pha5, fixture/runner/report/build hashes và count invariants. [Cleanup](tools/test-artifacts/spa/users-network-20261106/run-01/host-cleanup.json) xác nhận2 preview process đã thoát, listener4173/4174 và esbuild0. Đây là kiểm bằng chứng đã lưu, không chạy lại browser.

Khoảng trống baseline fixture trong NAV20 đã được bổ sung đúng hai journey và retry nêu trên. Chưa là network trace triển khai thật, mọi role/mobile/engine hoặc kiểm load dữ liệu lớn. Không dùng số GET để nghiệm thuN6 hoặc toàn T30. [Delayed GET thật26/26 mỗi browser](T30_DELAYED_GET_2026-11-06.md) thuộc bộ kiểm riêng; [skeleton gộp hàng](T30_SKELETON_BANDS_2026-11-06.md) bị loại vì benefit chưa ổn định. [Goal/toàn54+6 task](TASK_STATUS_2026-11-05.md) còn mở.
