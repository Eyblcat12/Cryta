# Tổng quan 12 use case

Sơ đồ nhóm các ca theo người khởi tạo chính. Quyền cụ thể vẫn do API kiểm tra. UC02 và UC03 có bước Approver quyết định, UC04 cho User/Approver theo scope. UC11 gửi cho chủ sở hữu, Approver trong scope và Admin. UC12 do job cập nhật rồi người dùng xem kết quả. [Đặc tả và kịch bản chi tiết](NGHIEM_THU_UAT.md).

```mermaid
flowchart LR
    USER["User"] --> U1["UC01 Yêu cầu cấp mới"]
    USER --> U2["UC02 Yêu cầu gia hạn"]
    USER --> U3["UC03 Yêu cầu thu hồi"]
    USER --> U4["UC04 Tra cứu tài sản theo quyền"]
    APPROVER["Approver theo đơn vị"] --> A5["UC05 Hàng chờ trong scope"]
    APPROVER --> A6["UC06 Duyệt hoặc từ chối"]
    APPROVER --> U4
    ADMIN["Security Admin"] --> S7["UC07 Danh mục toàn hệ thống"]
    ADMIN --> S8["UC08 Quản trị policy"]
    ADMIN --> S9["UC09 Tra cứu audit"]
    ADMIN --> S10["UC10 Tài khoản và scope"]
    JOB["Job nền"] --> J11["UC11 Cảnh báo sắp hết hạn"]
    JOB --> J12["UC12 Cập nhật đã hết hạn"]
```

![Sơ đồ 12 use case](images/use-cases.png)

Đây là sơ đồ tổng quan quan hệ tác nhân và chức năng. Các nhánh lỗi, state machine, hai cấp duyệt và đối soát được mô tả trong [luồng hoạt động](../01_luong_hoat_dong_he_thong.md). Sơ đồ được render từ chính khối Mermaid phía trên.
