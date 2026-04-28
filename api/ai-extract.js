// ============================================================
// 채움학원 — 주관식 답안 자동 채점 API (Vercel Edge Function)
// Gemini 2.5 Flash + 5단계 채점 기준 (A~E)
// ★ v2: 배치 채점 지원 (1학생 = 1회 호출 → 비용 1/5)
// ============================================================

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

// ============================================================
// 5단계 채점 기준
// ============================================================
const GRADING_RUBRIC = `
당신은 영어/국어 학원의 주관식 답안 채점 전문가입니다.
학생 답안을 정답과 비교하여 5단계 기준으로 정확하게 채점하세요.

## 5단계 채점 기준

### A. 감점 없음 (100점 — 완전정답)
- 정답과 100% 일치
- 대소문자 차이만 있음 (apple ↔ Apple)
- 마침표·쉼표·물음표 차이만 있음 (end. ↔ end)
- 앞뒤 공백 차이만 있음 ("  apple  " ↔ "apple")
- 축약형/완전형 차이만 있음 (don't ↔ do not)
- 영/미 표기 차이만 있음 (colour ↔ color)

### B. 경미한 오류 (-5% ~ -10%)
- 관사 차이 (a/an/the 누락 또는 혼동): -5%
- 동사 수일치 (is↔are, was↔were): -5%
- 단복수 일치 (book ↔ books): -5%
- 명사 가산/불가산 (a water ↔ water): -5%
- 1~2글자 철자 오타 (recieve → receive): -10%
- 대명사 격 오류 (her↔she, him↔he): -10%
- 전치사 오류 (with↔by↔for↔in↔on): -10%
- 부사/형용사 혼동 (good↔well, hard↔hardly): -10%
- 형태소 오류 (-ing↔-ed, 분사 외): -10%
- 잉여 단어 1개 추가: -10%

### C. 중간 오류 (-15% ~ -20%)
- 사역동사 혼동 (had↔made↔let↔got): -15%
- 어순 변형 (단어는 맞으나 순서 다름): -15%
- 시제 오류 (go↔went↔gone, will↔would): -15%
- 태 오류 (능동↔수동, eat↔be eaten): -15%
- 분사 형태 오류 (broken↔breaking): -15%
- 관계대명사 오류 (who↔which↔that): -15%
- 접속사 오류 (and↔but↔or↔so↔because): -15%
- 비교급/최상급 형태 오류: -15%
- 조동사 오류 (can↔could↔may↔might↔should): -15%
- 부정사/동명사 혼동 (to do ↔ doing): -15%
- 핵심단어 1개 누락: -20%
- 가정법 형태 오류 (If I were ↔ If I was): -20%

### D. 심각한 오류 (-30% ~ -50%)
- 의문문 어순 오류: -30%
- 한국어 직역 (어색한 영어): -30%
- 의미 변형 (의미 통하나 약간 다름): -30%
- 핵심단어 2개+ 누락: -40%
- 핵심 구문 오류 (시제+태+조동사 동시 오류): -50%

### E. 결정적 오류 (-100% — 0점)
- 파트 완전 누락
- 미답(빈칸) — 무조건 0점
- 의미 완전 변형 (정답과 무관)
- 단답/문장 형식 위반

## 채점 규칙

1. **합산 적용**: 한 답안에 여러 오류가 있으면 감점을 모두 합산.
2. **최저점 0점 보장**: 답을 쓴 경우 감점 합이 -120%여도 0점 미만 불가.
3. **빈칸은 무조건 0점**.
4. **모호하면 학생에게 관대하게**: 명백한 오타 vs. 모르는 단어는 명백한 쪽으로.
5. **동의어 인정**: "이 단어 써라"고 지정된 게 아니면 동의어도 정답.
`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST only' }, 405);
  }

  let body;
  try { body = await req.json(); }
  catch (e) {
    return jsonResponse({ ok: false, error: 'Invalid JSON: ' + String(e) }, 400);
  }

  // ★ v2: 배치 모드 (1학생의 여러 답안을 한 번에 채점)
  // body.items = [{q, studentAnswer, correctAnswer, questionContext}, ...]
  if (Array.isArray(body.items) && body.items.length > 0) {
    return await handleBatchGrade(body.items);
  }

  // 단일 모드 (호환성)
  const studentAnswer = String(body.studentAnswer || '').trim();
  const correctAnswer = String(body.correctAnswer || '').trim();
  const questionContext = String(body.questionContext || '').trim();

  if (!studentAnswer) {
    return jsonResponse({
      ok: true,
      result: {
        score: 0, category: "E",
        deductions: [{ type: "미답", amount: -100, reason: "답 미입력" }],
        reasoning: "빈칸 — 0점"
      }
    });
  }
  if (!correctAnswer) {
    return jsonResponse({ ok: false, error: '정답 데이터 없음' }, 400);
  }
  if (quickEqual(studentAnswer, correctAnswer)) {
    return jsonResponse({
      ok: true,
      result: {
        score: 100, category: "A", deductions: [],
        reasoning: "완전정답 (대소문자/공백/문장부호 차이만)"
      }
    });
  }
  const isMultiBlank = studentAnswer.indexOf('|') !== -1 || correctAnswer.indexOf('|') !== -1;
  if (isMultiBlank) {
    return await gradeMultiBlankSingle(studentAnswer, correctAnswer, questionContext);
  }
  const result = await gradeSingleViaGemini(studentAnswer, correctAnswer, questionContext);
  return jsonResponse({ ok: true, result });
}

// ============================================================
// ★ v2: 배치 채점 — 1학생의 여러 주관식을 한 번에 처리
// 1) 빠른 일치 / 빈칸 → Gemini 호출 없이 즉시 결정
// 2) 나머지만 Gemini 한 번에 묶어서 채점
// ============================================================
async function handleBatchGrade(items) {
  const results = [];
  const needAi = [];
  // 1단계: 빠른 처리 (빈칸 / 완전일치)
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const sa = String(it.studentAnswer || '').trim();
    const ca = String(it.correctAnswer || '').trim();
    const qNum = it.q || (i + 1);
    if (!sa) {
      results.push({
        q: qNum,
        score: 0, category: "E",
        deductions: [{ type: "미답", amount: -100, reason: "빈칸" }],
        reasoning: "빈칸 — 0점"
      });
      continue;
    }
    if (!ca) {
      results.push({
        q: qNum,
        score: 100, category: "A", deductions: [],
        reasoning: "정답 미설정 → 입력만 확인 (100점 부여)"
      });
      continue;
    }
    if (quickEqual(sa, ca)) {
      results.push({
        q: qNum,
        score: 100, category: "A", deductions: [],
        reasoning: "완전정답 (대소문자/공백/문장부호 차이만)"
      });
      continue;
    }
    needAi.push({ q: qNum, studentAnswer: sa, correctAnswer: ca, questionContext: it.questionContext || '' });
  }
  // 2단계: AI 채점 필요한 것만 한 번에 호출
  if (needAi.length > 0) {
    const aiResults = await gradeBatchViaGemini(needAi);
    // q 매칭해서 results 에 합치기
    needAi.forEach(item => {
      const found = aiResults.find(r => String(r.q) === String(item.q));
      if (found) {
        results.push(found);
      } else {
        results.push({
          q: item.q,
          score: 0, category: "ERROR",
          deductions: [],
          reasoning: "AI 응답에서 이 문항을 찾지 못함"
        });
      }
    });
  }
  // q 번호 순 정렬
  results.sort((a, b) => Number(a.q) - Number(b.q));
  return jsonResponse({ ok: true, results });
}

// ============================================================
// Gemini 배치 호출 — 여러 답안을 한 번에 채점
// ============================================================
async function gradeBatchViaGemini(items) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return items.map(it => ({
      q: it.q,
      score: 0, category: "ERROR",
      deductions: [],
      reasoning: "GEMINI_API_KEY 미설정"
    }));
  }
  const promptItems = items.map((it, i) =>
    `[문항 ${it.q}]\n학생 답안: "${it.studentAnswer}"\n정답: "${it.correctAnswer}"` +
    (it.questionContext ? `\n맥락: ${it.questionContext}` : '')
  ).join('\n\n');
  const prompt = GRADING_RUBRIC +
    `\n\n## 채점 대상 (${items.length}개 문항)\n\n${promptItems}\n\n` +
    `## 응답 형식 (JSON 배열만 출력 — 마크다운 코드블록 금지)\n` +
    `[\n` +
    items.map(it =>
      `  {"q": ${it.q}, "score": 95, "category": "B", "deductions": [{"type":"...", "amount":-5, "reason":"..."}], "reasoning": "..."}`
    ).join(',\n') +
    `\n]\n\n` +
    `각 문항을 위 채점 기준대로 평가해 ${items.length}개 항목 JSON 배열로만 응답하세요.`;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: Math.min(8000, 600 * items.length + 1000)
        }
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      // 429 (분당 한도) → 5초 대기 후 1회 재시도
      if (res.status === 429) {
        await sleep(5000);
        const retry = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingBudget: 0 },
              maxOutputTokens: Math.min(8000, 600 * items.length + 1000)
            }
          })
        });
        if (retry.ok) return await parseBatchResponse(retry, items);
      }
      return items.map(it => ({
        q: it.q,
        score: 0, category: "ERROR",
        deductions: [],
        reasoning: `Gemini HTTP ${res.status} — 분당 호출 한도 초과 가능성. 잠시 후 재시도하세요.`
      }));
    }
    return await parseBatchResponse(res, items);
  } catch (e) {
    return items.map(it => ({
      q: it.q,
      score: 0, category: "ERROR",
      deductions: [],
      reasoning: "Gemini 호출 실패: " + String(e)
    }));
  }
}

// ============================================================
// Gemini 배치 응답 파싱
// ============================================================
async function parseBatchResponse(res, items) {
  let text = '';
  try {
    const json = await res.json();
    const cand = (json.candidates || [])[0];
    if (cand && cand.content && cand.content.parts) {
      text = cand.content.parts.map(p => p.text || '').join('');
    }
    text = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    let parsed = JSON.parse(text);
    // 배열이 아니면 배열로 감싸기 시도
    if (!Array.isArray(parsed)) {
      if (parsed && Array.isArray(parsed.results)) parsed = parsed.results;
      else if (parsed && Array.isArray(parsed.items)) parsed = parsed.items;
      else throw new Error("응답이 배열 아님");
    }
    return parsed.map(p => {
      let score = parseInt(p.score, 10);
      if (isNaN(score) || score < 0) score = 0;
      if (score > 100) score = 100;
      return {
        q: p.q,
        score: score,
        category: String(p.category || "?").toUpperCase(),
        deductions: Array.isArray(p.deductions) ? p.deductions : [],
        reasoning: String(p.reasoning || '')
      };
    });
  } catch (e) {
    return items.map(it => ({
      q: it.q,
      score: 0, category: "ERROR",
      deductions: [],
      reasoning: "응답 파싱 실패: " + String(e) + " | 원본: " + text.substring(0, 100)
    }));
  }
}

// ============================================================
// 단일 답안 Gemini 채점 (호환용)
// ============================================================
async function gradeSingleViaGemini(studentAnswer, correctAnswer, questionContext) {
  const result = await gradeBatchViaGemini([{
    q: 1,
    studentAnswer, correctAnswer, questionContext
  }]);
  if (result && result[0]) {
    const r = result[0];
    return {
      score: r.score,
      category: r.category,
      deductions: r.deductions,
      reasoning: r.reasoning
    };
  }
  return { score: 0, category: "ERROR", deductions: [], reasoning: "응답 없음" };
}

// ============================================================
// 단일 답안 멀티블랭크 (파이프 |) 채점 — 호환용
// ============================================================
async function gradeMultiBlankSingle(studentAnswer, correctAnswer, questionContext) {
  const studentParts = studentAnswer.split('|').map(s => s.trim());
  const correctParts = correctAnswer.split('|').map(s => s.trim());
  const total = correctParts.length;
  const items = [];
  for (let i = 0; i < total; i++) {
    items.push({
      q: i + 1,
      studentAnswer: studentParts[i] || '',
      correctAnswer: correctParts[i] || '',
      questionContext: questionContext
    });
  }
  const batchRes = await handleBatchGrade(items);
  const j = await batchRes.json();
  const blanks = j.results || [];
  const avgScore = blanks.length > 0
    ? Math.round(blanks.reduce((s, b) => s + b.score, 0) / blanks.length)
    : 0;
  return jsonResponse({
    ok: true,
    result: {
      score: avgScore,
      category: "MULTI",
      blanks: blanks.map(b => ({
        index: b.q,
        studentAnswer: studentParts[b.q - 1] || '',
        correctAnswer: correctParts[b.q - 1] || '',
        score: b.score,
        category: b.category,
        deductions: b.deductions,
        reasoning: b.reasoning
      })),
      reasoning: `${total}개 빈칸 평균: ${avgScore}점 (` +
        blanks.map(b => b.score + '점').join(' · ') + ')'
    }
  });
}

// ============================================================
// 헬퍼
// ============================================================
function quickEqual(a, b) {
  const norm = s => String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,]+$/, '');
  return norm(a) === norm(b);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS_HEADERS });
}
