// PDF 파싱 모듈 — pdf.js CDN 사용

const CATEGORY_MAP = [
  { pattern: /_01_/,            id: 'keyword',  name: '키워드 찾기', emoji: '📝', language: null },
  { pattern: /_02_SQL/i,        id: 'sql',      name: 'SQL',         emoji: '🗄',  language: 'sql' },
  { pattern: /_03_.*제어문/,    id: 'c_ctrl',   name: '제어문 (C)',  emoji: '⚙️', language: 'c' },
  { pattern: /_04_.*포인터/,    id: 'c_ptr',    name: '포인터 (C)',  emoji: '🔷', language: 'c' },
  { pattern: /_05_.*구조체/,    id: 'c_struct', name: '구조체 (C)',  emoji: '📦', language: 'c' },
  { pattern: /_06_.*함수/,      id: 'c_func',   name: '사용자함수',  emoji: '🔧', language: 'c' },
  { pattern: /_07_.*JAVA/i,     id: 'java',     name: 'JAVA',        emoji: '☕', language: 'java' },
  { pattern: /_08_.*Python/i,   id: 'python',   name: 'Python',      emoji: '🐍', language: 'python' },
];

const ALL_CATEGORIES = CATEGORY_MAP.map(({ id, name, emoji, language }) => ({ id, name, emoji, language }));

function detectCategory(filename) {
  for (const cat of CATEGORY_MAP) {
    if (cat.pattern.test(filename)) return cat;
  }
  return { id: 'keyword', name: '기타', emoji: '📄', language: null };
}

// pdf.js로 PDF 텍스트 추출 (줄 단위로 복원)
async function extractLinesFromPDF(file, onProgress) {
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const lines = groupIntoLines(tc.items);
    allLines.push(...lines);
    if (onProgress) onProgress(p / pdf.numPages);
  }

  return allLines;
}

// 텍스트 아이템을 y좌표 기준으로 줄로 묶기
function groupIntoLines(items) {
  if (!items.length) return [];

  const rowMap = new Map();
  for (const item of items) {
    const rawY = item.transform[5];
    // 같은 줄로 볼 y 범위: ±2px
    let key = null;
    for (const k of rowMap.keys()) {
      if (Math.abs(k - rawY) <= 2) { key = k; break; }
    }
    if (key === null) { key = rawY; rowMap.set(key, []); }
    rowMap.get(key).push({ x: item.transform[4], str: item.str });
  }

  // y 내림차순 정렬 (PDF 좌표계: 아래가 0)
  return [...rowMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) =>
      items.sort((a, b) => a.x - b.x).map(i => i.str).join('')
    )
    .filter(l => l.trim() !== '');
}

// 줄 배열에서 문제 파싱
function parseProblems(lines, categoryId, language) {
  const problems = [];
  // 문제 시작: 숫자 + 마침표 + 공백 (예: "1. ", "12. ")
  const PROB_START = /^(\d+)\.\s/;

  // 문제별로 청크 분리
  const chunks = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(PROB_START);
    if (m) {
      if (current) chunks.push(current);
      current = { num: parseInt(m[1]), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    const prob = extractProblemParts(chunk.lines, categoryId, language);
    if (prob) {
      prob.num = chunk.num;
      problems.push(prob);
    }
  }

  return problems;
}

// 하나의 문제 청크에서 질문/코드/정답/해설 추출
function extractProblemParts(lines, categoryId, language) {
  const isCode = ['c_ctrl', 'c_ptr', 'c_struct', 'c_func', 'java', 'python', 'sql'].includes(categoryId);

  const codeStartKeywords = [
    '#include', 'public class', 'public static', 'class ', 'int main',
    'void main', 'def ', 'SELECT ', 'select ', 'CREATE ', 'INSERT ', 'DELETE ',
    'UPDATE ', 'DROP ', 'ALTER ',
  ];

  let questionLines = [];
  let codeLines = [];
  let answer = '';
  let explanationLines = [];

  let mode = 'question'; // question → code → answer → explanation

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 해설 구간: [ 로 시작하거나 [풀이] 패턴
    if (/^\[/.test(trimmed) && mode !== 'explanation') {
      mode = 'explanation';
      explanationLines.push(trimmed.replace(/^\[|\]$/g, ''));
      continue;
    }
    if (mode === 'explanation') {
      explanationLines.push(trimmed);
      continue;
    }

    // "답" 단독 줄은 정답 레이블 — 건너뜀
    if (/^답\s*$/.test(trimmed)) continue;

    // 정답 구간: ": 값" 또는 "답 : 값" 형태 (code/question 모드 모두)
    const answerMatch = trimmed.match(/^(?:답\s*)?:\s*(.+)$/);
    if (answerMatch && (mode === 'code' || mode === 'question')) {
      answer = answerMatch[1].trim();
      mode = 'answer';
      continue;
    }
    // 정답이 같은 줄 끝에 인라인 (키워드 문제: "질문 : 정답")
    if (mode === 'question' && !isCode) {
      const inlineAnswer = trimmed.match(/\s:\s*(.+)$/);
      if (inlineAnswer) {
        questionLines.push(trimmed.replace(/\s:\s*.+$/, '').trim());
        answer = inlineAnswer[1].trim();
        mode = 'answer';
        continue;
      }
    }

    // 코드 구간 시작 감지
    if (mode === 'question' && isCode) {
      const isCodeLine = codeStartKeywords.some(kw => trimmed.startsWith(kw)) ||
        /[{};]/.test(trimmed) ||
        /^\s{2,}/.test(line);
      if (isCodeLine) {
        mode = 'code';
      }
    }

    if (mode === 'question') questionLines.push(trimmed);
    else if (mode === 'code') codeLines.push(line); // 코드는 원본 들여쓰기 유지
    else if (mode === 'answer') {
      // 정답 이후 추가 텍스트는 해설로
      explanationLines.push(trimmed);
    }
  }

  // 코드 문제인데 정답을 못 찾은 경우: 마지막 짧은 줄을 정답으로 시도
  if (!answer && isCode) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const t = lines[i].trim();
      if (t && t.length < 30 && !/^\[/.test(t)) {
        answer = t.replace(/^[:\s]+/, '').trim();
        break;
      }
    }
  }

  const question = questionLines
    .join('\n')
    .replace(/^\d+\.\s*/, '')  // 첫 줄 문제 번호 제거
    .trim();

  return {
    question: question || '(문제 내용 확인 필요)',
    code: codeLines.join('\n').trim() || null,
    answer: answer || '(정답 확인 필요)',
    explanation: explanationLines.join('\n').trim() || null,
  };
}

// 전체 PDF 파싱 진입점
// onProgress(0~1): 진행률 콜백
// returns: { categories, problems }
async function parsePDFFiles(files, onProgress) {
  const problems = [];
  let globalId = 1;

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const cat = detectCategory(file.name);

    const fileStart = fi / files.length;
    const fileEnd = (fi + 1) / files.length;

    const lines = await extractLinesFromPDF(file, (pct) => {
      if (onProgress) onProgress(fileStart + pct * (fileEnd - fileStart));
    });

    const parsed = parseProblems(lines, cat.id, cat.language);

    for (const p of parsed) {
      problems.push({
        id: globalId++,
        num: p.num,
        category: cat.id,
        language: cat.language,
        question: p.question,
        code: p.code,
        answer: p.answer,
        explanation: p.explanation,
      });
    }
  }

  return { categories: ALL_CATEGORIES, problems };
}
