# T30-N1 — Motion contract của Crypta

Cập nhật 04/10/2026. Áp dụng cho hướng điều hướng và theme đã chốt trong [kế hoạch](KE_HOACH_HOAN_THIEN_DU_AN.md); không thay workflow hoặc thêm thư viện animation. Đây là contract implementation, chưa phải nghiệm thu toàn bộ T30-N.

## Token và vùng sở hữu

`frontend/src/routeMotion.ts` là nguồn thời lượng: fast 120 ms, page 160 ms, overlay 180 ms; entrance `cubic-bezier(0.2, 0, 0, 1)`, exit `cubic-bezier(0.4, 0, 1, 1)`. `main.tsx` đặt `--motion-fast`, `--motion-page`, `--motion-overlay`, `--motion-ease-entrance`, `--motion-ease-exit` lên root một lần trước render; không đọc computed style trong mỗi navigation. Light/dark dùng cùng token. Exit được dành cho contract, hiện đóng overlay ngay, không chờ exit animation.

Route enhancement sử dụng Web Animations API với opacity 0.6 → 1 và token page, không fill mode. Hook commit route ngay và chuẩn bị entrance trong requestAnimationFrame trước paint tiếp theo; cleanup hủy cả frame chưa chạy lẫn animation. CSS nav dùng fast, sidebar/drawer/modal dùng overlay và entrance. Reduced motion override CSS, đồng thời hook route bỏ hoặc cancel animation khi media preference đổi. Không có native View Transition hoặc cơ chế khác đồng thời điều khiển main.

## Ma trận tương tác

| Trigger | Vùng / thời lượng | Pending / dữ liệu | Focus / scroll | Reduced motion và lỗi enhancement |
| --- | --- | --- | --- | --- |
| Menu tới page khác trong cùng session/scope | Main entrance opacity, 160 ms; shell giữ nguyên | GET thuộc page/resource, indicator sau 180 ms; request không bị delay | Heading/title sau commit; tới đầu main; không chờ animationend | Đổi nội dung ngay; thiếu/hỏng animate không chặn route |
| Thay q/status/page/pageSize cùng page | Không animate/remount workspace hoặc form | Query mới bỏ snapshot cũ; refetch cùng key được giữ và có nhãn cập nhật | Giữ focus filter; query scroll theo hook sở hữu danh sách | Cùng hành vi, không smooth bắt buộc |
| List → detail → Back | Không main entrance vì identity feature không đổi; chưa có shared element/translation | Detail đọc ID theo scope; list quay lại đúng query | ReturnTo đã kiểm tra, phục hồi scroll sau khi hàng đúng query tải | Cùng hành vi; không snapshot đối tượng cũ |
| Modal request/user/email/decision mở | Entrance hiện có với token overlay 180 ms | Form/reference/mutation có trạng thái riêng | Focus trap/Escape/return focus độc lập với animation; control nội dung được cuộn lên trên footer sticky khi focus | CSS gần như tức thì; focus không chờ animation |
| Overlay đóng hoặc dirty blocker ở lại/bỏ | Đóng ngay; không thêm exit delay | Ở lại giữ draft; bỏ mới rời đích; pending/unknown không tự POST lại | Return focus hợp lệ; route commit mới focus heading | Không phụ thuộc motion |
| Nav hover/active/focus | Màu/nền/viền 120 ms; chữ giữ vị trí | Active theo route đã commit; badge/pending không suy ra dữ liệu 0 | Semantic link/aria-current/focus-visible | CSS tắt thời lượng theo media |
| Sidebar mobile | Transform hiện có, token overlay 180 ms | Đóng sau navigation được cho phép; desktop không giữ mobile trap | Mở focus menu/Tab trap; Escape về trigger; resize desktop nhả trap, thu về mobile đưa focus ra sidebar ẩn | Không chờ transform để focus; sidebar đóng có inert/aria-hidden |
| Auth restore/login/logout/expiry/password gate hoặc đổi role/scope | Không animate nội dung phiên cũ | GET/probe cũ bị loại; journal/draft/cache theo boundary | Chỉ page hợp lệ của phiên mới; dirty không chặn logout có chủ đích | Không chụp snapshot hoặc giữ trang trái quyền để chuyển cảnh |
| Refresh data/đổi theme/toggle reduced motion | Không replay page entrance | Dữ liệu theo resource/revision; mất quyền bỏ snapshot | Giữ draft và focus; reduced-motion đổi giữa phiên cancel ngay | Nội dung luôn opacity nền 1, không trắng màn hình |

`useRouteMotion` sở hữu page enhancement; `useWorkspaceScroll` sở hữu scroll/heading; `useDialogBehavior` sở hữu focus của dialog; `AppShell` sở hữu sidebar mobile. Animation không làm tín hiệu để gửi mutation hoặc xác nhận server.

Ngày04/10, scroll lưu offset từ scroll event, bỏ reset no-op khi offset0; reset/POP/query cần thiết chạy RAF trước paint, hủy khi người dùng wheel/touch/keyboard hoặc route đổi. Fixture179/179 mỗi browser gồm POP ngắn→menu, query data gate và wheel cancellation. Root trace sau sửa có layout/paint sau RAF cùng animation setup; N6 vẫn cần đối chiếu công việc render đầy đủ theo [report](T30_PROGRESS_2026-10-04_SESSION_PICKER_PERF.md).

## Baseline và kiểm chứng

- Baseline on/off trước/sau N4 ở [báo cáo NAV-21/N4](T30_PROGRESS_2026-10-01.md); build mới và phép đo tiếp theo ở [báo cáo L/N1](T30_PROGRESS_2026-10-01_L_N1.md). Artifact giữ riêng, có hash bundle và browser; không gán trace cũ cho build mới.
- Browser test N1 đối chiếu root tokens giữa hai theme, computed nav/overlay duration và duration thực của main Web Animation. Unit route policy giữ bộ ca page/query/session/reduced/unsupported API hiện có.
- Browser L-review tái hiện rồi sửa mobile resize, chữ dài Users và keyboard control bị footer che. L-matrix kiểm tra ba role, light/dark, 1440/1024/768/390. Lượt [N4/zoom/N6](T30_PROGRESS_2026-10-01_N4_ZOOM_N6.md) thêm zoom Chrome thật 200% và sửa control bị panel cắt; chưa phải screen reader review hoặc mọi trạng thái.
- Motion có công tắc build `VITE_ROUTE_MOTION=off`; không ảnh hưởng routing hoặc GET/mutation. Bản off và on cần build cùng source khi so sánh.

N2 review đủ loading/empty/error của mọi page, N6 phân tích long task và các cổng M vẫn cần bằng chứng riêng. Không dùng contract hoặc snapshot xanh để đóng T30.
