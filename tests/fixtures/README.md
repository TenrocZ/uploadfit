# S2 非敏感图像 fixtures

这些 fixture 只使用浏览器 Canvas 生成的确定性几何/伪随机像素，不包含个人照片、姓名、证件号或页面数据。

运行 `npm run fixtures:generate` 会在被 `.gitignore` 排除的 `tests/fixtures/generated/` 目录生成本地样本，并打印每个文件的 MIME、字节、宽高和 SHA-256。生成器不访问网络，也不读取用户文件。

基线样本：

- `png-1170x1701.png`：约 2MB 量级 PNG。
- `jpeg-390x567-medium.jpg`：约 500KB 量级 JPEG。
- `jpeg-390x567-small.jpg`：约 20KB 量级 JPEG。
- `jpeg-4000x3000.jpg`：约 5MB 量级 JPEG。
- `jpeg-orientation-6.jpg`：带 EXIF Orientation 6 的方向样本。
- `transparent.png`：透明 PNG。
- `corrupt.png`：声明为 PNG 但不可解码的损坏样本。
- `sample.webp`：浏览器 WebP 编码样本。

80MP 边界通过测试内构造 PNG 头，不在仓库保存巨大二进制。生成后的清单只记录结构化元数据，不记录完整文件名之外的页面信息、Base64 或图片内容。

