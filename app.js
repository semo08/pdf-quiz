marked.setOptions({ breaks: true });

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
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ai-prompt-text').textContent = AI_PARSING_PROMPT;

  initUploadScreen();
  initReviewScreen();
  initQuizScreen();

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
        startQuiz();
        return;
      } catch {}
    }
  }
  renderSavedSets();
});

// ===== SCREEN HELPERS =====
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
    return `<div class="saved-set-item" onclick="loadSet('${s.id}')">
      <div class="saved-set-info">
        <div class="saved-set-name">${escHtml(s.name)}</div>
        <div class="saved-set-meta">${total}문제 · ${date}</div>
      </div>
      <span class="saved-set-pct">${pct}%</span>
      <button class="btn-del-set" onclick="deleteSetEntry(event,'${s.id}')">×</button>
    </div>`;
  }).join('');
}

function loadSet(setId) {
  const raw = localStorage.getItem(setDataKey(setId));
  if (!raw) { alert('데이터를 불러올 수 없습니다.'); return; }
  appData = JSON.parse(raw);
  currentSetId = setId;
  progress = JSON.parse(localStorage.getItem(setProgKey(setId)) || '{}');
  startQuiz();
}

function deleteSetEntry(e, setId) {
  e.stopPropagation();
  if (!confirm('이 문제집을 삭제할까요?')) return;
  saveSetsIndex(getSetsIndex().filter(s => s.id !== setId));
  localStorage.removeItem(setDataKey(setId));
  localStorage.removeItem(setProgKey(setId));
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
  listEl.innerHTML = selectedPDFFiles.map(f => `<div class="file-ok">✓ ${f.name}</div>`).join('');
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

    const setId = uid();
    const name = file.name.replace('.json', '');
    const index = getSetsIndex();
    index.push({ id: setId, name, createdAt: Date.now(), problemCount: data.problems.length });
    saveSetsIndex(index);
    localStorage.setItem(setDataKey(setId), JSON.stringify(data));

    appData = data;
    currentSetId = setId;
    progress = {};
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
      <td>${cat?.emoji || ''} ${cat?.name || p.category}</td>
      <td title="${escHtml(p.question || '')}">${escHtml(qPreview)}${p.question?.length > 60 ? '…' : ''}</td>
      <td class="td-code">${p.code ? '있음' : '—'}</td>
      <td>${escHtml(p.answer || '—')}</td>
      <td class="${p.explanation ? 'badge-yes' : 'badge-no'}">${p.explanation ? '있음' : '—'}</td>
      <td><button class="btn-edit-row" onclick="openEditModal(${p.id})">편집</button></td>
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
    document.querySelector(`[onclick="toggleEditPreview('${field}')"]`).textContent = '미리보기';
  });
  document.getElementById('edit-modal').classList.remove('hidden');
}

function toggleEditPreview(field) {
  const textarea = document.getElementById(`edit-${field}`);
  const preview  = document.getElementById(`edit-${field}-preview`);
  const btn      = document.querySelector(`[onclick="toggleEditPreview('${field}')"]`);
  const isPreview = !preview.classList.contains('hidden');
  if (isPreview) {
    preview.classList.add('hidden');
    textarea.classList.remove('hidden');
    btn.textContent = '미리보기';
  } else {
    preview.innerHTML = marked.parse(textarea.value || '');
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
    renderProblemNav(currentCatId);
    const probs = appData.problems.filter(p => p.category === currentCatId);
    if (probs.length) showProblem(probs[0].id);
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
  document.getElementById('btn-back-upload').addEventListener('click', () => {
    localStorage.removeItem(LS_ACTIVE_SET);
    resetUploadScreen();
    showScreen('screen-upload');
    renderSavedSets();
  });
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
                   onclick="selectCategoryInSet('${setMeta.id}','${c.id}')">
        <span>${c.emoji} ${c.name}</span>
        <span class="cat-progress">${done}/${probs.length}</span>
      </div>`;
    }).join('');

    return `<div class="sidebar-set-group">
      <div class="sidebar-set-header ${isActiveSet ? 'active' : ''}">${escHtml(setMeta.name)}</div>
      ${catRows}
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
    localStorage.setItem(LS_ACTIVE_SET, setId);
  }
  selectCategory(catId);
}

function selectCategory(catId) {
  currentCatId = catId;
  renderCategoryNav();
  renderProblemNav(catId);
  const probs = appData.problems.filter(p => p.category === catId);
  const first = probs.find(p => !progress[p.id]) || probs[0];
  if (first) showProblem(first.id);
}

function renderProblemNav(catId) {
  const probs = appData.problems.filter(p => p.category === catId);
  const cat   = appData.categories.find(c => c.id === catId);
  document.getElementById('problem-nav-label').textContent = cat?.name || '';
  document.getElementById('problem-nav').innerHTML = probs.map((p, i) =>
    `<div class="prob-btn ${p.id === currentProbId ? 'active' : ''} ${progress[p.id] ? 'correct' : ''}"
          onclick="showProblem(${p.id})">${i + 1}</div>`
  ).join('');
}

function showProblem(probId) {
  const p = appData.problems.find(p => p.id === probId);
  if (!p) return;
  currentProbId = probId;

  renderCategoryNav();
  renderProblemNav(p.category);

  const catProbs = appData.problems.filter(pr => pr.category === p.category);
  const idx = catProbs.findIndex(pr => pr.id === p.id) + 1;
  const cat = appData.categories.find(c => c.id === p.category);

  document.getElementById('problem-badge').textContent = `${cat?.emoji || ''} ${cat?.name || p.category}`;
  document.getElementById('problem-counter').textContent = `${idx} / ${catProbs.length}`;
  document.getElementById('problem-question').innerHTML = marked.parse(p.question || '');

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
  input.focus();

  document.getElementById('btn-check').disabled = false;
  document.getElementById('feedback').classList.add('hidden');
  const btnExplEl = document.getElementById('btn-explanation');
  btnExplEl.classList.add('hidden');
  btnExplEl.classList.remove('open');
  btnExplEl.textContent = '해설 보기 ▼';
  document.getElementById('explanation-text').classList.add('hidden');
  document.getElementById('btn-next').classList.add('hidden');
}

function normalizeAnswer(str) {
  return (str || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[()（）\s]/g, '');
}

function checkAnswer() {
  const p = appData.problems.find(p => p.id === currentProbId);
  if (!p) return;

  const input = document.getElementById('answer-input');
  const userVal = input.value;
  if (!userVal.trim()) return;

  const correct = normalizeAnswer(userVal) === normalizeAnswer(p.answer);
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
    : `❌ 틀렸어요 — 정답: ${p.answer}`;

  feedback.classList.remove('hidden');
  if (!correct && p.explanation) btnExpl.classList.remove('hidden');
  btnNext.classList.remove('hidden');

  if (correct) {
    progress[p.id] = true;
    if (currentSetId) localStorage.setItem(setProgKey(currentSetId), JSON.stringify(progress));
    renderCategoryNav();
    renderProblemNav(p.category);
  }
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
    expl.innerHTML = marked.parse(p?.explanation || '');
    expl.classList.remove('hidden');
    btn.textContent = '해설 닫기 ▲';
    btn.classList.add('open');
  }
}

function goNextProblem() {
  const catProbs = appData.problems.filter(p => p.category === currentCatId);
  const idx = catProbs.findIndex(p => p.id === currentProbId);
  const next = catProbs[idx + 1];
  if (next) showProblem(next.id);
  else alert('이 카테고리의 마지막 문제입니다! 🎉');
}

function downloadCurrentSetJSON() {
  if (!currentSetId) return;
  const meta = getSetsIndex().find(s => s.id === currentSetId);
  const name = meta?.name || '문제집';
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.json';
  a.click();
  URL.revokeObjectURL(url);
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
