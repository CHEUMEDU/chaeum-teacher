// ============================================================
// 채움학원 — AI 답지 자동 검수 API (Vercel Serverless Function)
// 파일 경로: chaeum-teacher/api/ai-extract.js
// ============================================================
// 버전 이력
// ─────────────────────────────────────────
// v22.8 (2026-05-15) — GPT 비활성 메타 명시 + 답지/시험지 혼동 안전장치
//   · gpt 결과에 disabled/attempts=0 명시 → GAS 가 Gemini+Claude 2모델 기준으로 판단
//   · PDF가 정답지가 아니라 시험지로 보이면 answers 를 추측하지 않고 notAnswerKey 오류 반환
//
// v22.9 (2026-06-04) — Claude 모델 fallback + 모델 오류 재시도
//   · 배포 환경변수 ANTHROPIC_MODEL 우선 사용, 실패 시 공식 Sonnet 4/3.7 후보로 재시도
//   · 잘못된 Claude 모델명 때문에 AI 추출 전체가 PENDING 되는 상황 차단
//
// v22.2 (2026-04-28)  — Node Runtime Express-style 로 전환 (작동 복구)
//   · 이전 (v22.1): Web API (new Response) 사용 → Node Runtime 에서 빈 응답
//   · 변경: req/res Express-style 로 변환 → 60초 한도 정상 작동
//   · maxDuration: 60초
//
// v22.0  — GPT 완전 제거 (PDF OCR 부정확)
//   · 활성 모델: Gemini 2.5 Flash + Claude Sonnet 4/3.7 fallback
// ============================================================

export const maxDuration = 60;

const VERSION = "v22.9"; // ★ v22.9: Claude 모델 fallback + 모델 오류 재시도
const CLAUDE_MODEL_CANDIDATES = [...new Set([
  process.env.ANTHROPIC_MODEL,
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219'
].filter(Boolean))];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default async function handler(req, res) {
  Object.keys(CORS_HEADERS).forEach(k => res.setHeader(k, CORS_HEADERS[k]));

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only', version: VERSION });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { res.status(400).json({ ok: false, error: 'Invalid JSON: ' + String(e), version: VERSION }); return; }
  }
  if (!body) body = {};

  const pdfBase64 = stripDataUrl(body.pdfBase64 || body.answerFileBase64 || body.base64 || '');
  const examInfo = body.examInfo || {
    subject: body.subject,
    grade: body.grade,
    level: body.level,
    examType: body.examType,
    totalQuestions: body.totalQuestions || body.totalQ || 0,
    gradingMode: body.gradingMode || ''
  };
  // ★ v22.7: gradingMode 정규화 + examType 키워드 자동 감지 (해석/번역/독해)
  if (!examInfo.gradingMode) {
    const looseKeywords = ["해석", "번역", "독해", "translation", "interpretation"];
    const examTypeLower = String(examInfo.examType || '').toLowerCase();
    if (looseKeywords.some(k => examTypeLower.includes(k.toLowerCase()))) {
      examInfo.gradingMode = 'loose';
    }
  }
  examInfo.gradingMode = String(examInfo.gradingMode || '').toLowerCase() === 'loose' ? 'loose' : 'strict';

  if (!pdfBase64) {
    res.status(400).json({ ok: false, error: 'pdfBase64 missing', version: VERSION });
    return;
  }

  // ★ v22.7: PDF 크기 검증 — Claude 32MB 제한
  const pdfSizeMB = (pdfBase64.length * 0.75) / (1024 * 1024); // base64 → 실제 바이트 환산
  console.log('[ai-extract] PDF size:', pdfSizeMB.toFixed(2) + 'MB', 'gradingMode:', examInfo.gradingMode, 'examType:', examInfo.examType);

  const t0 = Date.now();

  // ★ v22.2: 모델별 타임아웃 50초 (Node Runtime 60초 한도 안에서 10초 여유)
  const PER_MODEL_TIMEOUT_MS = 50000;
  // ★ v22.0: Gemini + Claude 만 사용
  const tasks = [
    callWithTimeout('gemini', () => callWithRetry('gemini', () => callGemini(pdfBase64, examInfo)), PER_MODEL_TIMEOUT_MS),
    callWithTimeout('claude', () => callWithRetry('claude', () => callClaude(pdfBase64, examInfo)), PER_MODEL_TIMEOUT_MS)
  ];

  const settled = await Promise.allSettled(tasks);
  const results = {
    gemini: settled[0].status === 'fulfilled' ? settled[0].value : { error: errMsg(settled[0]) },
    gpt:    { error: 'GPT 비활성화 (PDF OCR 부정확으로 v22.0에서 코드 삭제)', disabled: true, attempts: 0 },
    claude: settled[1].status === 'fulfilled' ? settled[1].value : { error: errMsg(settled[1]) }
  };

  res.status(200).json({
    ok: true,
    results: results,
    elapsedMs: Date.now() - t0,
    version: VERSION
  });
}

function stripDataUrl(s) {
  if (!s) return '';
  if (s.indexOf(',') >= 0) return s.split(',').pop();
  return s;
}

function errMsg(settled) {
  if (settled && settled.reason) return String(settled.reason.message || settled.reason);
  return 'unknown error';
}

async function callWithTimeout(model, fn, timeoutMs) {
  return await Promise.race([
    fn(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(model + ' 타임아웃 (' + timeoutMs + 'ms)')), timeoutMs))
  ]);
}

async function callWithRetry(name, fn) {
  const result1 = await fn();
  if (!result1 || !result1.error) return result1;
  const errStr = String(result1.error || '').toLowerCase();
  const isTransient = /\b(503|529|502|504|429|overload|timeout|rate.?limit|temporarily)/i.test(errStr);
  if (!isTransient) return result1;
  await new Promise(r => setTimeout(r, 1500));
  const result2 = await fn();
  if (!result2 || !result2.error) {
    result2.attempts = 2;
    result2.firstError = result1.error;
    return result2;
  }
  return {
    error: result2.error,
    rawHttp: result2.rawHttp,
    attempts: 2,
    firstError: result1.error
  };
}

function buildExtractPrompt(examInfo) {
  const totalQ = parseInt(examInfo.totalQuestions || examInfo.totalQ || 0, 10);
  // ★ v22.10 (2026-05-30): A안 응급 — 강제 "?" 채우기 지시 제거
  //   v22.9 사고: "못 찾으면 ? 로 채워서라도 50개" → AI 가 어렵다 싶으면 모든 답 ? 로 도망감 → 50문항 빈칸 사고
  //   복원: v22.8 의 "참고용" 형태. AI 가 답을 찾도록 유도.
  const totalLine = totalQ > 0
    ? '- 총 문항수: 약 ' + totalQ + '문제 (참고용 — PDF에서 직접 확인하세요)'
    : '- 총 문항수: PDF에서 직접 식별하세요 (1번부터 마지막 번호까지 빠짐없이)';
  // ★ v22.7: 해석/번역 시험 감지 → 한국어 해석만 추출하라고 명시
  const isLoose = String(examInfo.gradingMode || '').toLowerCase() === 'loose';
  // ★ v22.9 (2026-05-30): 사용자 입력 메타 (시작번호/주관식 범위/하위 주관식)
  const userStartNum = parseInt(examInfo.startNumber, 10) || 0;
  const userSubjRanges = String(examInfo.subjRanges || '').trim();
  const userSubQMap = String(examInfo.subQuestionMap || '').trim();
  const userMetaLines = [];
  if (userStartNum > 1) {
    userMetaLines.push('- ★ 사용자 지정 시작 번호: ' + userStartNum + ' (답지가 ' + userStartNum + '번부터 시작. answers 키도 ' + userStartNum + ' 부터 사용. startNumber=' + userStartNum + ')');
  }
  if (userSubjRanges) {
    userMetaLines.push('- ★ 사용자 지정 주관식 번호: ' + userSubjRanges + ' (이 번호는 반드시 type="sa")');
  }
  if (userSubQMap) {
    userMetaLines.push('- ★ 사용자 지정 하위 주관식: ' + userSubQMap + ' (예 "51:3" 은 51번 답에 (1)(2)(3) 3개 답을 "|" 로 묶기. answers["51"]="a1|a2|a3")');
  }
  const baseLines = [
    '당신은 시험 답지(정답지) OCR 전문가입니다.',
    '이 PDF는 학생이 푸는 시험지가 아니라, 선생님이 보는 정답지입니다.',
    'PDF 안에 이미 정답이 표시되어 있습니다. 그것을 찾아 그대로 옮기면 됩니다.',
    '',
    '## 시험 정보',
    '- 과목: ' + (examInfo.subject || ''),
    '- 학년: ' + (examInfo.grade || ''),
    '- 레벨/교재: ' + (examInfo.level || ''),
    '- 시험명: ' + (examInfo.examType || ''),
    '- 채점 모드: ' + (isLoose ? '해석/번역 (의역 인정)' : '단답형/영작 (엄격)'),
    totalLine
  ].concat(userMetaLines).concat([
    '- 문항별 객관식·주관식 여부는 답지를 보고 직접 판별하세요',
    ''
  ]);
  // ★ v22.7: 해석시험 전용 추가 규칙 (영문 원문 ≠ 답)
  const looseRules = isLoose ? [
    '## ★★★ 해석시험 — 답안 추출 규칙 (필수) ★★★',
    '이 시험은 영문 → 한국어 해석/번역 시험입니다.',
    '답지에는 다음과 같이 표시되어 있을 수 있습니다:',
    '  1. [영문 원문]',
    '     [한국어 해석]  ← ★ 이것이 답입니다',
    '  2. [영문 원문]',
    '     [한국어 해석]  ← ★ 이것이 답입니다',
    '',
    '**핵심 규칙**:',
    '- 추출할 답은 **한국어 해석문장** 입니다.',
    '- 영문 원문은 문제 본문이지 답이 아닙니다 — 절대 영문을 답으로 추출하지 마세요.',
    '- 한 문항에 영문과 한국어가 둘 다 있으면, **한국어 부분만** answers 에 넣으세요.',
    '- 한국어 해석이 여러 줄이면 줄바꿈을 공백으로 바꿔 하나의 문장으로.',
    '- 영문만 있고 한국어 해석이 없으면 "?" 로 표기 (추측 금지).',
    '',
    '예시:',
    '  답지에 "1. The cat is on the table. → 고양이가 책상 위에 있다."',
    '  → answers["1"] = "고양이가 책상 위에 있다."  (한국어만)',
    '  → 절대로 "The cat is on the table." 을 답으로 추출하지 말 것!',
    ''
  ] : [];
  const commonRules = [
    '## 절대 규칙',
    '0. 먼저 PDF가 정답지인지 확인하세요. 정답표/답안/해설/채점 기준이 없고 학생용 문제만 있으면 절대 추측하지 말고 notAnswerKey:true 를 반환하세요.',
    '1. 절대로 문제를 읽고 답을 추론하지 마세요. 오직 답지에 표기된 정답만 옮기세요.',
    '2. 정답이 보이지 않거나 모호하면 "?" 로 표시하세요. 추측 금지.',
    '3. 객관식 답이 ①②③④⑤ 형태라면 1,2,3,4,5 숫자로 변환하세요.',
    '4. 복수정답(예: ②와 ③ 둘 다 정답)은 "2,3" 형태로.',
    isLoose
      ? '5. 주관식 답: ★ 한국어 해석만 추출 (영문 원문은 답이 아님)'
      : '5. 주관식 답은 답지에 적힌 그대로 (영어 문장이면 영어, 한글이면 한글).',
    '6. **시작 번호 식별**: 답지 첫 문항이 1이 아닐 수도 있습니다. PDF의 첫 번째 정답 번호를 그대로 startNumber 로 기록하세요.',
    '7. **객관식·주관식 자동 판별 (필수)**: 각 문항을 다음 기준으로 분류해서 types 객체에 기록하세요.',
    '   - "mc" (객관식): 답이 1~5 중 하나(또는 "2,3" 같은 복수정답)인 경우',
    '   - "sa" (주관식): 답이 단어/구절/문장/숫자식 등 텍스트인 경우',
    '   - 판단 근거는 답의 형태입니다. "③" 만 있으면 mc, "happy" 면 sa.',
    '8. **문항 수는 PDF가 결정**: 답지에 보이는 모든 문항 번호를 빠짐없이 추출하세요. 답이 안 보이는 번호는 "?"로.',
    '',
    '## 응답 형식 — 반드시 이 JSON만 출력 (마크다운 코드블록 금지)',
    '{"startNumber": 1, "answers": {"1": "정답", "2": "정답", ...}, "types": {"1": "mc 또는 sa", "2": "mc 또는 sa", ...}, "notAnswerKey": false, "notes": ""}',
    '',
    '**중요**:',
    '- 학생용 시험지로 보이면: {"startNumber":1,"answers":{},"types":{},"notAnswerKey":true,"notes":"정답지가 아니라 시험지로 보임"}',
    '- answers 와 types 의 key 는 동일하게, 답지에 표기된 실제 문항 번호 사용',
    '- PDF에 보이는 모든 문항을 빠짐없이 포함 (1번부터 마지막 번호까지)',
    '- startNumber 가 확실치 않으면 1 로 기록',
    '- types 판단이 어려우면 답이 1~5 숫자만 있을 때 mc, 그 외는 sa',
    isLoose ? '- ★ 해석시험: 답은 반드시 한국어 — 영문 원문이 답으로 들어가면 안 됨' : ''
  ].filter(Boolean);
  return baseLines.concat(looseRules).concat(commonRules).join('\n');
}

async function callGemini(pdfBase64, examInfo) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: 'GEMINI_API_KEY 미설정' };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);
  const payload = {
    contents: [{
      parts: [
        { text: buildExtractPrompt(examInfo) },
        { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 }
    }
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  if (!r.ok) return { error: 'gemini HTTP ' + r.status, rawHttp: text.substring(0, 800) };
  let json;
  try { json = JSON.parse(text); } catch (e) { return { error: 'gemini json parse: ' + e.message, rawHttp: text.substring(0, 800) }; }
  let answersText = '';
  const cand = (json.candidates || [])[0];
  if (cand && cand.content && cand.content.parts) {
    answersText = cand.content.parts.map(p => p.text || '').join('');
  }
  return parseModelOutput('gemini', answersText);
}

async function callClaude(pdfBase64, examInfo) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY 미설정' };
  // ★ v22.7: PDF 크기 검증 — Claude 32MB 제한 (실제 안전 한도 25MB로 보수적 설정)
  const pdfBytes = pdfBase64.length * 0.75; // base64 → 실제 바이트
  if (pdfBytes > 25 * 1024 * 1024) {
    return {
      error: 'claude PDF 너무 큼 (' + (pdfBytes/1024/1024).toFixed(1) + 'MB > 25MB) — Gemini 단독으로 처리됩니다',
      skipped: true
    };
  }
  // ★ v22.10 (2026-05-30): A안 응급 — prefill 제거 (Sonnet 응답 잘림 사고 픽스)
  //   v22.9 prefill 사고: Sonnet 이 prefill 받고 짧게 끝나서 answers 가 빈 객체로 나옴
  //   해결: prefill 제거. temperature 0 + system 만 유지 (이건 안전).
  let lastError = null;
  for (const modelName of CLAUDE_MODEL_CANDIDATES) {
    const payload = {
      model: modelName,
      max_tokens: 8000,
      temperature: 0,
      system: '당신은 시험 답지(정답지) OCR 전문가입니다. PDF 안에 표시된 정답만 그대로 옮겨 JSON 으로 출력하세요. 답을 추측하거나 추론하지 마세요.',
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: buildExtractPrompt(examInfo) }
        ]
      }]
    };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    if (!r.ok) {
      // ★ v22.9: 배포 환경변수 모델명이 폐기/오타인 경우 다음 후보로 재시도
      let detail = '';
      try {
        const errJson = JSON.parse(text);
        detail = (errJson.error && (errJson.error.message || errJson.error.type)) || '';
      } catch(_e) {}
      lastError = {
        error: 'claude HTTP ' + r.status + ' (' + modelName + ')' + (detail ? ' — ' + detail.substring(0, 200) : ''),
        rawHttp: text.substring(0, 800)
      };
      const modelError = /model|not_found|not found|invalid|retired|deprecated/i.test(detail + ' ' + text);
      if (modelError) continue;
      return lastError;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { error: 'claude json parse (' + modelName + '): ' + e.message, rawHttp: text.substring(0, 800) };
    }
    const blocks = json.content || [];
    const answersText = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
    // ★ v22.10: prefill 제거됨 — 응답 그대로 파싱
    const parsed = parseModelOutput('claude', answersText);
    if (parsed && !parsed.model) parsed.model = modelName;
    return parsed;
  }
  return lastError || { error: 'claude model candidates missing' };
}

function parseModelOutput(model, raw) {
  try {
    let answersText = String(raw || '').trim();
    answersText = answersText.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    const parsed = JSON.parse(answersText);
    if (parsed.notAnswerKey === true) {
      return {
        error: model + ' 판단: 정답지가 아니라 시험지로 보임 — 답 추측 차단',
        notAnswerKey: true,
        notes: parsed.notes || '',
        raw: answersText.substring(0, 1000)
      };
    }
    let startNum = parseInt(parsed.startNumber, 10);
    if (!startNum || isNaN(startNum) || startNum < 1) startNum = 1;
    const rawAns = parsed.answers || {};
    const rawTypes = parsed.types || {};
    const normAns = {};
    const normTypes = {};
    const origMap = {};
    const keys = Object.keys(rawAns);
    const numKeys = keys.map(k => parseInt(k, 10)).filter(n => !isNaN(n));
    if (numKeys.length === keys.length && numKeys.length > 0) {
      numKeys.sort((a, b) => a - b);
      for (let i = 0; i < numKeys.length; i++) {
        const origK = String(numKeys[i]);
        const newK = String(i + 1);
        normAns[newK] = rawAns[origK];
        normTypes[newK] = normalizeTypeToken(rawTypes[origK], rawAns[origK]);
        origMap[newK] = numKeys[i];
      }
      if (startNum === 1 && numKeys[0] !== 1) startNum = numKeys[0];
    } else {
      Object.keys(rawAns).forEach(k => {
        normAns[k] = rawAns[k];
        normTypes[k] = normalizeTypeToken(rawTypes[k], rawAns[k]);
      });
    }
    return {
      answers: normAns,
      types: normTypes,
      startNumber: startNum,
      origNumberMap: origMap,
      notes: parsed.notes || '',
      raw: answersText.substring(0, 2000)
    };
  } catch (e) {
    return { error: model + ' 파싱: ' + String(e), raw: String(raw || '').substring(0, 500) };
  }
}

function normalizeTypeToken(typeVal, answerVal) {
  const t = String(typeVal || '').toLowerCase().trim();
  if (t === 'mc' || t === 'obj' || t === '객관식' || t === 'multiple_choice') return 'mc';
  if (t === 'sa' || t === 'subj' || t === '주관식' || t === 'subjective' || t === 'essay') return 'sa';
  const ans = String(answerVal == null ? '' : answerVal).trim();
  if (!ans || ans === '?') return 'mc';
  if (/^\s*[1-5](\s*[,;\/]\s*[1-5])*\s*$/.test(ans)) return 'mc';
  return 'sa';
}
