# Focus khi người dùng thao tác ngay sau điều hướng

Callback đưa focus về tiêu đề có thể chạy sau khi người dùng đã chọn nút hoặc ô nhập. Khi giữ callback này rồi cho nó chạy ngay lúc nút hàng nhận focus, Enter bị chuyển sang tiêu đề và trang vẫn ở hàng chờ.

Đối chứng trên bản frontend trước sửa ghi `navigated=false`, focus từ nút `request-1` chuyển sang `page-title` và URL giữ `/approvals`. Sau sửa, cùng thời điểm chạy callback ghi `navigated=true` và URL thành `/requests/request-1`. Bộ tái hiện dùng preview local với API fixture.

`schedulePageTitleFocus` được dùng ở shell và hai trang chi tiết. Nó giữ focus mới của người dùng, ô đang nhập, control trong vùng nội dung và dialog đang mở. Callback vẫn có cleanup khi component hoặc scope điều hướng kết thúc.

## Kiểm chứng

- Frontend build, 147/147 unit và lint đạt.
- Bộ PostgreSQL/API/Nginx/Chromium đạt 39/39 nhóm. Ca mới giữ callback focus của cả hàng chờ và chi tiết, cho chúng chạy ngay lúc nút nhận focus, rồi dùng Enter. Trang chi tiết và hộp từ chối đều mở. Escape trả focus về đúng nút. [Kết quả](tools/test-artifacts/integration/crypta-t30-test-9786d0438cb1/real-chromium-1794028167952/results.json)
- Hai ca từ chối ở 1440 px sáng và 390 px tối đạt. Stack được dọn sau lượt kiểm. [Stack](tools/test-artifacts/integration/crypta-t30-test-9786d0438cb1/report.json)

Lượt CI trước sửa có 37/38 nhóm Chromium, lỗi khi tìm nút Từ chối. Các bộ quyền runtime 49/49, ledger 11/11, worker 27/27, expiry 19/19 và email 11/11 cùng lượt đã đạt. [CI a144b43](https://github.com/Eyblcat12/Cryta/actions/runs/42339612363)

Ca bàn phím mới ở lượt local đầu có kỳ vọng cleanup HTTP 200, trong khi API hủy trả 201. Đã sửa kỳ vọng, chạy lại và ghi 39/39 ở báo cáo trên.

T30 còn các cổng N6, screen reader và ma trận theo kế hoạch. [Danh mục task](TASK_STATUS_2026-11-05.md)
