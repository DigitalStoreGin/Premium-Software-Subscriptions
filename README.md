# Hệ thống quản lý sản phẩm — Static + GitHub Pages

Không backend, không dịch vụ trả phí. Toàn bộ chạy bằng **HTML + CSS + JS** trên GitHub Pages. Admin lưu thay đổi bằng cách **commit thẳng `products.json` lên GitHub qua API**, Pages tự build lại.

## 📁 Cấu trúc thư mục

```
your-repo/
├── index.html          ← website công khai (đã sửa: đọc products.json)
├── products.json       ← DỮ LIỆU sản phẩm (admin chỉnh sửa file này)
├── admin/
│   └── index.html      ← trang quản trị  →  https://…/admin/
└── README.md
```

Đặt cả 3 file (`index.html`, `products.json`, thư mục `admin/`) vào **gốc repo** đang bật GitHub Pages.

---

## 🚀 Cài đặt (làm 1 lần)

1. Đẩy 3 file/thư mục (`index.html`, `products.json`, `admin/`) lên repo GitHub đang bật Pages.
2. Mở `https://<owner>.github.io/<repo>/admin/` lần đầu — bạn sẽ thấy **"Cài đặt lần đầu"** (vì hash mật khẩu chưa được nhúng vào file).
3. Nhập mật khẩu mạnh bạn muốn dùng → bấm **Sinh hash** → copy hash (chuỗi 64 ký tự hex).
4. Mở `admin/index.html` trong repo, tìm dòng:
   ```js
   const ADMIN_PASS_HASH = '__SET_ME__';
   ```
   Thay `'__SET_ME__'` bằng hash của bạn (giữ nguyên dấu nháy), commit & push.
5. Đợi GitHub Pages build (~1 phút), tải lại trang. Từ giờ **bất kỳ ai vào `/admin/` đều phải nhập đúng mật khẩu này** — kể cả bạn, kể cả trên điện thoại, kể cả người lạ tình cờ.

> Quan trọng: Hash nằm trong source code công khai. Đây vẫn an toàn vì SHA-256 không đảo ngược được — nhưng chỉ với mật khẩu **đủ mạnh** (≥ 12 ký tự, không phải từ điển). Mật khẩu yếu kiểu `123456` thì có hash cũng dò ra được bằng rainbow table. Khuyến nghị: 1 cụm 4–5 từ ngẫu nhiên ghép lại, ví dụ `xanh-bão-cá-trống-mây`.

### Đăng nhập từ thiết bị khác (điện thoại, máy mới, …)

Vì hash nằm trong file, **cùng mật khẩu hoạt động ở mọi nơi**:
1. Trên điện thoại, mở `https://<owner>.github.io/<repo>/admin/`.
2. Nhập mật khẩu → tick **"Ghi nhớ trên thiết bị này"** nếu là điện thoại riêng → Mở khoá.
3. Lần đầu trên thiết bị này: dán **GitHub token** (giống bước trên máy tính), tick "Ghi nhớ token".
4. Xong — lần sau vào không phải nhập lại gì cả.

Trên máy lạ/dùng chung: **không tick** ghi nhớ; xong việc thì vào ⚙️ → Đăng xuất khỏi thiết bị này.

### Tạo GitHub token an toàn

1. Mở https://github.com/settings/personal-access-tokens/new
2. **Resource owner** = chủ repo · **Repository access** = *Only select repositories* → chọn đúng repo này.
3. **Permissions → Repository → Contents: Read and write** (chỉ cần quyền này, không thêm gì).
4. **Expiration**: 30–90 ngày để giảm rủi ro.
5. Tạo token, copy chuỗi `github_pat_…`, dán vào admin.

> Cùng token này dùng được trên mọi thiết bị (máy tính + điện thoại). Có thể lưu trong trình quản lý mật khẩu (1Password, Bitwarden…) để khỏi tạo lại.

---

## ✏️ Dùng trang admin

- **Bảng sản phẩm**: ảnh, tên, danh mục, giá, trạng thái, nút **Sửa/Xoá**. Trên điện thoại tự chuyển sang dạng thẻ.
- **Đổi trạng thái nhanh**: dropdown ngay trên mỗi dòng (Đang bán / Hết hàng / Đang ẩn).
- **Sửa** (drawer bên phải): tên, danh mục, bestseller, trạng thái, mô tả, ảnh (URL hoặc tải lên), đặc điểm, và các **gói + giá**.
- **Thêm sản phẩm**: nút góc phải.
- **Preview**: xem trước giao diện cửa hàng theo dữ liệu hiện tại (kể cả thay đổi *chưa lưu*).
- **Lưu** (nút xanh): commit `products.json` lên GitHub. Sau ~30–90 giây Pages cập nhật.

Chấm vàng cạnh logo = có thay đổi **chưa lưu**. Rời trang khi chưa lưu sẽ được cảnh báo.

---

## 🌐 Hành vi web công khai (`index.html`)

`index.html` tự `fetch('products.json')` khi tải trang và áp dụng **trạng thái cấp sản phẩm**:

| `status`        | Hiển thị trên web                                            |
|-----------------|-------------------------------------------------------------|
| `available`     | Bình thường, mua được                                        |
| `out_of_stock`  | Vẫn hiện nhưng gắn nhãn “hết hàng”, ảnh mờ, **không cho mua** |
| `hidden`        | **Ẩn hoàn toàn** — không xuất hiện                           |

> Nếu `products.json` không tải được (vd mở bằng `file://`), web tự dùng danh sách dự phòng nhúng sẵn nên không bao giờ trắng trang.

### Đổi chữ “hết hàng”

Web hỗ trợ 3 ngôn ngữ nên nhãn theo từng thứ tiếng: **Ausverkauft** (Đức) / **Out of stock** (Anh) / **Нет в наличии** (Nga). Muốn đổi chữ, tìm trong `index.html` các dòng có `'status.outofstock'` và sửa giá trị.

---

## 🗂️ Schema `products.json`

Là một **mảng** sản phẩm:

```json
[
  {
    "id": 8,
    "name": "Claude Team",
    "cat": "ai",
    "status": "available",
    "bs": false,
    "img": "https://… hoặc data:image/…",
    "desc": "Mô tả ngắn hiển thị trên thẻ.",
    "features": ["Đặc điểm 1", "Đặc điểm 2"],
    "variants": [
      { "label": "12 tháng", "price": 144, "status": "available" }
    ]
  }
]
```

- `status` (cấp sản phẩm): `available` | `out_of_stock` | `hidden`
- `cat`: `ai` | `streaming` | `office` | `design` | `vpn` | `other`
- `variants[].status`: `available` | `unavailable` | `order` (trạng thái từng gói)
- `bs`: gắn nhãn “Bestseller”

Admin chấp nhận cả định dạng đơn giản `[{ "title", "price", "status", "image" }]` không bắt buộc — nhưng để tương thích đầy đủ với web hiện tại, hãy giữ schema ở trên (`name`, `img`, `variants`).

---

## ⚙️ Cơ chế “Save → commit” (vì sao không cần backend)

Admin gọi thẳng **GitHub Git Data API** từ trình duyệt bằng token của bạn:
`get ref → get commit → tạo blob (base64) → tạo tree → tạo commit → dời branch`.

Dùng Git Data API (thay vì Contents API) vì `products.json` có ảnh nhúng nên **vượt giới hạn 1 MB** của Contents API; blob API chịu tới 100 MB.

---

## 🪶 Giảm dung lượng (khuyến nghị)

Hiện `products.json` ~1.2 MB do nhiều ảnh nhúng base64. Để web nhẹ và nhanh hơn:
- Trong admin, ở mỗi sản phẩm, thay ảnh base64 bằng **URL ảnh** (vd ảnh đặt trong thư mục `assets/` của repo, hoặc CDN miễn phí).
- Ảnh **tải lên** trong admin đã được tự nén (≤480px) để giữ file nhỏ.

---

## 🔒 Bảo mật — đọc kỹ

**Lớp 1 — Mật khẩu admin (chặn xem giao diện):**
- SHA-256 hash nhúng cứng trong `admin/index.html` (committed lên repo).
- Hash công khai nhưng SHA-256 một chiều — kẻ xấu **không suy ngược ra mật khẩu** với một mật khẩu đủ mạnh.
- Tránh mật khẩu yếu/từ điển. Khuyến nghị 4–5 từ ngẫu nhiên ghép lại.
- Đổi mật khẩu = vào ⚙️ → "Đổi mật khẩu admin" → sinh hash mới → dán vào file → commit.

**Lớp 2 — GitHub token (chặn ghi dữ liệu):**
- Token chỉ nằm trong `localStorage` thiết bị bạn, gửi trực tiếp tới `api.github.com`, không qua máy chủ trung gian.
- Kể cả ai đó vượt qua được lớp mật khẩu mà không có token hợp lệ → **không commit được**, không sửa được kho hàng.
- Dùng **fine-grained token** giới hạn 1 repo + quyền Contents + hết hạn ngắn.

**Lưu ý chung:**
- `products.json` là file công khai trên Pages — đừng đặt thông tin bí mật trong đó.
- Máy lạ/dùng chung: không tick "Ghi nhớ", xong việc thì Đăng xuất.
- "Ghi nhớ mật khẩu" lưu hash trong `localStorage` thiết bị đó — chỉ thiết bị riêng tư mới nên bật.

---

## 🔁 (Tuỳ chọn) Dùng GitHub OAuth thật / Decap CMS

Nếu sau này bạn muốn “đăng nhập bằng nút GitHub” thay vì dán token, cần một **OAuth proxy** để đổi `code → token` (vì `client_secret` không được lộ ở client). Cách phổ biến **miễn phí**:

- **Decap CMS** (`decap-cms`) + một OAuth client nhỏ chạy trên **Cloudflare Workers / Vercel / Netlify** (các gói free).
- Tạo GitHub OAuth App, trỏ `base_url` của Decap tới proxy đó.
- Decap đọc/ghi `products.json` như một *file collection* (dùng widget `list`).

Đây là phương án thay thế; bản admin hiện tại **không cần** bước này và đã đáp ứng đủ yêu cầu “không backend riêng, không dịch vụ trả phí”.

---

## ✅ Checklist nhanh khi gặp lỗi

- **Save báo 401/403** → token hết hạn hoặc thiếu *Contents: Read and write* → tạo token mới.
- **Save báo 404** → sai owner/repo/branch (mở admin → ⚙️ Cài đặt để kiểm tra) hoặc token không chọn repo này.
- **Web không đổi sau khi Save** → đợi Pages build (~1 phút) rồi tải lại; kiểm tra commit đã lên repo chưa.
- **Admin trống dữ liệu** → kiểm tra `products.json` nằm đúng gốc repo và là JSON hợp lệ.
