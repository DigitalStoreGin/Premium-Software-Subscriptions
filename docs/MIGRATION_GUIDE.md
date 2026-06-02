# MIGRATION GUIDE

## Từ bản monolith → bản tách module
File `index.html` cũ (1.8 MB) đã tách:
- CSS → `css/style.css`
- JS  → `js/app.js` (+ `js/presets.js`)
- `index.html` còn ~430 KB, **phải ở gốc repo**.

### Các bước
1. Backup repo cũ.
2. Copy toàn bộ `digitalstore-repo/` vào repo (giữ nguyên cây thư mục).
   - `index.html`, `products.json` ở gốc.
   - `css/`, `js/`, `admin/`, `translations/`.
3. Deploy Worker (xem CLOUDFLARE_SETUP.md) + đặt secrets.
4. Commit & push. Bật GitHub Pages (branch chính, thư mục `/`).
5. Kiểm: storefront tải CSS/JS đúng (mở DevTools → Network, không 404 `css/style.css`, `js/app.js`).

### Lưu ý đường dẫn
Vì JS/CSS dùng đường dẫn tương đối (`css/...`, `js/...`), nếu Pages chạy ở subpath `/Repo/` vẫn đúng vì `index.html` ở gốc repo. Nếu bạn đặt site ở thư mục con khác, kiểm lại đường dẫn.

### Không mất dữ liệu
`products.json` giữ nguyên. Admin sản phẩm hoạt động như cũ. Admin đơn hàng là trang mới `admin/orders.html`.
