// ===== STATE =====
let appData = { categories: [], problems: [] };
let progress = {};       // { problemId: true } — 맞은 문제 기록
let currentCatId = null;
let currentProbId = null;
let editingProbId = null;

const LS_DATA = 'jegi-data';
const LS_PROGRESS = 'jegi-progress';

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  initUploadScreen();
  initReviewScreen();
  initQuizScreen();

  // 이전 세션 캐시 확인
  const cached = localStorage.getItem(LS_DATA);
  if (cached) {
    try {
      appData = JSON.parse(cached);
      progress = JSON.parse(localStorage.getItem(LS_PROGRESS) || '{}');
      document.getElementById('btn-continue').classList.remove('hidden');
    } catch { localStorage.removeItem(LS_DATA); }
  }
});

// ===== SCREEN HELPERS =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===== SCREEN 1: UPLOAD =====
function initUploadScreen() {
  const dropPDF  = document.getElementById('drop-pdf');
  const inputPDF = document.getElementById('input-pdf');
  const dropJSON = document.getElementById('drop-json');
  const inputJSON= document.getElementById('input-json');
  const btnContinue = document.getElementById('btn-continue');
  const btnParse = document.getElementById('btn-parse');

  // PDF 클릭/드롭
  dropPDF.addEventListener('click', () => inputPDF.click());
  inputPDF.addEventListener('change', () => handlePDFFiles(inputPDF.files));
  dropPDF.addEventListener('dragover', e => { e.preventDefault(); dropPDF.classList.add('dragover'); });
  dropPDF.addEventListener('dragleave', () => dropPDF.classList.remove('dragover'));
  dropPDF.addEventListener('drop', e => {
    e.preventDefault();
    dropPDF.classList.remove('dragover');
    handlePDFFiles(e.dataTransfer.files);
  });

  // JSON 클릭/드롭
  dropJSON.addEventListener('click', () => inputJSON.click());
  inputJSON.addEventListener('change', () => handleJSONFile(inputJSON.files[0]));
  dropJSON.addEventListener('dragover', e => { e.preventDefault(); dropJSON.classList.add('dragover'); });
  dropJSON.addEventListener('dragleave', () => dropJSON.classList.remove('dragover'));
  dropJSON.addEventListener('drop', e => {
    e.preventDefault();
    dropJSON.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleJSONFile(e.dataTransfer.files[0]);
  });

  btnParse.addEventListener('click', e => { e.stopPropagation(); startParsing(); });
  btnContinue.addEventListener('click', () => {
    progress = JSON.parse(localStorage.getItem(LS_PROGRESS) || '{}');
    startQuiz();
  });
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

  listEl.innerHTML = selectedPDFFiles.map(f =>
    `<div class="file-ok">✓ ${f.name}</div>`
  ).join('');
  btnParse.classList.remove('hidden');
}

async function handleJSONFile(file) {
  if (!file || !file.name.endsWith('.json')) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.problems || !data.categories) throw new Error('형식 오류');
    appData = data;
    progress = {};
    localStorage.setItem(LS_DATA, JSON.stringify(appData));
    localStorage.removeItem(LS_PROGRESS);
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

  // 모달 버튼
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

  p.category = document.getElementById('edit-category').value;
  p.question  = document.getElementById('edit-question').value.trim();
  p.code      = document.getElementById('edit-code').value.trim() || null;
  p.answer    = document.getElementById('edit-answer').value.trim();
  p.explanation = document.getElementById('edit-explanation').value.trim() || null;

  // 언어도 카테고리에 맞게 업데이트
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
  // JSON 저장
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '정처기-실기-문제집.json';
  a.click();
  URL.revokeObjectURL(url);

  // localStorage에도 저장
  localStorage.setItem(LS_DATA, JSON.stringify(appData));
  progress = {};
  localStorage.removeItem(LS_PROGRESS);

  startQuiz();
}

// ===== SCREEN 3: QUIZ =====
function initQuizScreen() {
  document.getElementById('btn-check').addEventListener('click', checkAnswer);
  document.getElementById('answer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') checkAnswer();
  });
  document.getElementById('btn-explanation').addEventListener('click', toggleExplanation);
  document.getElementById('btn-next').addEventListener('click', goNextProblem);
  document.getElementById('btn-back-upload').addEventListener('click', () => showScreen('screen-upload'));
}

function startQuiz() {
  renderCategoryNav();
  // 첫 카테고리의 첫 문제 선택
  const firstCat = appData.categories.find(c =>
    appData.problems.some(p => p.category === c.id)
  );
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

  // 해당 카테고리의 첫 번째 미완료 문제, 없으면 첫 번째 문제
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

  // 문제 번호 네비 업데이트
  renderProblemNav(p.category);

  // 문제 카운터
  const catProbs = appData.problems.filter(pr => pr.category === p.category);
  const idx = catProbs.findIndex(pr => pr.id === p.id) + 1;
  const cat = appData.categories.find(c => c.id === p.category);

  document.getElementById('problem-badge').textContent = `${cat?.emoji || ''} ${cat?.name || p.category}`;
  document.getElementById('problem-counter').textContent = `${idx} / ${catProbs.length}`;
  document.getElementById('problem-question').textContent = p.question || '';

  // 코드 블록
  const codeWrap = document.getElementById('code-wrap');
  const codeEl   = document.getElementById('code-content');
  if (p.code) {
    codeEl.textContent = p.code;
    codeEl.className = p.language ? `language-${p.language}` : '';
    hljs.highlightElement(codeEl);
    codeWrap.classList.remove('hidden');
  } else {
    codeWrap.classList.add('hidden');
  }

  // 입력 초기화
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
  const result = document.getElementById('feedback-result');
  const feedback = document.getElementById('feedback');
  const btnExpl = document.getElementById('btn-explanation');
  const btnNext = document.getElementById('btn-next');

  input.disabled = true;
  input.classList.add(correct ? 'correct' : 'wrong');
  document.getElementById('btn-check').disabled = true;

  result.className = 'feedback-result ' + (correct ? 'correct' : 'wrong');
  result.textContent = correct
    ? '✅ 정답!'
    : `❌ 틀렸어요 — 정답: ${p.answer}`;

  feedback.classList.remove('hidden');

  if (!correct && p.explanation) {
    btnExpl.classList.remove('hidden');
  }
  btnNext.classList.remove('hidden');

  if (correct) {
    progress[p.id] = true;
    localStorage.setItem(LS_PROGRESS, JSON.stringify(progress));
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

// ===== UTILS =====
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
