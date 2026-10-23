marked.setOptions({ breaks: true });

// 문제 지문에 자주 쓰이는 기호가 마크다운 문법으로 오인되는 것을 방지
// - 물결표: "괄호(①~③)", "기호(㉠~㉧)" 가 취소선(~텍스트~)으로 해석되는 문제
// - 꺾쇠: "테이블 <R>에서", "<Table R1>" 이 HTML 태그로 해석돼 사라지는 문제
marked.use({
  extensions: [
    {
      name: 'plainTilde',
      level: 'inline',
      start(src) { return src.indexOf('~'); },
      tokenizer(src) {
        const m = /^~+/.exec(src);
        if (m) return { type: 'text', raw: m[0], text: m[0] };
      }
    },
    {
      name: 'plainAngle',
      level: 'inline',
      start(src) { return src.indexOf('<'); },
      tokenizer(src) {
        const m = /^<[^<>\n]*>/.exec(src);
        // marked 버전에 따라 text 토큰을 렌더러가 이스케이프하지 않을 수 있으므로 직접 처리
        if (m) return { type: 'text', raw: m[0], text: escHtml(m[0]) };
      }
    }
  ]
});

// 줄 맨 앞의 <Table R1> 같은 태그 모양은 블록 HTML로 삼켜지므로 미리 이스케이프
// (줄 중간의 꺾쇠는 위 plainAngle 확장이 처리하고, 코드 펜스 내부는 건드리지 않음)
function escapeLeadingTags(md) {
  let fence = null; // 펜스를 연 구분자(``` 또는 ~~~)를 기억해 같은 구분자로만 닫히게 함
  return md.split('\n').map(line => {
    const m = /^\s*(```|~~~)/.exec(line);
    if (m) {
      if (fence === null) fence = m[1];
      else if (fence === m[1]) fence = null;
      return line;
    }
    if (fence) return line;
    return line.replace(/^(\s*)<([A-Za-z][^<>\n]*)>/, '$1&lt;$2&gt;');
  }).join('\n');
}

// 렌더링 결과를 넣으면서 표를 가로 스크롤 컨테이너로 감쌈 (좁은 화면에서 잘림 방지)
function setMarkdownHtml(el, src) {
  el.innerHTML = renderMarkdown(src);
  el.querySelectorAll('table').forEach(table => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
}

// 이미지는 data: URL 만 허용한다. 외부 주소를 허용하면 문제집 파일만으로
// 열람 사실이 외부 서버에 알려질 수 있으므로(추적 픽셀) 아예 제거한다.
const SAFE_IMG_SRC = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
if (typeof DOMPurify !== 'undefined') {
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'IMG' && !SAFE_IMG_SRC.test(node.getAttribute('src') || '')) {
      node.remove();
    }
  });
}

// 문제/해설 텍스트 렌더링 진입점
// 문제집 JSON은 외부(AI 변환 결과·공유받은 파일)에서 올 수 있으므로 반드시 sanitize 후 삽입
function renderMarkdown(src) {
  const html = marked.parse(escapeLeadingTags(resolveImageRefs(src || '')));
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
      'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'img'
    ],
    ALLOWED_ATTR: ['class', 'src', 'alt'],
  });
}

// ===== AI 파싱 프롬프트 =====
const AI_PARSING_PROMPT = `당신은 코드 분석 문제집 PDF를 구조화된 JSON으로 변환하는 파서입니다.
입력은 PDF에서 추출된 텍스트(OCR 기반)이며, 이 텍스트에는 PDF 레이아웃 때문에 생긴
줄바꿈 오류, 코드 들여쓰기 소실 등의 문제가 섞여 있습니다. 아래 규칙을 반드시 지켜서
변환하세요.

## 출력 스키마

{
  "categories": [
    { "id": "python", "name": "Python", "emoji": "🐍", "language": "python" },
    { "id": "c", "name": "C", "emoji": "⚙️", "language": "c" },
    { "id": "sql", "name": "SQL", "emoji": "🗄", "language": "sql" },
    { "id": "java", "name": "Java", "emoji": "☕", "language": "java" },
    { "id": "plain", "name": "Plain text", "emoji": "📝", "language": null }
  ],
  "problems": [
    {
      "id": <문제 순번, 1부터>,
      "num": <문제 순번, id와 동일>,
      "category": <"python"|"c"|"sql"|"java"|"plain" 중 코드 언어에 맞게 선택>,
      "language": <category와 동일한 값, 코드가 없으면 null>,
      "question": "<문제 지문 텍스트>",
      "code": "<코드 원문, 없으면 필드 생략>",
      "answer": "<정답>",
      "explanation": "<해설 전체 텍스트>"
    }
  ]
}

## 규칙 1 — PDF 강제 줄바꿈 복원

PDF는 페이지 폭에 맞춰 문장 중간에서도 강제로 줄을 바꾼다. 아래 기준으로 판단해서
불필요한 줄바꿈은 이어붙이고, 의미상 필요한 줄바꿈만 유지한다.

- 이어붙여야 하는 경우: 줄 끝이 조사/어미로 끊기거나(예: "~하는", "~이다" 앞), 문장이
  마침표 없이 끝나고 다음 줄이 소문자/한글로 자연스럽게 이어질 때.
- 유지해야 하는 경우:
  - 번호 매김 목록 (①②③, ❶❷❸, 1. 2. 3. 등) 각 항목 사이
  - 코드 블록 내부의 줄바꿈 (원본 코드 구조를 그대로 따름)
  - 표(테이블) 형식 내용의 행 구분
  - "결과", "답", "해설" 같은 라벨과 그 내용 사이의 의도된 개행
- 판단이 애매하면 원문의 마침표(.)와 쉼표(,) 위치를 우선 기준으로 삼는다.
- 같은 단어가 페이지 넘김 과정에서 두 번 겹쳐 나오거나(OCR 중복), 음절이 잘려서
  따로 떨어진 경우(예: "한 다" → "한다") 자연스럽게 하나로 합친다.

## 규칙 2 — 코드 들여쓰기 복원

원본 PDF의 코드 블록은 이미지 기반이라 들여쓰기 공백이 OCR 과정에서 소실되거나
불규칙하게 남는다. code 필드에 넣을 때는 다음을 따른다.

- 들여쓰기 단위는 공백 2칸으로 통일한다(탭 금지).
- 들여쓰기 깊이는 원본 이미지가 아니라 코드의 구조(중괄호 {}, 콜론, 들여쓰기 기반
  블록 등 해당 언어의 문법 규칙)로 판단해서 재구성한다.
  - C/Java: \`{\` 로 열리는 블록마다 1단계(공백 2칸) 증가, \`}\` 로 닫히면 1단계 감소.
  - Python: \`:\` 로 끝나는 줄 다음부터 1단계 증가, 들여쓰기가 원본에서 확인되면 그
    구조를 유지하되 공백 2칸 기준으로 정규화.
  - SQL: 별도 들여쓰기 규칙 없으면 원본 줄바꿈만 보존.
- 코드 안의 문자열 리터럴(따옴표 안 내용)은 절대 줄바꿈하거나 들여쓰기를 넣지 않는다.
- 코드 내 주석, 세미콜론, 괄호 등 문법 기호는 원본 그대로 보존한다(임의 수정 금지).
- 최종적으로 재구성한 코드를 그대로 실행했을 때 의미가 원본과 동일한지 스스로
  검증한 뒤 출력한다.

## 규칙 3 — 필드 분리 기준

- question: 문제 지시문 + 지문 안에 포함된 표/보기/조건 등 문제의 일부(정답 제외).
  표는 markdown 표 형식(\`| |\`)으로 변환해서 question 문자열 안에 포함시킨다.
- code: 문제에 제시된 프로그램 코드만. 해설 안에 반복되는 코드(❶❷❸ 주석 달린 버전)는
  code 필드에 넣지 않고 explanation에만 남긴다.
- answer: "답 :" 뒤에 나오는 최종 정답만. 여러 줄이면 개행(\\n)으로 구분.
- explanation: "[해설]" 이후 내용 전체. ❶❷❸, Ⓐ Ⓑ 같은 단계 표시 기호는 그대로
  보존하고, 원본에 등장하는 모든 표(변수 값 변화표, 메모리 상태도, 배열/구조체 값
  추적표 등)는 반드시 markdown 표(\`| |\` 문법, 헤더 행 + 구분선 \`|---|---|\` 포함)로
  변환해서 explanation 문자열 안에 넣는다. 표를 문자열 안에 넣을 때는 표 앞뒤로
  빈 줄(\\n\\n)을 둬서 렌더링 시 구분이 되도록 한다. 텍스트로 나열된 값 목록도
  "변수/값" 형태로 반복되면 markdown 표로 변환하는 것을 우선한다(줄글 나열 지양).

## 규칙 4 — 일반 검증

- 숫자(정답, 배점, 문항 번호 등)는 원본과 절대 다르게 바꾸지 않는다.
- 하나의 PDF 안에 이미지 기반 OCR 텍스트와 재정렬된 plain 텍스트가 중복으로 들어있는
  경우, 더 깨끗하게 정리된 plain 텍스트 쪽을 우선 소스로 사용한다.
- JSON 문자열 내부의 개행은 반드시 \\n으로 이스케이프한다.
- 변환이 끝나면 categories/problems 스키마와 정확히 일치하는지, 필드 누락이나 오탈자가
  없는지, explanation 내 표가 markdown 문법으로 올바르게 작성되었는지 한 번 더
  검토한 뒤 최종 JSON만 출력한다(설명 문구 없이 JSON만).`;

function copyParsingPrompt() {
  navigator.clipboard.writeText(AI_PARSING_PROMPT).then(() => {
    const btn = document.getElementById('btn-copy-prompt');
    btn.textContent = '복사됨 ✓';
    setTimeout(() => { btn.textContent = '프롬프트 복사'; }, 2000);
  });
}

function togglePromptView() {
  const body = document.getElementById('ai-prompt-body');
  const btn  = document.getElementById('btn-prompt-more');
  const isOpen = !body.classList.contains('hidden');
  if (isOpen) {
    body.classList.add('hidden');
    btn.textContent = '∨ 프롬프트 보기';
  } else {
    body.classList.remove('hidden');
    btn.textContent = '∧ 접기';
  }
}

// ===== STATE =====
let appData = { categories: [], problems: [] };
let progress = {};
let currentCatId = null;
let currentProbId = null;
let editingProbId = null;
let currentSetId = null;

// ===== STORAGE =====
const LS_SETS_INDEX = 'jegi-sets-index';
const LS_ACTIVE_SET = 'jegi-active-set';
const setDataKey = id => `jegi-set-${id}`;
const setProgKey = id => `jegi-prog-${id}`;
const setWrongKey = id => `jegi-wrong-${id}`;
const setFavKey = id => `jegi-fav-${id}`;

// ===== 오답 노트 =====
// 문제집별로 틀린 문제 id를 저장하고, 다시 맞히면 즉시 제거한다.
const WRONG_VIEW_ID = '__wrong__';
const FAV_VIEW_ID = '__fav__';
let wrongIds = {};          // 현재 문제집의 오답 { [problemId]: true }
let favIds = {};            // 현재 문제집의 즐겨찾기 { [problemId]: true }
let specialViewList = [];   // 오답 노트·즐겨찾기를 열었을 때의 목록 스냅샷
                            // (푸는 중에 목록이 흔들리지 않도록 고정)

function readWrong(setId) {
  try { return JSON.parse(localStorage.getItem(setWrongKey(setId))) || {}; }
  catch { return {}; }
}
function saveWrong() {
  if (currentSetId) localStorage.setItem(setWrongKey(currentSetId), JSON.stringify(wrongIds));
}
function readFav(setId) {
  try { return JSON.parse(localStorage.getItem(setFavKey(setId))) || {}; }
  catch { return {}; }
}
function saveFav() {
  if (currentSetId) localStorage.setItem(setFavKey(currentSetId), JSON.stringify(favIds));
}
function favCount(setId, setData) {
  const ids = setId === currentSetId ? favIds : readFav(setId);
  return setData.problems.filter(p => ids[p.id]).length;
}
function wrongCount(setId, setData) {
  const ids = setId === currentSetId ? wrongIds : readWrong(setId);
  // 삭제된 문제는 집계에서 제외
  return setData.problems.filter(p => ids[p.id]).length;
}

// 지금 화면에 보여줄 문제 목록 (카테고리 또는 오답 노트)
function currentViewProblems() {
  if (currentCatId === WRONG_VIEW_ID || currentCatId === FAV_VIEW_ID) {
    return specialViewList
      .map(id => appData.problems.find(p => String(p.id) === String(id)))
      .filter(Boolean);
  }
  return appData.problems.filter(p => p.category === currentCatId);
}

function currentViewLabel() {
  if (currentCatId === WRONG_VIEW_ID) return '오답 노트';
  if (currentCatId === FAV_VIEW_ID) return '즐겨찾기';
  const cat = appData.categories.find(c => c.id === currentCatId);
  return cat?.name || currentCatId || '';
}

function getSetsIndex() {
  try { return JSON.parse(localStorage.getItem(LS_SETS_INDEX)) || []; }
  catch { return []; }
}
function saveSetsIndex(idx) { localStorage.setItem(LS_SETS_INDEX, JSON.stringify(idx)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

// 이전 단일 세트 데이터 마이그레이션
function migrateOldData() {
  const oldData = localStorage.getItem('jegi-data');
  if (oldData && !localStorage.getItem(LS_SETS_INDEX)) {
    try {
      const parsed = JSON.parse(oldData);
      const id = uid();
      saveSetsIndex([{ id, name: '기존 문제집', createdAt: Date.now(), problemCount: parsed.problems?.length || 0 }]);
      localStorage.setItem(setDataKey(id), oldData);
      const oldProg = localStorage.getItem('jegi-progress');
      if (oldProg) localStorage.setItem(setProgKey(id), oldProg);
    } catch {}
    localStorage.removeItem('jegi-data');
    localStorage.removeItem('jegi-progress');
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('ai-prompt-text').textContent = AI_PARSING_PROMPT;

  await loadImageCache(); // 문제 본문의 img: 참조를 동기 렌더링에서 바로 쓰려면 먼저 올려둬야 함

  initUploadScreen();
  initReviewScreen();
  initQuizScreen();
  initInlineReplacements();
  initImagePaste();

  migrateOldData();

  // 마지막 세션 자동 복원
  const activeId = localStorage.getItem(LS_ACTIVE_SET);
  if (activeId) {
    const raw = localStorage.getItem(setDataKey(activeId));
    if (raw) {
      try {
        appData = JSON.parse(raw);
        currentSetId = activeId;
        progress = JSON.parse(localStorage.getItem(setProgKey(activeId)) || '{}');
        wrongIds = readWrong(activeId);
        favIds = readFav(activeId);
        startQuiz();
        return;
      } catch {}
    }
  }
  renderSavedSets();
});

// 편집 모달의 textarea 에 이미지를 붙여넣기·드롭하면 저장 후 참조를 삽입
function initImagePaste() {
  document.querySelectorAll('textarea[data-img-target]').forEach(ta => {
    ta.addEventListener('paste', e => {
      const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); insertImageInto(ta, file); }
    });
    ta.addEventListener('dragover', e => { e.preventDefault(); ta.classList.add('img-drop'); });
    ta.addEventListener('dragleave', () => ta.classList.remove('img-drop'));
    ta.addEventListener('drop', e => {
      const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
      ta.classList.remove('img-drop');
      if (file) { e.preventDefault(); insertImageInto(ta, file); }
    });
  });
}

async function insertImageInto(textarea, file) {
  const prev = textarea.value;
  try {
    textarea.disabled = true;
    const dataUrl = await fileToDataUrl(file);
    const id = await putImage(uid(), dataUrl);
    const ref = `

![그림](img:${id})

`;
    const at = textarea.selectionStart ?? prev.length;
    textarea.value = prev.slice(0, at) + ref + prev.slice(at);
    textarea.setSelectionRange(at + ref.length, at + ref.length);
  } catch (err) {
    alert('이미지를 넣지 못했습니다: ' + err.message);
  } finally {
    textarea.disabled = false;
    textarea.focus();
  }
}

// CSP에서 인라인 스크립트를 금지했으므로, 기존 onclick 속성을 리스너로 대체
function initInlineReplacements() {
  const bind = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
  bind('btn-copy-prompt', copyParsingPrompt);
  bind('btn-prompt-more', togglePromptView);
  bind('btn-save-json', downloadCurrentSetJSON);
  bind('btn-print-pdf', openPrintModal);
  bind('btn-edit-problem', openEditModalFromQuiz);
  bind('btn-fav', toggleFavorite);
  bind('btn-copy', copyCode);
  document.querySelectorAll('.btn-preview-toggle[data-field]').forEach(btn =>
    btn.addEventListener('click', () => toggleEditPreview(btn.dataset.field))
  );
}

// ===== SCREEN HELPERS =====
// data-* 속성값은 항상 문자열이므로 원본 id 타입(숫자/문자열)으로 되돌려 조회
function findProblemByRawId(rawId) {
  return appData.problems.find(p => String(p.id) === String(rawId));
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===== SAVED SETS (업로드 화면) =====
function renderSavedSets() {
  const index = getSetsIndex();
  const section = document.getElementById('saved-sets-section');
  const list = document.getElementById('saved-sets-list');

  if (!index.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  list.innerHTML = [...index].reverse().map(s => {
    const prog = JSON.parse(localStorage.getItem(setProgKey(s.id)) || '{}');
    const done = Object.keys(prog).length;
    const total = s.problemCount || 0;
    const pct = total ? Math.round(done / total * 100) : 0;
    const date = new Date(s.createdAt).toLocaleDateString('ko-KR');
    return `<div class="saved-set-item" data-set-id="${escHtml(s.id)}">
      <div class="saved-set-info">
        <div class="saved-set-name">${escHtml(s.name)}</div>
        <div class="saved-set-meta">${escHtml(String(total))}문제 · ${escHtml(date)}</div>
      </div>
      <span class="saved-set-pct">${pct}%</span>
      <button class="btn-del-set" data-del-set-id="${escHtml(s.id)}">×</button>
    </div>`;
  }).join('');
}

function loadSet(setId) {
  const raw = localStorage.getItem(setDataKey(setId));
  if (!raw) { alert('데이터를 불러올 수 없습니다.'); return; }
  appData = JSON.parse(raw);
  currentSetId = setId;
  progress = JSON.parse(localStorage.getItem(setProgKey(setId)) || '{}');
  wrongIds = readWrong(setId);
  favIds = readFav(setId);
  startQuiz();
}

function deleteSetEntry(e, setId) {
  e.stopPropagation();
  if (!confirm('이 문제집을 삭제할까요?')) return;
  saveSetsIndex(getSetsIndex().filter(s => s.id !== setId));
  try {
    const raw = localStorage.getItem(setDataKey(setId));
    if (raw) deleteImagesForSet(JSON.parse(raw));
  } catch {}
  localStorage.removeItem(setDataKey(setId));
  localStorage.removeItem(setProgKey(setId));
  localStorage.removeItem(setWrongKey(setId));
  localStorage.removeItem(setFavKey(setId));
  if (localStorage.getItem(LS_ACTIVE_SET) === setId) localStorage.removeItem(LS_ACTIVE_SET);
  renderSavedSets();
}

// ===== SCREEN 1: UPLOAD =====
function initUploadScreen() {
  const dropPDF  = document.getElementById('drop-pdf');
  const inputPDF = document.getElementById('input-pdf');
  const dropJSON = document.getElementById('drop-json');
  const inputJSON = document.getElementById('input-json');
  const btnParse = document.getElementById('btn-parse');

  dropPDF.addEventListener('click', () => inputPDF.click());
  inputPDF.addEventListener('change', () => handlePDFFiles(inputPDF.files));
  dropPDF.addEventListener('dragover', e => { e.preventDefault(); dropPDF.classList.add('dragover'); });
  dropPDF.addEventListener('dragleave', () => dropPDF.classList.remove('dragover'));
  dropPDF.addEventListener('drop', e => {
    e.preventDefault(); dropPDF.classList.remove('dragover'); handlePDFFiles(e.dataTransfer.files);
  });

  dropJSON.addEventListener('click', () => inputJSON.click());
  inputJSON.addEventListener('change', () => handleJSONFile(inputJSON.files[0]));
  dropJSON.addEventListener('dragover', e => { e.preventDefault(); dropJSON.classList.add('dragover'); });
  dropJSON.addEventListener('dragleave', () => dropJSON.classList.remove('dragover'));
  dropJSON.addEventListener('drop', e => {
    e.preventDefault(); dropJSON.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleJSONFile(e.dataTransfer.files[0]);
  });

  btnParse.addEventListener('click', e => { e.stopPropagation(); startParsing(); });

  // 저장된 문제집 목록 (동적 렌더링 → 이벤트 위임)
  document.getElementById('saved-sets-list').addEventListener('click', e => {
    const delBtn = e.target.closest('[data-del-set-id]');
    if (delBtn) { deleteSetEntry(e, delBtn.dataset.delSetId); return; }
    const item = e.target.closest('[data-set-id]');
    if (item) loadSet(item.dataset.setId);
  });
}

let selectedPDFFiles = [];
let parsedSetName = '문제집';

function resetUploadScreen() {
  selectedPDFFiles = [];
  parsedSetName = '문제집';
  document.getElementById('input-pdf').value = '';
  document.getElementById('pdf-filelist').innerHTML = '';
  document.getElementById('btn-parse').classList.add('hidden');
  document.getElementById('btn-parse').disabled = false;
  document.getElementById('parse-progress').classList.add('hidden');
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-label').textContent = '파싱 중...';
}

function handlePDFFiles(files) {
  selectedPDFFiles = [...files].filter(f => f.name.endsWith('.pdf'));
  const listEl = document.getElementById('pdf-filelist');
  const btnParse = document.getElementById('btn-parse');

  if (!selectedPDFFiles.length) {
    listEl.innerHTML = '<div class="file-err">PDF 파일이 없습니다.</div>';
    btnParse.classList.add('hidden');
    return;
  }
  // 파일명도 신뢰할 수 없는 입력 (macOS·Linux는 파일명에 < > 를 허용)
  listEl.innerHTML = selectedPDFFiles.map(f => `<div class="file-ok">✓ ${escHtml(f.name)}</div>`).join('');
  btnParse.classList.remove('hidden');

  // PDF 파일명에서 기본 문제집 이름 생성
  const names = selectedPDFFiles.map(f => f.name.replace(/\.pdf$/i, ''));
  parsedSetName = names.length === 1 ? names[0] : names.join(', ');
}

async function handleJSONFile(file) {
  if (!file || !file.name.endsWith('.json')) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.problems || !data.categories) throw new Error('형식 오류');

    // 이미지는 localStorage 한도(약 5MB)를 넘기므로 IndexedDB로 분리 저장
    if (data.images && typeof data.images === 'object') {
      for (const [id, dataUrl] of Object.entries(data.images)) {
        if (typeof dataUrl === 'string' && SAFE_IMG_SRC.test(dataUrl)) await putImage(id, dataUrl);
      }
      delete data.images;
    }

    const setId = uid();
    const name = file.name.replace('.json', '');
    const index = getSetsIndex();
    index.push({ id: setId, name, createdAt: Date.now(), problemCount: data.problems.length });
    saveSetsIndex(index);
    localStorage.setItem(setDataKey(setId), JSON.stringify(data));

    appData = data;
    currentSetId = setId;
    progress = {};
    wrongIds = {};
    favIds = {};
    startQuiz();
  } catch {
    alert('올바른 문제집 JSON 파일이 아닙니다.');
  }
}

async function startParsing() {
  if (!selectedPDFFiles.length) return;

  const progressWrap = document.getElementById('parse-progress');
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');
  progressWrap.classList.remove('hidden');
  document.getElementById('btn-parse').disabled = true;

  try {
    const data = await parsePDFFiles(selectedPDFFiles, (pct) => {
      bar.style.width = `${Math.round(pct * 100)}%`;
      label.textContent = `파싱 중... ${Math.round(pct * 100)}%`;
    });

    appData = data;
    bar.style.width = '100%';
    label.textContent = `완료! ${data.problems.length}개 문제 파싱됨`;
    setTimeout(() => showReviewScreen(), 400);
  } catch (e) {
    label.textContent = '오류: ' + e.message;
    document.getElementById('btn-parse').disabled = false;
  }
}

// ===== SCREEN 2: REVIEW =====
function initReviewScreen() {
  document.getElementById('btn-save-start').addEventListener('click', saveAndStart);
  document.getElementById('btn-modal-save').addEventListener('click', saveEdit);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-modal-delete').addEventListener('click', deleteProblem);

  document.getElementById('review-tbody').addEventListener('click', e => {
    const btn = e.target.closest('[data-prob-id]');
    if (btn) {
      const p = findProblemByRawId(btn.dataset.probId);
      if (p) openEditModal(p.id);
    }
  });
}

function showReviewScreen() {
  showScreen('screen-review');
  const nameInput = document.getElementById('set-name-input');
  if (nameInput) nameInput.value = parsedSetName;
  renderReviewTable();
}

function renderReviewTable() {
  const tbody = document.getElementById('review-tbody');
  const summary = document.getElementById('review-summary');

  const catCounts = {};
  for (const p of appData.problems) {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  }
  summary.textContent = `총 ${appData.problems.length}개 문제 ` +
    Object.entries(catCounts).map(([k, v]) => {
      const cat = appData.categories.find(c => c.id === k);
      return `${cat?.emoji || ''} ${v}`;
    }).join(' · ');

  tbody.innerHTML = appData.problems.map((p, i) => {
    const cat = appData.categories.find(c => c.id === p.category);
    const qPreview = (p.question || '').replace(/\n/g, ' ').slice(0, 60);
    return `<tr>
      <td>${i + 1}</td>
      <td>${escHtml(cat?.emoji || '')} ${escHtml(cat?.name || p.category)}</td>
      <td title="${escHtml(p.question || '')}">${escHtml(qPreview)}${p.question?.length > 60 ? '…' : ''}</td>
      <td class="td-code">${p.code ? '있음' : '—'}</td>
      <td>${escHtml(p.answer || '—')}</td>
      <td class="${p.explanation ? 'badge-yes' : 'badge-no'}">${p.explanation ? '있음' : '—'}</td>
      <td><button class="btn-edit-row" data-prob-id="${escHtml(String(p.id))}">편집</button></td>
    </tr>`;
  }).join('');
}

function openEditModal(problemId) {
  const p = appData.problems.find(p => p.id === problemId);
  if (!p) return;
  editingProbId = problemId;
  document.getElementById('edit-category').value = p.category;
  document.getElementById('edit-question').value = p.question || '';
  document.getElementById('edit-code').value = p.code || '';
  document.getElementById('edit-answer').value = p.answer || '';
  document.getElementById('edit-explanation').value = p.explanation || '';
  // 미리보기 초기화
  ['question', 'explanation'].forEach(field => {
    document.getElementById(`edit-${field}-preview`).classList.add('hidden');
    document.getElementById(`edit-${field}`).classList.remove('hidden');
    document.getElementById(`btn-preview-${field}`).textContent = '미리보기';
  });
  document.getElementById('edit-modal').classList.remove('hidden');
}

function toggleEditPreview(field) {
  const textarea = document.getElementById(`edit-${field}`);
  const preview  = document.getElementById(`edit-${field}-preview`);
  const btn      = document.getElementById(`btn-preview-${field}`);
  const isPreview = !preview.classList.contains('hidden');
  if (isPreview) {
    preview.classList.add('hidden');
    textarea.classList.remove('hidden');
    btn.textContent = '미리보기';
  } else {
    setMarkdownHtml(preview, textarea.value);
    preview.classList.remove('hidden');
    textarea.classList.add('hidden');
    btn.textContent = '편집';
  }
}

function closeModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  editingProbId = null;
}

function openEditModalFromQuiz() {
  if (currentProbId == null) return;
  openEditModal(currentProbId);
}

function saveEdit() {
  const p = appData.problems.find(p => p.id === editingProbId);
  if (!p) return;
  p.category    = document.getElementById('edit-category').value;
  p.question    = document.getElementById('edit-question').value.trim();
  p.code        = document.getElementById('edit-code').value.trim() || null;
  p.answer      = document.getElementById('edit-answer').value.trim();
  p.explanation = document.getElementById('edit-explanation').value.trim() || null;
  const cat = CATEGORY_MAP.find(c => c.id === p.category);
  p.language = cat?.language || null;

  // 현재 세트가 있으면 localStorage에 즉시 저장
  if (currentSetId) {
    localStorage.setItem(setDataKey(currentSetId), JSON.stringify(appData));
  }

  closeModal();

  // 퀴즈 화면에서 편집한 경우 문제 다시 렌더링
  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen?.id === 'screen-quiz') {
    showProblem(editingProbId || currentProbId);
    renderCategoryNav();
  } else {
    renderReviewTable();
  }
}

function deleteProblem() {
  if (!confirm('이 문제를 삭제할까요?')) return;
  appData.problems = appData.problems.filter(p => p.id !== editingProbId);

  if (currentSetId) {
    localStorage.setItem(setDataKey(currentSetId), JSON.stringify(appData));
  }

  closeModal();

  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen?.id === 'screen-quiz') {
    currentProbId = null;
    renderCategoryNav();
    renderProblemNav();
    const probs = currentViewProblems();
    if (probs.length) showProblem(probs[0].id);
    else showEmptyView();
  } else {
    renderReviewTable();
  }
}

function saveAndStart() {
  const nameInput = document.getElementById('set-name-input');
  const name = nameInput?.value.trim() || '문제집';

  // JSON 다운로드
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.json';
  a.click();
  URL.revokeObjectURL(url);

  // 새 세트로 저장
  const setId = uid();
  const index = getSetsIndex();
  index.push({ id: setId, name, createdAt: Date.now(), problemCount: appData.problems.length });
  saveSetsIndex(index);
  localStorage.setItem(setDataKey(setId), JSON.stringify(appData));

  currentSetId = setId;
  progress = {};
  wrongIds = {};
  favIds = {};
  startQuiz();
}

// ===== SCREEN 3: QUIZ =====
const LANG_NAMES = { c: 'C', java: 'Java', python: 'Python', sql: 'SQL' };

function initQuizScreen() {
  document.getElementById('btn-check').addEventListener('click', checkAnswer);
  document.getElementById('answer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); checkAnswer(); }
  });
  document.getElementById('btn-explanation').addEventListener('click', toggleExplanation);
  document.getElementById('btn-next').addEventListener('click', goNextProblem);
  document.getElementById('btn-mark-correct').addEventListener('click', markAnswerCorrect);
  document.getElementById('btn-back-upload').addEventListener('click', () => {
    localStorage.removeItem(LS_ACTIVE_SET);
    resetUploadScreen();
    showScreen('screen-upload');
    renderSavedSets();
  });
  document.getElementById('btn-print-cancel').addEventListener('click', closePrintModal);
  document.getElementById('btn-print-go').addEventListener('click', runPrint);

  // 사이드바 카테고리 / 문제 번호 (동적 렌더링 → 이벤트 위임)
  document.getElementById('category-nav').addEventListener('click', e => {
    const item = e.target.closest('[data-cat-id]');
    if (item) {
      selectCategoryInSet(item.dataset.setId, item.dataset.catId);
      closeSidebar(); // 모바일 드로어에서 선택 시 닫기
    }
  });
  document.getElementById('problem-nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-prob-id]');
    if (btn) {
      const p = findProblemByRawId(btn.dataset.probId);
      if (p) { showProblem(p.id); collapseProblemNav(); }
    }
  });

  // 모바일: 햄버거 드로어 + 문제 번호 접기/펼치기
  document.getElementById('btn-menu').addEventListener('click', openSidebar);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);
  document.getElementById('btn-toggle-nav').addEventListener('click', toggleProblemNav);
  document.getElementById('btn-prev-problem').addEventListener('click', () => stepProblem(-1));
  document.getElementById('btn-next-problem').addEventListener('click', () => stepProblem(1));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });
}

// ===== 모바일 네비게이션 =====
// CSS의 모바일 분기(max-width: 640px)와 기준을 맞춤
function isMobileView() {
  return window.matchMedia('(max-width: 640px)').matches;
}

// 현재 카테고리 안에서 이전/다음 문제로 이동
function stepProblem(delta) {
  const probs = currentViewProblems();
  const idx = probs.findIndex(p => p.id === currentProbId);
  const next = probs[idx + delta];
  if (next) { showProblem(next.id); collapseProblemNav(); }
}

function updateStepButtons() {
  const probs = currentViewProblems();
  const idx = probs.findIndex(p => p.id === currentProbId);
  document.getElementById('btn-prev-problem').disabled = idx <= 0;
  document.getElementById('btn-next-problem').disabled = idx < 0 || idx >= probs.length - 1;
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}

function toggleProblemNav() {
  const nav = document.getElementById('problem-nav');
  const btn = document.getElementById('btn-toggle-nav');
  const expanded = nav.classList.toggle('expanded');
  btn.setAttribute('aria-expanded', String(expanded));
  updateProblemNavToggle();
  if (expanded) {
    const active = nav.querySelector('.prob-btn.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
}

function collapseProblemNav() {
  const nav = document.getElementById('problem-nav');
  nav.classList.remove('expanded');
  document.getElementById('btn-toggle-nav').setAttribute('aria-expanded', 'false');
  updateProblemNavToggle();
}

// 접힘 상태에서도 현재 위치를 알 수 있도록 "21 / 129 ▾" 형태로 표시
function updateProblemNavToggle() {
  const nav = document.getElementById('problem-nav');
  const btn = document.getElementById('btn-toggle-nav');
  const probs = currentViewProblems();
  const idx = probs.findIndex(p => p.id === currentProbId);
  const arrow = nav.classList.contains('expanded') ? '▴' : '▾';
  btn.textContent = `${idx >= 0 ? idx + 1 : 1} / ${probs.length} ${arrow}`;
  updateStepButtons();
}

function startQuiz() {
  if (currentSetId) localStorage.setItem(LS_ACTIVE_SET, currentSetId);
  renderCategoryNav();
  const firstCat = appData.categories.find(c => appData.problems.some(p => p.category === c.id));
  if (firstCat) selectCategory(firstCat.id);
  showScreen('screen-quiz');
}

// 사이드바: 전체 문제집 목록 → 각 문제집의 카테고리 트리
function renderCategoryNav() {
  const nav = document.getElementById('category-nav');
  const index = getSetsIndex();

  nav.innerHTML = index.map(setMeta => {
    let setData, setProg;
    try {
      setData = JSON.parse(localStorage.getItem(setDataKey(setMeta.id)) || 'null');
    } catch { return ''; }
    if (!setData) return '';
    const isActiveSet = setMeta.id === currentSetId;
    setProg = isActiveSet ? progress : JSON.parse(localStorage.getItem(setProgKey(setMeta.id)) || '{}');

    const cats = (setData.categories || []).filter(c => setData.problems.some(p => p.category === c.id));
    const catRows = cats.map(c => {
      const probs = setData.problems.filter(p => p.category === c.id);
      const done  = probs.filter(p => setProg[p.id]).length;
      const isActiveCat = isActiveSet && c.id === currentCatId;
      return `<div class="sidebar-cat-item ${isActiveCat ? 'active' : ''}"
                   data-set-id="${escHtml(setMeta.id)}" data-cat-id="${escHtml(c.id)}">
        <span>${escHtml(c.emoji)} ${escHtml(c.name)}</span>
        <span class="cat-progress">${done}/${probs.length}</span>
      </div>`;
    }).join('');

    // 오답 노트 (틀린 문제가 있을 때만 노출)
    const wrongN = wrongCount(setMeta.id, setData);
    const wrongRow = wrongN > 0
      ? `<div class="sidebar-cat-item wrong-note ${isActiveSet && currentCatId === WRONG_VIEW_ID ? 'active' : ''}"
              data-set-id="${escHtml(setMeta.id)}" data-cat-id="${WRONG_VIEW_ID}">
          <span>❌ 오답 노트</span>
          <span class="cat-progress">${wrongN}</span>
        </div>`
      : '';

    // 즐겨찾기 (별을 단 문제가 있을 때만 노출)
    const favN = favCount(setMeta.id, setData);
    const favRow = favN > 0
      ? `<div class="sidebar-cat-item fav-note ${isActiveSet && currentCatId === FAV_VIEW_ID ? 'active' : ''}"
              data-set-id="${escHtml(setMeta.id)}" data-cat-id="${FAV_VIEW_ID}">
          <span>⭐ 즐겨찾기</span>
          <span class="cat-progress">${favN}</span>
        </div>`
      : '';

    return `<div class="sidebar-set-group">
      <div class="sidebar-set-header ${isActiveSet ? 'active' : ''}">${escHtml(setMeta.name)}</div>
      ${catRows}
      ${favRow}
      ${wrongRow}
    </div>`;
  }).join('');
}

function selectCategoryInSet(setId, catId) {
  if (setId !== currentSetId) {
    const raw = localStorage.getItem(setDataKey(setId));
    if (!raw) return;
    appData = JSON.parse(raw);
    currentSetId = setId;
    progress = JSON.parse(localStorage.getItem(setProgKey(setId)) || '{}');
    wrongIds = readWrong(setId);
    favIds = readFav(setId);
    localStorage.setItem(LS_ACTIVE_SET, setId);
  }
  selectCategory(catId);
}

function selectCategory(catId) {
  currentCatId = catId;
  // 오답 노트는 열 때의 목록을 고정 (푸는 도중 항목이 사라져 순서가 흔들리지 않도록)
  if (catId === WRONG_VIEW_ID) {
    specialViewList = appData.problems.filter(p => wrongIds[p.id]).map(p => p.id);
  } else if (catId === FAV_VIEW_ID) {
    specialViewList = appData.problems.filter(p => favIds[p.id]).map(p => p.id);
  }
  renderCategoryNav();
  renderProblemNav();
  const probs = currentViewProblems();
  const first = probs.find(p => !progress[p.id]) || probs[0];
  if (first) showProblem(first.id);
  else showEmptyView();
}

// 보여줄 문제가 없을 때 (오답 노트를 모두 해결한 경우 등)
function showEmptyView() {
  currentProbId = null;
  document.getElementById('problem-badge').textContent = currentViewLabel();
  document.getElementById('problem-counter').textContent = '0 / 0';
  document.getElementById('problem-question').innerHTML =
    currentCatId === WRONG_VIEW_ID
      ? '<p>🎉 오답 노트가 비었습니다. 틀린 문제를 모두 다시 맞혔어요!</p>'
      : currentCatId === FAV_VIEW_ID
        ? '<p>⭐ 즐겨찾기한 문제가 없습니다. 문제 위의 별을 눌러 추가하세요.</p>'
        : '<p>표시할 문제가 없습니다.</p>';
  document.getElementById('code-wrap').className = 'code-wrap hidden';
  document.getElementById('answer-area').classList.add('hidden');
  document.getElementById('feedback').classList.add('hidden');
  document.getElementById('btn-edit-problem').classList.add('hidden');
  document.getElementById('btn-fav').classList.add('hidden');
}

function renderProblemNav() {
  const probs = currentViewProblems();
  document.getElementById('problem-nav-label').textContent = currentViewLabel();
  document.getElementById('problem-nav').innerHTML = probs.map((p, i) =>
    `<div class="prob-btn ${p.id === currentProbId ? 'active' : ''} ${progress[p.id] ? 'correct' : ''} ${favIds[p.id] ? 'fav' : ''}"
          data-prob-id="${escHtml(String(p.id))}">${i + 1}</div>`
  ).join('');
  updateProblemNavToggle();
}

function showProblem(probId) {
  const p = appData.problems.find(p => p.id === probId);
  if (!p) return;
  currentProbId = probId;

  // 오답 노트를 보고 있으면 뷰를 유지하고, 아니면 문제가 속한 카테고리로 맞춘다
  if (currentCatId !== WRONG_VIEW_ID && currentCatId !== FAV_VIEW_ID) currentCatId = p.category;

  // 빈 화면 상태에서 복귀
  document.getElementById('answer-area').classList.remove('hidden');
  document.getElementById('btn-edit-problem').classList.remove('hidden');
  document.getElementById('btn-fav').classList.remove('hidden');

  renderCategoryNav();
  renderProblemNav();

  const catProbs = currentViewProblems();
  const idx = catProbs.findIndex(pr => pr.id === p.id) + 1;
  const cat = appData.categories.find(c => c.id === p.category);

  document.getElementById('problem-badge').textContent = `${cat?.emoji || ''} ${cat?.name || p.category}`;
  document.getElementById('problem-counter').textContent = `${idx} / ${catProbs.length}`;
  // 채점이 엄격한 문제는 미리 알 수 있게 배지로 표시
  const strictBadge = document.getElementById('strict-badge');
  if (isStrictFormatProblem(p)) {
    strictBadge.textContent = '서식 정확히';
    strictBadge.classList.remove('hidden');
  } else if (isCaseSensitiveProblem(p)) {
    strictBadge.textContent = '대소문자 구분';
    strictBadge.classList.remove('hidden');
  } else {
    strictBadge.classList.add('hidden');
  }
  setMarkdownHtml(document.getElementById('problem-question'), p.question);

  const codeWrap  = document.getElementById('code-wrap');
  const codeEl    = document.getElementById('code-content');
  const langLabel = document.getElementById('code-lang-label');
  if (p.code) {
    codeEl.removeAttribute('data-highlighted');
    codeEl.textContent = p.code;
    codeEl.className = p.language ? `language-${p.language}` : '';
    hljs.highlightElement(codeEl);
    langLabel.textContent = LANG_NAMES[p.language] || p.language || 'Code';
    codeWrap.className = 'code-wrap' + (p.language ? ` lang-${p.language}` : '');
    document.getElementById('btn-copy').classList.remove('copied');
    document.getElementById('btn-copy').textContent = '복사';
  } else {
    codeWrap.className = 'code-wrap hidden';
  }

  const input = document.getElementById('answer-input');
  input.value = '';
  input.disabled = false;
  input.className = '';
  // 모바일에서는 자동 포커스하지 않음 (키보드가 올라오며 화면이 확대·스크롤됨)
  if (!isMobileView()) input.focus();

  document.getElementById('btn-check').disabled = false;
  document.getElementById('feedback').classList.add('hidden');
  const btnExplEl = document.getElementById('btn-explanation');
  btnExplEl.classList.add('hidden');
  btnExplEl.classList.remove('open');
  btnExplEl.textContent = '해설 보기 ▼';
  document.getElementById('explanation-text').classList.add('hidden');
  document.getElementById('btn-next').classList.add('hidden');
  document.getElementById('btn-mark-correct').classList.add('hidden');
  updateFavButton();
  document.getElementById('quiz-main').scrollTop = 0; // 새 문제는 항상 맨 위부터
}

// ===== 정답 비교 =====
// 번호 기호(①②③, ❶❷❸)는 보통 여러 개의 답을 구분하는 라벨이지만,
// "기호로 쓰시오" 유형에서는 기호 자체가 정답이므로 분할 결과가 온전할 때만 라벨로 간주한다.
const ANSWER_MARKER = /[①-⑳❶-❿]/g;

// 괄호·공백·쉼표 차이 무시. 대소문자는 기본적으로 무시하되,
// 코드 문제처럼 대소문자가 의미를 갖는 경우에는 보존한다.
function normalizeAnswer(str, caseSensitive = false) {
  const s = (str || '').replace(/[()（）\s,，]/g, '').trim();
  return caseSensitive ? s : s.toLowerCase();
}

// 줄 앞의 글머리표 제거 ("• ① 기능" → "① 기능")
// -, * 는 뒤에 공백이 있을 때만 제거 ("-8" 같은 정답을 보호)
function stripBullets(str) {
  return str.split(/\r?\n/)
    .map(line => line.replace(/^\s*[•·‣◦∙]+\s*/, '').replace(/^\s*[-*]\s+/, ''))
    .join('\n');
}

// "1." "2)" "(3)" 형태의 라벨 제거 (숫자 뒤 공백을 요구해 "3.14" 같은 값은 보호)
const NUM_LABEL = /^\s*(?:\((\d{1,2})\)|(\d{1,2})[.)])\s+(?=\S)/;

// 답을 항목 단위로 분리 (번호 라벨 기준 → 없으면 줄바꿈/쉼표 기준). 원문 그대로 반환.
function answerItems(str) {
  const s = stripBullets((str || '').trim());
  const marks = s.match(ANSWER_MARKER);
  if (marks && marks.length >= 2) {
    const parts = s.split(ANSWER_MARKER).slice(1).map(x => x.trim());
    // 라벨 사이가 모두 채워져 있을 때만 라벨로 인정 (예: "① ③" 처럼 기호가 답인 경우 제외)
    if (parts.length && parts.every(x => normalizeAnswer(x))) return parts;
  }

  let items = s.split(/\r?\n|[,，]/).map(x => x.trim()).filter(Boolean);
  items = items.map(x => x.replace(NUM_LABEL, ''));

  // 항목들이 "1 기능", "2 비기능" 처럼 1부터 순서대로 시작하면 그 숫자는 라벨로 간주
  // (단일 항목이거나 순번이 아니면 그대로 둬서 "20 개월" 같은 답을 보호)
  const isPlainNumbered = items.length >= 2 &&
    items.every((x, i) => new RegExp(`^${i + 1}\\s+\\S`).test(x));
  if (isPlainNumbered) {
    items = items.map((x, i) => x.replace(new RegExp(`^${i + 1}\\s+`), ''));
  }

  return items.filter(x => normalizeAnswer(x));
}

// 항목 끝에 붙은 괄호는 병기 표기로 본다 ("애자일(Agile)" → 애자일 / Agile 둘 다 정답)
// 수식 속 괄호("( 대기 시간 + 서비스 시간 ) / 서비스 시간", "(30,000 / 300) / 5 = 20")는
// 괄호가 끝에 오지 않으므로 병기로 오인하지 않는다.
function splitTrailingParen(item) {
  const m = (item || '').trim().match(/^(.*\S)\s*[(（]([^()（）]*)[)）]\s*$/);
  if (!m) return null;
  const before = m[1].trim(), inside = m[2].trim();
  return (before && inside) ? { before, inside } : null;
}

// 한 항목이 정답으로 인정받을 수 있는 표기들
function answerVariants(item, caseSensitive) {
  const set = new Set();
  const base = normalizeAnswer(item, caseSensitive);
  if (base) set.add(base);
  const sp = splitTrailingParen(item);
  if (sp) {
    const before = normalizeAnswer(sp.before, caseSensitive);
    const inside = normalizeAnswer(sp.inside, caseSensitive);
    if (before) set.add(before);
    if (inside) set.add(inside);
  }
  return set;
}

// 구분자를 다르게 쓴 경우를 흡수하기 위한 평탄화 형태들
function flatForms(items, caseSensitive) {
  const norm = x => normalizeAnswer(x, caseSensitive);
  const pick = fn => items.map(fn).join('');
  return new Set([
    pick(norm),
    pick(x => { const sp = splitTrailingParen(x); return norm(sp ? sp.before : x); }),
    pick(x => { const sp = splitTrailingParen(x); return norm(sp ? sp.inside : x); }),
  ].filter(Boolean));
}

// 코드 문제는 대소문자가 의미를 가지므로 완화 대상에서 제외한다
const CODE_LANGUAGES = ['c', 'java', 'python', 'sql'];
function isCaseSensitiveProblem(p) {
  if (!p) return false;
  if (p.code) return true;
  return CODE_LANGUAGES.includes(p.language || p.category);
}

// "출력 서식을 준수" 류의 문제는 서식까지 맞아야 하므로 정확 일치로 채점한다
const STRICT_FORMAT_RE = /(출력\s*)?(서식|형식)[을를]?\s*(반드시\s*)?(지켜|준수)/;
function isStrictFormatProblem(p) {
  return STRICT_FORMAT_RE.test(p?.question || '');
}

// 정확 일치용 정규화 (줄 끝 공백·개행 방식만 정리, 대소문자·공백·괄호는 보존)
function normalizeStrict(str) {
  return (str || '').replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim();
}

function isAnswerCorrect(userVal, correctVal, opts = {}) {
  // 하위 호환: 세 번째 인자로 boolean(strict)을 넘기던 호출도 그대로 동작
  const { strict = false, caseSensitive = false } = (typeof opts === 'boolean') ? { strict: opts } : opts;

  if (strict) {
    const u = normalizeStrict(userVal);
    return !!u && u === normalizeStrict(correctVal);
  }
  const a = answerItems(userVal);
  const b = answerItems(correctVal);
  if (!a.length || !b.length) return false;
  // 항목별 비교 (번호 라벨 유무·줄바꿈 차이·괄호 병기 흡수, 순서는 유지)
  if (a.length === b.length &&
      a.every((v, i) => {
        const u = normalizeAnswer(v, caseSensitive);
        return u && answerVariants(b[i], caseSensitive).has(u);
      })) return true;
  // 한 줄로 몰아쓰기 등 구분자 차이 흡수
  const fb = flatForms(b, caseSensitive);
  return [...flatForms(a, caseSensitive)].some(v => fb.has(v));
}

function checkAnswer() {
  const p = appData.problems.find(p => p.id === currentProbId);
  if (!p) return;

  const input = document.getElementById('answer-input');
  const userVal = input.value;
  if (!userVal.trim()) return;

  const strict = isStrictFormatProblem(p);
  const caseSensitive = isCaseSensitiveProblem(p);
  const correct = isAnswerCorrect(userVal, p.answer, { strict, caseSensitive });
  const result   = document.getElementById('feedback-result');
  const feedback = document.getElementById('feedback');
  const btnExpl  = document.getElementById('btn-explanation');
  const btnNext  = document.getElementById('btn-next');

  input.disabled = true;
  input.classList.add(correct ? 'correct' : 'wrong');
  document.getElementById('btn-check').disabled = true;

  result.className = 'feedback-result ' + (correct ? 'correct' : 'wrong');
  result.textContent = correct
    ? '✅ 정답!'
    : `❌ 틀렸어요 — 정답: ${p.answer}` +
      (strict ? '\n(출력 서식까지 정확히 일치해야 하는 문제예요)'
              : caseSensitive ? '\n(코드 문제라 대소문자까지 구분해서 채점해요)' : '');

  feedback.classList.remove('hidden');
  if (!correct && p.explanation) btnExpl.classList.remove('hidden');
  btnNext.classList.remove('hidden');
  // 채점은 틀렸지만 본인 판단으로 맞다고 볼 수 있게 (표기 차이 등)
  document.getElementById('btn-mark-correct').classList.toggle('hidden', correct);

  if (correct) {
    progress[p.id] = true;
    if (currentSetId) localStorage.setItem(setProgKey(currentSetId), JSON.stringify(progress));
    // 오답 노트에 있던 문제를 맞히면 즉시 제거
    if (wrongIds[p.id]) {
      delete wrongIds[p.id];
      saveWrong();
      if (currentCatId === WRONG_VIEW_ID) {
        result.textContent = '✅ 정답! — 오답 노트에서 제외됐어요';
      }
    }
  } else {
    wrongIds[p.id] = true;
    saveWrong();
  }
  renderCategoryNav();
  renderProblemNav();
}

function toggleExplanation() {
  const expl = document.getElementById('explanation-text');
  const btn  = document.getElementById('btn-explanation');
  const p    = appData.problems.find(p => p.id === currentProbId);
  const isOpen = !expl.classList.contains('hidden');
  if (isOpen) {
    expl.classList.add('hidden');
    btn.textContent = '해설 보기 ▼';
    btn.classList.remove('open');
  } else {
    setMarkdownHtml(expl, p?.explanation);
    expl.classList.remove('hidden');
    btn.textContent = '해설 닫기 ▲';
    btn.classList.add('open');
  }
}

// ===== 즐겨찾기 =====
function toggleFavorite() {
  if (currentProbId == null) return;
  if (favIds[currentProbId]) delete favIds[currentProbId];
  else favIds[currentProbId] = true;
  saveFav();
  updateFavButton();
  renderCategoryNav();
}

function updateFavButton() {
  const btn = document.getElementById('btn-fav');
  const on = currentProbId != null && !!favIds[currentProbId];
  btn.textContent = on ? '★' : '☆';
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? '즐겨찾기 해제' : '즐겨찾기';
}

// 사용자가 직접 정답으로 인정 (채점 기준과 다르게 쓴 경우 등)
function markAnswerCorrect() {
  const p = appData.problems.find(p => p.id === currentProbId);
  if (!p) return;

  progress[p.id] = true;
  if (currentSetId) localStorage.setItem(setProgKey(currentSetId), JSON.stringify(progress));

  const wasWrong = !!wrongIds[p.id];
  if (wasWrong) {
    delete wrongIds[p.id];
    saveWrong();
  }

  const result = document.getElementById('feedback-result');
  result.className = 'feedback-result correct';
  result.textContent = '✅ 정답 처리했어요' + (wasWrong ? ' — 오답 노트에서 제외됐어요' : '');

  const input = document.getElementById('answer-input');
  input.classList.remove('wrong');
  input.classList.add('correct');

  document.getElementById('btn-mark-correct').classList.add('hidden');
  renderCategoryNav();
  renderProblemNav();
}

function goNextProblem() {
  const catProbs = currentViewProblems();
  const idx = catProbs.findIndex(p => p.id === currentProbId);
  const next = catProbs[idx + 1];
  if (next) showProblem(next.id);
  else alert('이 카테고리의 마지막 문제입니다! 🎉');
}

function downloadCurrentSetJSON() {
  if (!currentSetId) return;
  const meta = getSetsIndex().find(s => s.id === currentSetId);
  const name = meta?.name || '문제집';
  // 다른 기기에서도 그림이 보이도록 참조된 이미지를 함께 담는다
  const images = {};
  for (const id of imageRefsInSet(appData)) {
    if (imageCache[id]) images[id] = imageCache[id];
  }
  const payload = Object.keys(images).length ? { ...appData, images } : appData;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ===== PDF 출력 =====
function openPrintModal() {
  if (!currentCatId) return;
  const probs = currentViewProblems();
  document.getElementById('print-modal-desc').textContent =
    `${currentViewLabel()} · ${probs.length}문제를 PDF로 출력합니다.`;
  document.getElementById('print-include-answers').checked = false;
  document.getElementById('print-modal').classList.remove('hidden');
}

function closePrintModal() {
  document.getElementById('print-modal').classList.add('hidden');
}

function runPrint() {
  const includeAnswers = document.getElementById('print-include-answers').checked;
  buildPrintArea(includeAnswers);
  closePrintModal();
  setTimeout(() => window.print(), 50);
}

function buildPrintArea(includeAnswers) {
  const probs = currentViewProblems();
  const setMeta = getSetsIndex().find(s => s.id === currentSetId);
  const setName = setMeta?.name || '문제집';
  const date = new Date().toLocaleDateString('ko-KR');

  const problemsHtml = probs.map((p, i) => `
    <div class="print-problem">
      <div class="print-q-num">${i + 1}.</div>
      <div class="print-q-body">
        <div class="print-question">${renderMarkdown(p.question)}</div>
        ${p.code ? `<pre class="print-code">${escHtml(p.code)}</pre>` : ''}
        ${includeAnswers ? `
          <div class="print-answer"><strong>정답:</strong> ${escHtml(p.answer || '')}</div>
          ${p.explanation ? `<div class="print-explanation">${renderMarkdown(p.explanation)}</div>` : ''}
        ` : ''}
      </div>
    </div>
  `).join('');

  document.getElementById('print-area').innerHTML = `
    <div class="print-header">
      <h1>${escHtml(setName)} — ${escHtml(currentViewLabel())}</h1>
      <div class="print-meta">총 ${probs.length}문제 · ${date}</div>
    </div>
    ${problemsHtml}
  `;
}

function copyCode() {
  const p = appData.problems.find(p => p.id === currentProbId);
  if (!p?.code) return;
  navigator.clipboard.writeText(p.code).then(() => {
    const btn = document.getElementById('btn-copy');
    btn.textContent = '복사됨 ✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '복사'; btn.classList.remove('copied'); }, 1500);
  });
}

// ===== UTILS =====
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
