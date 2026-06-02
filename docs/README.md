# DigitalStore

Cửa hàng phần mềm trên GitHub Pages + tự động hoá đơn hàng qua Cloudflare Worker + Brevo.

## Deploy nhanh (5 bước)
1. **Worker:** `cd backend && wrangler deploy` (xem `CLOUDFLARE_SETUP.md` để đặt secret + KV).
2. **Secrets:** đặt Brevo key MỚI, Web3Forms key, ADMIN_TOKEN… bằng `wrangler secret put` (KHÔNG để trong file).
3. **Worker URL:** đã set sẵn `https://store.tdh1812.workers.dev` trong `js/app.js` (sửa nếu khác).
4. **Commit:** đẩy toàn bộ repo lên GitHub (giữ `index.html` ở gốc).
5. **Push & bật Pages:** Settings → Pages → branch `main`, thư mục `/`.

## Cấu trúc
Xem `PROJECT_MAP.md`.

## Quản lý
- Sản phẩm: `/admin/` (mật khẩu admin).
- Đơn hàng: `/admin/orders.html` (nhập Worker URL + ADMIN_TOKEN).

## ⚠️ Bảo mật
Brevo key từng dán trong chat ĐÃ LỘ — phải tạo key mới. Chi tiết: `SECURITY_REPORT.md`.
