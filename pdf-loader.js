// pdf.js 4.x는 ESM 전용이라 모듈로 불러와 전역에 노출한다.
// (CSP에서 인라인 스크립트를 금지했으므로 별도 파일로 분리)
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
