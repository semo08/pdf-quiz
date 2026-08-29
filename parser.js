// PDF 파싱 모듈 — pdf.js CDN 사용

const CATEGORY_MAP = [
  { pattern: /_08_.*Python/i,          id: 'python', name: 'Python',     emoji: '🐍', language: 'python' },
  { pattern: /_(03|04|05|06)_/,        id: 'c',      name: 'C',          emoji: '⚙️', language: 'c' },
  { pattern: /_02_SQL/i,               id: 'sql',    name: 'SQL',        emoji: '🗄',  language: 'sql' },
  { pattern: /_07_.*JAVA/i,            id: 'java',   name: 'Java',       emoji: '☕', language: 'java' },
  { pattern: /_01_/,                   id: 'plain',  name: 'Plain text', emoji: '📝', language: null },
];

const ALL_CATEGORIES = CATEGORY_MAP.map(({ id, name, emoji, language }) => ({ id, name, emoji, language }));

function detectCategory(filename) {
  for (const cat of CATEGORY_MAP) {
    if (cat.pattern.test(filename)) return cat;
  }
  return { id: 'plain', name: 'Plain text', emoji: '📝', language: null };
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

// 텍스트 아이템을 y좌표 기준으로 줄로 묶기 (x 간격으로 공백 복원)
function groupIntoLines(items) {
  if (!items.length) return [];

  const rowMap = new Map();
  for (const item of items) {
    const rawY = item.transform[5];
    let key = null;
    for (const k of rowMap.keys()) {
      if (Math.abs(k - rawY) <= 2) { key = k; break; }
    }
    if (key === null) { key = rawY; rowMap.set(key, []); }
    rowMap.get(key).push({
      x: item.transform[4],
      str: item.str,
      w: item.width * Math.abs(item.transform[0]),
    });
  }

  // y 내림차순 정렬 후 각 줄 x 정렬
  const rows = [...rowMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, lineItems]) => {
      lineItems.sort((a, b) => a.x - b.x);
      return lineItems;
    });

  // 전체 문서 기준 평균 문자 너비
  let totalW = 0, totalChars = 0;
  for (const row of rows) {
    for (const it of row) {
      if (it.str.trim().length >= 2 && it.w > 0) {
        totalW += it.w; totalChars += it.str.length;
      }
    }
  }
  const charW = totalChars > 0 ? totalW / totalChars : 8;

  // 모든 줄의 첫 비공백 아이템 중 최솟값 → 들여쓰기 기준 x
  let baseX = Infinity;
  for (const row of rows) {
    const first = row.find(it => it.str.trim().length > 0);
    if (first) baseX = Math.min(baseX, first.x);
  }
  if (!isFinite(baseX)) baseX = 0;

  return rows.map(lineItems => {
    if (!lineItems.length) return '';

    let result = '';
    let prevEndX = null;

    for (const item of lineItems) {
      if (prevEndX === null) {
        // 첫 토큰: baseX 기준으로 들여쓰기 추가
        const indent = item.x - baseX;
        if (indent > charW * 0.5) {
          result += ' '.repeat(Math.max(0, Math.round(indent / charW)));
        }
      } else {
        // 이후 토큰: 이전 토큰 끝과의 간격
        const gap = item.x - prevEndX;
        if (gap > charW * 0.4) {
          result += ' '.repeat(Math.max(1, Math.round(gap / charW)));
        }
      }
      result += item.str;
      prevEndX = item.x + (item.w > 0 ? item.w : item.str.length * charW);
    }

    return result || lineItems.map(i => i.str).join('');
  }).filter(l => l.trim() !== '');
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
  const isCode = ['c', 'java', 'python', 'sql'].includes(categoryId);

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
    .replace(/^\d+\.\s*/, '')
    .trim();

  // 코드 공통 들여쓰기 제거 + 들여쓰기 단위를 2칸으로 정규화
  if (codeLines.length > 0) {
    const nonEmpty = codeLines.filter(l => l.trim().length > 0);
    if (nonEmpty.length > 0) {
      // 1. 공통 최소 들여쓰기 제거
      const minIndent = Math.min(...nonEmpty.map(l => (l.match(/^( *)/) || ['', ''])[1].length));
      if (minIndent > 0) codeLines = codeLines.map(l => l.slice(minIndent));

      // 2. 들여쓰기 단위 감지 (가장 작은 비-0 들여쓰기)
      const indents = nonEmpty
        .map(l => (l.match(/^( *)/) || ['', ''])[1].length)
        .filter(n => n > 0);
      if (indents.length > 0) {
        const unit = Math.min(...indents);
        if (unit !== 2) {
          // 각 줄의 들여쓰기를 2칸 단위로 변환
          codeLines = codeLines.map(l => {
            const spaces = (l.match(/^( *)/) || ['', ''])[1].length;
            const level = Math.round(spaces / unit);
            return ' '.repeat(level * 2) + l.trimStart();
          });
        }
      }
    }
  }

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
