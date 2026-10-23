// 문제 이미지 저장소
//
// localStorage는 약 5MB 한도라 base64 이미지를 담으면 금방 터진다(실측 4.8MB).
// 이미지는 IndexedDB에 따로 저장하고, 문제 본문에는 `![설명](img:아이디)` 참조만 남긴다.
// 문제집 JSON(localStorage)에는 이미지가 들어가지 않는다.

const IMG_DB_NAME = 'jegi-images';
const IMG_STORE = 'images';
const IMG_REF_RE = /\(img:([A-Za-z0-9_-]+)\)/g;

let imageCache = {}; // { 이미지id: dataURL } — 렌더링은 동기이므로 메모리에 올려두고 쓴다

function openImageDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IMG_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IMG_STORE)) db.createObjectStore(IMG_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function imgTx(mode, fn) {
  return openImageDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, mode);
    const store = tx.objectStore(IMG_STORE);
    const req = fn(store);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  }));
}

// 저장된 이미지를 모두 메모리로 (앱 시작 시 1회)
async function loadImageCache() {
  try {
    const db = await openImageDB();
    imageCache = await new Promise((resolve, reject) => {
      const tx = db.transaction(IMG_STORE, 'readonly');
      const store = tx.objectStore(IMG_STORE);
      const out = {};
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { out[cur.key] = cur.value; cur.continue(); }
        else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    imageCache = {}; // IndexedDB를 못 쓰는 환경이면 이미지 없이 동작
  }
  return imageCache;
}

async function putImage(id, dataUrl) {
  imageCache[id] = dataUrl;
  try { await imgTx('readwrite', s => s.put(dataUrl, id)); } catch {}
  return id;
}

async function deleteImage(id) {
  delete imageCache[id];
  try { await imgTx('readwrite', s => s.delete(id)); } catch {}
}

// 본문에서 참조하는 이미지 id 목록
function imageRefsIn(text) {
  return [...String(text || '').matchAll(IMG_REF_RE)].map(m => m[1]);
}

function imageRefsInSet(data) {
  const ids = new Set();
  for (const p of data?.problems || []) {
    imageRefsIn(p.question).forEach(id => ids.add(id));
    imageRefsIn(p.explanation).forEach(id => ids.add(id));
  }
  return [...ids];
}

// 마크다운의 img: 참조를 실제 dataURL로 치환 (렌더링 직전에 호출)
function resolveImageRefs(md) {
  return String(md || '').replace(IMG_REF_RE, (full, id) =>
    imageCache[id] ? `(${imageCache[id]})` : full
  );
}

// 붙여넣기·드롭한 이미지를 적당한 크기로 줄여 dataURL로 변환
// (원본 캡처가 크면 저장 용량과 렌더 비용이 커지므로 가로 1200px로 제한)
function fileToDataUrl(file, maxWidth = 1200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        if (scale === 1 && reader.result.length < 400 * 1024) return resolve(reader.result);

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        // 다이어그램·표는 글자가 선명해야 하므로 PNG 우선, 너무 크면 JPEG로
        let out = canvas.toDataURL('image/png');
        if (out.length > 400 * 1024) out = canvas.toDataURL('image/jpeg', 0.85);
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 문제집에서 더 이상 참조하지 않는 이미지 정리 (문제집 삭제 시)
async function deleteImagesForSet(data) {
  for (const id of imageRefsInSet(data)) await deleteImage(id);
}
