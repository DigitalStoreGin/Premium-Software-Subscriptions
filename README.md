# DigitalStore — Premium Software & Subscriptions

Website bán hàng tối giản, chuyên nghiệp cho sản phẩm digital.

## Cấu trúc thư mục

```
outputs/
├── index.html           # Trang web chính
├── README.md            # File này
└── images/              # 20 logo sản phẩm
```

## 22 Sản phẩm (đã gộp các phiên bản trùng lặp)

### Streaming
1. **YouTube Premium** — 4 lựa chọn: 1M / 3M / 6M / 12M
2. **Spotify Premium** — 2 lựa chọn: 6M / 12M

### KI & Code
3. **Cursor Pro** — 1 lựa chọn: 1 Jahr
4. **ChatGPT** *(gộp Go + Team)* — 8 lựa chọn: Go 1/3/6/12M, Team 1/3/6/12M
5. **Claude Team** *(gộp Standard + Premium)* — 4 lựa chọn: Standard 6/12M, Premium 6/12M
6. **Codex GPT** *(100$ OpenAI)* — 1 lựa chọn: 12M
7. **Google Colab Pro** — 1 lựa chọn: 12M

### Office
8. **Google One** *(Gemini Pro + 5TB)* — 3 lựa chọn: 12M Einladung/Zugangsdaten, 18M Code
9. **Microsoft 365 Premium** *(gộp Einladung + Zugangsdaten)* — 2 lựa chọn
10. **Microsoft 365 Personal** *(riêng vì khác đối tượng)* — 1 lựa chọn
11. **Adobe Acrobat Pro** — 1 lựa chọn: 12M Code (ảnh đỏ chính thức)
12. **Zoom Pro** — 1 lựa chọn

### Design
13. **Canva Edu** — 1 lựa chọn (riêng cho giáo dục)
14. **Canva Pro** — 1 lựa chọn
15. **Autodesk EDU** — 1 lựa chọn
16. **Adobe Creative Cloud Pro** — 1 lựa chọn
17. **Picsart Pro** — 1 lựa chọn

### VPN
18. **SurfShark VPN** *(gộp Starter Trial/Starter/One/One+)* — 7 lựa chọn
19. **NordVPN** *(gộp Basic Trial/Basic/Plus/Ultimate)* — 7 lựa chọn

### Sonstige (Khác)
20. **LinkedIn Sales Navigator Core** — 1 lựa chọn
21. **ElevenReader** — 1 lựa chọn
22. **Discord Nitro** — 1 lựa chọn

## Tính năng

- **Phong cách tối giản chuyên nghiệp** — palette đen-trắng-xám, nhiều khoảng trắng
- **Hero section** với eyebrow "Von 100+ zufriedenen Kunden vertraut"
- **Logos strip** các thương hiệu (grayscale → màu khi hover)
- **22 sản phẩm** có ảnh thật, đã gộp các phiên bản trùng lặp
- **Search & filter** theo danh mục (Streaming, KI & Code, Office, Design, VPN, Sonstige, Best Seller)
- **Variants picker** — tự cập nhật giá khi chọn
- **Cart drawer** với +/− qty, xoá riêng từng item
- **Modal thanh toán sau khi Bestellen** — hiển thị:
  - Tóm tắt đơn hàng (sản phẩm + tổng tiền)
  - Bankverbindung đầy đủ: Name, IBAN, số tiền (có nút copy)
  - 3 bước hướng dẫn: gửi email → chuyển khoản → nhận hàng
  - 3 nút: Schließen / Bestellung kopieren / E-Mail senden
- **Contact section** hiển thị Email + bảng thông tin chuyển khoản (có nút copy IBAN)
- **FAQ** 6 câu hỏi đầy đủ câu trả lời
- **Footer** với bankverbindung

## Thông tin chuyển khoản (đã tích hợp)

```
Name:               Dong Huy Truong
IBAN:               BE05 9675 8234 0775
Verwendungszweck:   Produktname + Ihr Name
Beispiel:           „Microsoft – Max Mustermann"
```

## Quy trình bán hàng

1. Khách duyệt sản phẩm → thêm vào giỏ hàng
2. Mở giỏ hàng → nhấn **"Bestellung abschicken"**
3. Modal hiện ra với toàn bộ thông tin: tóm tắt đơn + bankverbindung + hướng dẫn
4. Khách có thể: copy đơn hàng, hoặc nhấn **"E-Mail senden"** → mailto tự mở với mọi chi tiết
5. Khách chuyển khoản SEPA theo IBAN → bạn nhận tiền → gửi tài khoản/code qua email

## Triển khai lên GitHub Pages

1. Tạo repository mới trên GitHub
2. Upload toàn bộ thư mục (`index.html`, `images/`, `README.md`)
3. **Settings** → **Pages** → chọn branch `main` và folder `/ (root)`
4. Site sẽ live tại `https://<username>.github.io/<repo-name>/`

## Tuỳ chỉnh nhanh

Mở `index.html` và chỉnh:
- **Email nhận đơn hàng**: tìm `cfvblue@gmail.com` hoặc biến `ORDER_EMAIL` trong script
- **Bankverbindung**: tìm `BANK = {name:` trong script, hoặc tìm `BE05 9675 8234 0775` ở các vị trí HTML
- **Danh sách sản phẩm**: mảng `products` trong `<script>`
- **Màu sắc**: biến CSS ở `:root` (đầu file)

## Liên hệ

Dong Huy Truong — cfvblue@gmail.com
