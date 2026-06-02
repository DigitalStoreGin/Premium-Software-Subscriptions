# CLOUDFLARE SETUP — từng bước

## 0. Chuẩn bị
- Node ≥ 18, `npm i -g wrangler`, `wrangler login`.
- KV namespace đã có: id `bd8530d0f1b84b58a56284db011bdc81` (binding `ORDERS`) — đã điền sẵn trong `wrangler.toml`.

## 1. Connect worker
```bash
cd backend
wrangler whoami        # xác nhận đã đăng nhập
```
`wrangler.toml` đã đặt `name = "store"` → URL sẽ là `https://store.<account>.workers.dev`
(của bạn: `https://store.tdh1812.workers.dev`).

## 2. Set secrets (KHÔNG ghi vào file)
```bash
wrangler secret put BREVO_API_KEY        # ⚠️ DÁN KEY BREVO MỚI (key cũ đã lộ → xoá trên Brevo)
wrangler secret put BREVO_SENDER_EMAIL   # email đã verify trên Brevo
wrangler secret put BREVO_SENDER_NAME    # DigitalStore
wrangler secret put WEB3FORMS_KEY        # 8a7b89a3-6dd5-4b90-bd30-e5f7139910de
wrangler secret put ADMIN_TOKEN          # chuỗi ngẫu nhiên dài (openssl rand -hex 24)
wrangler secret put ADMIN_EMAIL          # cfvblue@gmail.com
wrangler secret put SUPPORT_EMAIL        # cfvblue@gmail.com
```

## 3. Paste worker URL vào frontend
Trong `js/app.js`:
```js
const WORKER_URL = 'https://store.tdh1812.workers.dev';
```
(Đã điền sẵn. Sửa nếu account subdomain của bạn khác.)

## 4. Deploy
```bash
wrangler deploy
curl https://store.tdh1812.workers.dev/order/NONE   # → {"error":"not_found"} là OK
```

## 5. Commit & push
```bash
git add -A && git commit -m "order automation" && git push
```
Đợi GitHub Pages build ~1 phút.

## Test
- Đặt 1 đơn thử với email của bạn → kiểm Brevo email + Web3Forms.
- Admin orders: mở `/admin/orders.html`, dán Worker URL + ADMIN_TOKEN → thấy đơn.

## Sự cố
| Lỗi | Sửa |
|-----|-----|
| CORS | sửa `ALLOWED_ORIGIN` trong wrangler.toml rồi deploy lại |
| 401 /orders | sai `x-admin-token` |
| 500 storage_unavailable | KV id sai trong wrangler.toml |
| Brevo không gửi | sender chưa verify trên Brevo |
