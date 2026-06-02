# SECURITY REPORT

## 🔴 KHẨN: Brevo key đã lộ
Key `xsmtpsib-…` được dán trong chat → coi như công khai. **Bắt buộc**: Brevo → API Keys → xoá key đó → tạo key mới → đặt qua `wrangler secret put BREVO_API_KEY`. Không bao giờ để trong frontend, wrangler.toml, hay tin nhắn.

## Nguyên tắc đã áp dụng
- **No secrets in frontend:** Brevo/Web3Forms/Admin token nằm trong Worker secrets, không có trong index.html/app.js.
- **wrangler.toml KHÔNG chứa secret** (file này bị commit) — chỉ chứa KV id (không nhạy cảm) + ALLOWED_ORIGIN.
- **Admin endpoints** (`/orders`, `/status`, DELETE) yêu cầu header `x-admin-token` khớp `ADMIN_TOKEN`.
- **CORS** giới hạn theo `ALLOWED_ORIGIN`.
- **Order lookup public** chỉ trả dữ liệu tối thiểu (không lộ email/khách khác).

## Admin panel (sản phẩm)
- Đăng nhập SHA-256 (hash nhúng, không đảo ngược).
- Token GitHub: localStorage / đồng bộ mã hoá AES-GCM bằng mật khẩu admin.
- "Đăng xuất mọi thiết bị" = Regenerate PAT trên GitHub + xoá file đồng bộ.

## Còn nên làm
- TTL phiên admin (tự khoá sau N giờ) — chưa code.
- Rate-limit Worker /order (chống spam) — thêm bằng Cloudflare WAF/Turnstile.
- Lưu proof vào R2 thay vì chỉ email (nếu cần kiểm toán).

## Giới hạn cố hữu (no-backend cho storefront)
GitHub Pages tĩnh: gating admin là client-side. Worker bù phần bí mật cho luồng đơn. Đây là mức hợp lý cho shop nhỏ.
