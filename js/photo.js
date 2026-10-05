// 사진을 올리기 전에 브라우저에서 작게 줄입니다.
// 큰 사진: 긴 쪽 1280px(한 장 200~300KB 안팎), 미리보기: 긴 쪽 320px.

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* 아래 방법으로 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function draw(img, longSide, quality) {
  const w0 = img.width, h0 = img.height;
  const k = Math.min(1, longSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
}

export async function shrinkPhoto(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('사진 파일이 아니에요');
  const img = await loadImage(file);
  let full = draw(img, 1280, 0.8);
  // 너무 크면(약 350KB 넘음) 한 번 더 줄입니다.
  if (full.length > 470000) full = draw(img, 1100, 0.7);
  const thumb = draw(img, 320, 0.7);
  if (img.close) img.close();
  return { full, thumb };
}
