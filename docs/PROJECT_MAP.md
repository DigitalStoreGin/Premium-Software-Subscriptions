# PROJECT MAP

```
digitalstore-repo/
├── index.html              # Storefront (gốc — GitHub Pages phục vụ tại /)
├── css/style.css           # Toàn bộ CSS storefront (responsive + safe-area iPhone)
├── js/app.js               # Toàn bộ JS storefront: i18n (DE/EN/RU), giỏ hàng, đặt hàng, upload bằng chứng
├── products.json           # Dữ liệu sản phẩm
├── admin/
│   └── index.html          # Admin SỬA MẪU EMAIL online (VI/EN/DE) — đăng nhập bằng Admin Token, lưu qua Worker /config
├── translations/           # de.json · en.json · vi.json (tham khảo i18n admin)
├── backend/
│   ├── worker.js           # Cloudflare Worker: /order, /order/:id/proof, /config (GET/POST), /orders, /status, DELETE
│   └── wrangler.toml       # KV id + ALLOWED_ORIGIN (KHÔNG chứa secret)
└── docs/                   # README, CLOUDFLARE_SETUP, BREVO_SETUP, ORDER_FLOW, SECURITY_REPORT, MIGRATION_GUIDE
```

## Luồng dữ liệu
- Khách → `index.html` (app.js):
  - Bước 1 (Tên + Email → Abschicken): **gửi thẳng Web3Forms báo admin** + gọi **Worker `/order`** để Brevo gửi email xác nhận cho khách.
  - Bước 2 (cửa sổ thành công): upload **bằng chứng chuyển khoản (BẮT BUỘC, PNG/JPG/PDF)** → bấm "Ich habe es gesendet" → **Web3Forms gửi lại toàn bộ đơn + file đính kèm** cho admin.
- Admin → `admin/index.html` sửa nội dung email (lời cảm ơn, mục "Das könnte Sie auch interessieren", hỗ trợ, chữ ký…) → lưu vào KV qua Worker `/config`. Email khách tự cập nhật theo.

## Nội dung email (online editierbar)
- Worker đọc cấu hình từ KV key `__email_config` (mặc định trong `DEFAULT_CONFIG`), hàm `renderEmail()` dựng email theo cấu hình đó.
- Sửa qua admin (mọi thiết bị, không phụ thuộc localStorage cho dữ liệu — chỉ token lưu trên máy).
```
