# PROJECT MAP

```
digitalstore-repo/
├── index.html              # Storefront (gốc — GitHub Pages phục vụ tại /)
├── css/style.css           # Toàn bộ CSS storefront (tách từ index.html)
├── js/
│   ├── presets.js          # 8 sản phẩm gợi ý (đồng bộ email Brevo) — nạp trước app.js
│   └── app.js              # Toàn bộ JS storefront: i18n, giỏ hàng, đặt hàng, Order ID, upload proof
├── products.json           # 23 sản phẩm (dữ liệu)
├── admin/
│   ├── index.html          # Admin quản lý SẢN PHẨM (đăng nhập, i18n VI/DE/EN, đồng bộ token)
│   └── orders.html         # Admin quản lý ĐƠN HÀNG (đọc Worker: list/status/proof/credentials)
├── translations/           # de.json · en.json · vi.json (131 key, trích từ admin i18n)
├── backend/
│   ├── worker.js           # Cloudflare Worker: /order, /proof, /status, /orders, DELETE
│   └── wrangler.toml       # KV id thật + nơi liệt kê secrets (KHÔNG chứa secret)
└── docs/                   # README, CLOUDFLARE_SETUP, BREVO_SETUP, ORDER_FLOW, SECURITY_REPORT, MIGRATION_GUIDE
```

## Luồng dữ liệu
- Khách → `index.html` (app.js) → `POST store.tdh1812.workers.dev/order`
- Worker → KV (lưu đơn) + Web3Forms (báo admin) + Brevo (email khách)
- Admin → `admin/index.html` (sản phẩm, commit products.json qua GitHub API)
- Admin → `admin/orders.html` (đơn hàng, gọi Worker với x-admin-token)

## Form & logic email
- Đặt hàng: `submitOrder()` trong app.js (sinh Order ID, gửi Worker, fallback Web3Forms).
- Upload bằng chứng: `uploadPaymentProof()` trong app.js.
- Email khách: render trong `backend/worker.js` hàm `renderEmail()` (top động + 8 tĩnh + nút support).
