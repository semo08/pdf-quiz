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
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  editingProbId = null;
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
  closeModal();
  renderReviewTable();
}

function deleteProblem() {
  if (!confirm('이 문제를 삭제할까요?')) return;
  appData.problems = appData.problems.filter(p => p.id !== editingProbId);
  closeModal();
  renderReviewTable();
}

function saveAndStart() {
  const nameInput = document.getElementById('set-name-input');
  const name = nameInput?.value.trim() || '정처기-실기-문제집';

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
    if (e.key === 'Enter') checkAnswer();
  });
  document.getElementById('btn-explanation').addEventListener('click', toggleExplanation);
  document.getElementById('btn-next').addEventListener('click', goNextProblem);
  document.getElementById('btn-back-upload').addEventListener('click', () => {
    localStorage.removeItem(LS_ACTIVE_SET);
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

function renderCategoryNav() {
  const nav = document.getElementById('category-nav');
  nav.innerHTML = appData.categories
    .filter(c => appData.problems.some(p => p.category === c.id))
    .map(c => {
      const probs = appData.problems.filter(p => p.category === c.id);
      const done  = probs.filter(p => progress[p.id]).length;
      return `<div class="cat-item ${c.id === currentCatId ? 'active' : ''}"
               onclick="selectCategory('${c.id}')">
        <span>${c.emoji} ${c.name}</span>
        <span class="cat-progress">${done}/${probs.length}</span>
      </div>`;
    }).join('');
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
  const cat = appData.categories.find(c => c.id === catId);
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

  renderProblemNav(p.category);

  const catProbs = appData.problems.filter(pr => pr.category === p.category);
  const idx = catProbs.findIndex(pr => pr.id === p.id) + 1;
  const cat = appData.categories.find(c => c.id === p.category);

  document.getElementById('problem-badge').textContent = `${cat?.emoji || ''} ${cat?.name || p.category}`;
  document.getElementById('problem-counter').textContent = `${idx} / ${catProbs.length}`;
  document.getElementById('problem-question').textContent = p.question || '';

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
  document.getElementById('btn-explanation').classList.add('hidden');
  document.getElementById('explanation-text').classList.add('hidden');
  document.getElementById('btn-explanation').classList.remove('open');
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
    expl.textContent = p?.explanation || '';
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
