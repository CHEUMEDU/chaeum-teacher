// ============================================================
// 채움학원 — 주관식 답안 자동 채점 API (Vercel Serverless Function)
// 파일 경로: chaeum-teacher/api/grade-subjective.js
// ============================================================
// 버전 이력
// ─────────────────────────────────────────
// v22.3 (2026-04-28)
//   · 빈칸 N개(파이프 |) 자동 분리 채점 + 평균 점수
//   · 점수 재계산: AI score 와 deductions 합산 불일치 시 deductions 우선
//   · 문법 설명(grammarTip) 추가: 학생 학습용 1-2문장 팁
//
// v22.2  — Node Runtime Express-style 전환 (60초 한도)
// v22.0  — 5단계 채점 + 배치 모드
// ============================================================

export const maxDuration = 60;

const VERSION = "v22.3";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// 5단계 채점 기준
const GRADING_RUBRIC = `
당신은 영어/국어 학원의 주관식 답안 채점 전문가입니다.
학생 답안을 정답과 비교하여 5단계 기준으로 정확하게 채점하세요.

## 5단계 채점 기준

### A. 감점 없음 (100점 — 완전정답)
- 정답과 100% 일치, 대소문자/공백/문장부호 차이만 있음
- 축약형(don't ↔ do not), 영/미 표기(colour ↔ color) 차이만 있음

### B. 경미한 오류 (-5% ~ -10%)
- 관사 누락/혼동(a/an/the): -5%
- 동사 수일치, 단복수, 가산/불가산: -5%
- 1~2글자 철자 오타, 대명사 격, 전치사, 부사/형용사 혼동: -10%
- 형태소 오류(-ing↔-ed), 잉여 단어 1개: -10%

### C. 중간 오류 (-15% ~ -20%)
- 사역동사, 어순 변형, 시제, 태, 분사 형태 오류: -15%
- 관계대명사, 접속사, 비교급, 조동사, 부정사/동명사 혼동: -15%
- 핵심단어 1개 누락, 가정법 형태 오류: -20%

### D. 심각한 오류 (-30% ~ -50%)
- 의문문 어순, 한국어 직역, 의미 변형: -30%
- 핵심단어 2개+ 누락: -40%
- 핵심 구문 오류 (시제+태+조동사 동시): -50%

### E. 결정적 오류 (-100% — 0점)
- 파트 완전 누락, 미답, 의미 완전 변형, 단답/문장 형식 위반

## 채점 규칙
1. 합산 적용 (여러 오류 시 모두 합산)
2. 최저점 0점 보장 (감점 합 -120%여도 0점)
3. 빈칸은 무조건 0점
4. 모호하면 학생에게 관대하게
5. 동의어 인정
6. ★ 중요: deductions 합계와 score 가 정확히 일치해야 함 (100 + 합계 = score)

## 응답 필드 (필수)
- "q": 문항 번호
- "score": 0~100 점수
- "category": "A" / "B" / "C" / "D" / "E"
- "deductions": [{type, amount, reason}, ...] (빈 배열 가능)
- "reasoning": 채점 사유 (간략하게 1-2문장)
- "grammarTip": ★ 학생 학습용 문법/구문 팁 (1-2문장)
   · 학생이 틀린 부분에 대한 명확한 문법 설명
   · 예시: "비교급은 'more 형용사' 또는 '-er', 최상급은 'most 형용사' 또는 '-est' 형태입니다. 'popular' 같은 긴 형용사는 'most popular'를 사용합니다."
   · 정답인 경우 빈 문자열 ""
   · 학생 수준 (중1~고3) 에 맞춰 쉽게 설명
`;

export default async function handler(req, res) {
  // CORS 헤더 모두 적용
  Object.keys(CORS_HEADERS).forEach(k => res.setHeader(k, CORS_HEADERS[k]));

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only', version: VERSION });
    return;
  }

  // body 파싱 (이미 파싱돼 있을 수도)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { res.status(400).json({ ok: false, error: 'Invalid JSON: ' + String(e), version: VERSION }); return; }
  }
  if (!body) body = {};

  // 배치 모드
  if (Array.isArray(body.items) && body.items.length > 0) {
    const result = await handleBatchGrade(body.items);
    res.status(200).json(result);
    return;
  }

  // 단일 모드
  const studentAnswer = String(body.studentAnswer || '').trim();
  const correctAnswer = String(body.correctAnswer || '').trim();
  const questionContext = String(body.questionContext || '').trim();

  if (!studentAnswer) {
    res.status(200).json({
      ok: true, version: VERSION,
      result: {
        score: 0, category: "E",
        deductions: [{ type: "미답", amount: -100, reason: "답 미입력" }],
        reasoning: "빈칸 — 0점"
      }
    });
    return;
  }
  if (!correctAnswer) {
    res.status(400).json({ ok: false, error: '정답 데이터 없음', version: VERSION });
    return;
  }
  if (quickEqual(studentAnswer, correctAnswer)) {
    res.status(200).json({
      ok: true, version: VERSION,
      result: {
        score: 100, category: "A", deductions: [],
        reasoning: "완전정답 (대소문자/공백/문장부호 차이만)"
      }
    });
    return;
  }
  const isMultiBlank = studentAnswer.indexOf('|') !== -1 || correctAnswer.indexOf('|') !== -1;
  if (isMultiBlank) {
    const r = await gradeMultiBlankSingle(studentAnswer, correctAnswer, questionContext);
    res.status(200).json(r);
    return;
  }
  const result = await gradeSingleViaGemini(studentAnswer, correctAnswer, questionContext);
  res.status(200).json({ ok: true, result, version: VERSION });
}

// ★ v22.3: 정답에 (1)(2)(3) 패턴 있으면 파이프(|) 형태로 변환
function normalizeMultiBlank(s) {
  if (!s || typeof s !== 'string') return s;
  if (s.indexOf('|') !== -1) return s;
  if (/\(\d+\)\s*/.test(s)) {
    const parts = s.split(/\(\d+\)\s*/).filter(p => p.trim()).map(p => p.trim());
    if (parts.length > 1) return parts.join('|');
  }
  if (/\([A-Za-z]\)\s*/.test(s)) {
    const parts = s.split(/\([A-Za-z]\)\s*/).filter(p => p.trim()).map(p => p.trim());
    if (parts.length > 1) return parts.join('|');
  }
  return s;
}

// ★ v22.3: 빈칸 분리 + 평균 채점 + 점수 정확 + 문법 설명
async function handleBatchGrade(items) {
  const expanded = [];      // AI에 보낼 단위 (빈칸별로 분리됨)
  const subQGroups = {};    // 원본 q → 분리된 subQ 목록
  const fastResults = [];   // Gemini 호출 안 해도 되는 결과 (빈칸/완전일치)

  // 1단계: 빈칸 분리 + 빠른 처리
  items.forEach(it => {
    const sa = String(it.studentAnswer || '').trim();
    const ca = String(it.correctAnswer || '').trim();
    const caNorm = normalizeMultiBlank(ca);
    const qNum = it.q;
    const hasMultiBlank = sa.indexOf('|') !== -1 || caNorm.indexOf('|') !== -1;

    if (hasMultiBlank) {
      // 빈칸별 분리 채점
      const sParts = sa.split('|').map(s => s.trim());
      const cParts = caNorm.split('|').map(s => s.trim());
      const total = cParts.length;
      subQGroups[qNum] = [];
      for (let i = 0; i < total; i++) {
        const subQId = qNum + '_' + (i + 1);
        const sP = sParts[i] || '';
        const cP = cParts[i] || '';
        // 빠른 처리 (빈칸/완전일치)
        if (!sP) {
          fastResults.push({ q: subQId, parentQ: qNum, blank: i+1, score: 0, category: "E", deductions: [{type:"미답",amount:-100,reason:"이 빈칸 미입력"}], reasoning: "빈칸 — 0점", grammarTip: "" });
          subQGroups[qNum].push(subQId);
          continue;
        }
        if (!cP) {
          fastResults.push({ q: subQId, parentQ: qNum, blank: i+1, score: 100, category: "A", deductions: [], reasoning: "정답 미설정", grammarTip: "" });
          subQGroups[qNum].push(subQId);
          continue;
        }
        if (quickEqual(sP, cP)) {
          fastResults.push({ q: subQId, parentQ: qNum, blank: i+1, score: 100, category: "A", deductions: [], reasoning: "완전정답", grammarTip: "" });
          subQGroups[qNum].push(subQId);
          continue;
        }
        // AI 채점 필요
        expanded.push({ q: subQId, parentQ: qNum, blank: i+1, studentAnswer: sP, correctAnswer: cP, questionContext: it.questionContext || '' });
        subQGroups[qNum].push(subQId);
      }
    } else {
      // 단일 빈칸
      if (!sa) {
        fastResults.push({ q: qNum, score: 0, category: "E", deductions: [{type:"미답",amount:-100,reason:"빈칸"}], reasoning: "빈칸 — 0점", grammarTip: "" });
        return;
      }
      if (!ca) {
        fastResults.push({ q: qNum, score: 100, category: "A", deductions: [], reasoning: "정답 미설정 → 입력만 확인", grammarTip: "" });
        return;
      }
      if (quickEqual(sa, ca)) {
        fastResults.push({ q: qNum, score: 100, category: "A", deductions: [], reasoning: "완전정답", grammarTip: "" });
        return;
      }
      expanded.push({ q: qNum, studentAnswer: sa, correctAnswer: ca, questionContext: it.questionContext || '' });
    }
  });

  // 2단계: AI 채점 필요한 것만 한 번에 호출
  let aiResults = [];
  if (expanded.length > 0) {
    aiResults = await gradeBatchViaGemini(expanded);
  }
  const allResults = [...fastResults, ...aiResults];

  // 3단계: 결과 합치기 (멀티블랭크는 평균)
  const finalResults = [];
  items.forEach(it => {
    const qNum = it.q;
    if (subQGroups[qNum]) {
      // 빈칸별 결과 합치기
      const subResults = subQGroups[qNum].map(sq =>
        allResults.find(r => String(r.q) === String(sq))
      ).filter(Boolean);

      if (subResults.length === 0) {
        finalResults.push({ q: qNum, score: 0, category: "ERROR", deductions: [], reasoning: "빈칸 채점 실패", grammarTip: "" });
        return;
      }

      // 평균 점수
      const avgScore = Math.round(subResults.reduce((s, r) => s + r.score, 0) / subResults.length);

      // 빈칸별 deductions 모두 합치기 (각 deduction에 빈칸 번호 표시)
      const allDeductions = [];
      subResults.forEach((r, i) => {
        (r.deductions || []).forEach(d => {
          allDeductions.push({ ...d, blank: r.blank || (i + 1) });
        });
      });

      // 채점 사유 합치기
      const reasoning = subResults.map((r, i) => '(' + (r.blank || (i+1)) + ') ' + r.reasoning).join(' / ');

      // 문법 설명 합치기 (빈 문자열 제외)
      const grammarTips = subResults.map((r, i) => {
        const tip = String(r.grammarTip || '').trim();
        return tip ? '(' + (r.blank || (i+1)) + ') ' + tip : '';
      }).filter(Boolean).join('\n');

      finalResults.push({
        q: qNum,
        score: avgScore,
        category: avgScore === 100 ? 'A' : avgScore === 0 ? 'E' : 'MULTI',
        deductions: allDeductions,
        reasoning: reasoning,
        grammarTip: grammarTips,
        blanks: subResults.map((r, i) => ({
          index: r.blank || (i + 1),
          score: r.score,
          deductions: r.deductions || [],
          reasoning: r.reasoning,
          grammarTip: r.grammarTip || ''
        }))
      });
    } else {
      // 단일 빈칸
      const result = allResults.find(r => String(r.q) === String(qNum));
      if (result) {
        finalResults.push(result);
      } else {
        finalResults.push({ q: qNum, score: 0, category: "ERROR", deductions: [], reasoning: "AI 응답에서 이 문항을 찾지 못함", grammarTip: "" });
      }
    }
  });

  finalResults.sort((a, b) => Number(a.q) - Number(b.q));
  return { ok: true, results: finalResults, version: VERSION };
}

// Gemini 배치 호출
async function gradeBatchViaGemini(items) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return items.map(it => ({ q: it.q, score: 0, category: "ERROR", deductions: [], reasoning: "GEMINI_API_KEY 미설정" }));
  }
  const promptItems = items.map((it) =>
    `[문항 ${it.q}]\n학생 답안: "${it.studentAnswer}"\n정답: "${it.correctAnswer}"` +
    (it.questionContext ? `\n맥락: ${it.questionContext}` : '')
  ).join('\n\n');
  const prompt = GRADING_RUBRIC +
    `\n\n## 채점 대상 (${items.length}개 문항)\n\n${promptItems}\n\n` +
    `## 응답 형식 (JSON 배열만 출력 — 마크다운 코드블록 금지)\n` +
    `[\n` +
    items.map(it => `  {"q": "${it.q}", "score": 95, "category": "B", "deductions": [{"type":"...", "amount":-5, "reason":"..."}], "reasoning": "...", "grammarTip": "..."}`).join(',\n') +
    `\n]\n\n각 문항을 위 채점 기준대로 평가해 ${items.length}개 항목 JSON 배열로만 응답하세요.\n` +
    `★ 중요: deductions 합계와 score 가 정확히 일치 (100 + 합계 = score, 0 미만은 0)\n` +
    `★ grammarTip: 학생이 이해할 수 있는 1-2문장 문법/구문 설명 (정답이면 "")`;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);
  try {
    const r = await fetch(url, {
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
    if (!r.ok) {
      const txt = await r.text();
      if (r.status === 429) {
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
      return items.map(it => ({ q: it.q, score: 0, category: "ERROR", deductions: [], reasoning: `Gemini HTTP ${r.status}` }));
    }
    return await parseBatchResponse(r, items);
  } catch (e) {
    return items.map(it => ({ q: it.q, score: 0, category: "ERROR", deductions: [], reasoning: "Gemini 호출 실패: " + String(e) }));
  }
}

async function parseBatchResponse(r, items) {
  let text = '';
  try {
    const json = await r.json();
    const cand = (json.candidates || [])[0];
    if (cand && cand.content && cand.content.parts) {
      text = cand.content.parts.map(p => p.text || '').join('');
    }
    text = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    let parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      if (parsed && Array.isArray(parsed.results)) parsed = parsed.results;
      else if (parsed && Array.isArray(parsed.items)) parsed = parsed.items;
      else throw new Error("응답이 배열 아님");
    }
    return parsed.map(p => {
      let score = parseInt(p.score, 10);
      if (isNaN(score) || score < 0) score = 0;
      if (score > 100) score = 100;
      // ★ v22.3: deductions 합산으로 점수 재계산 (AI score 와 차이 5점 이상 시 deductions 우선)
      const deductions = Array.isArray(p.deductions) ? p.deductions : [];
      const totalDeduction = deductions.reduce((s, d) => s + Math.abs(Number(d.amount) || 0), 0);
      const calculatedScore = Math.max(0, 100 - totalDeduction);
      if (Math.abs(score - calculatedScore) > 5) {
        // AI 점수와 deductions 합산이 5점 이상 차이 → deductions 합산을 신뢰
        score = calculatedScore;
      }
      // 메타 필드 보존 (parentQ, blank — 빈칸 분리 채점 시 사용)
      const orig = items.find(it => String(it.q) === String(p.q));
      return {
        q: p.q,
        parentQ: orig ? orig.parentQ : undefined,
        blank: orig ? orig.blank : undefined,
        score: score,
        category: String(p.category || "?").toUpperCase(),
        deductions: deductions,
        reasoning: String(p.reasoning || ''),
        grammarTip: String(p.grammarTip || '')  // ★ v22.3 추가
      };
    });
  } catch (e) {
    return items.map(it => ({ q: it.q, parentQ: it.parentQ, blank: it.blank, score: 0, category: "ERROR", deductions: [], reasoning: "응답 파싱 실패: " + String(e), grammarTip: "" }));
  }
}

async function gradeSingleViaGemini(studentAnswer, correctAnswer, questionContext) {
  const result = await gradeBatchViaGemini([{ q: 1, studentAnswer, correctAnswer, questionContext }]);
  if (result && result[0]) {
    const r = result[0];
    return { score: r.score, category: r.category, deductions: r.deductions, reasoning: r.reasoning };
  }
  return { score: 0, category: "ERROR", deductions: [], reasoning: "응답 없음" };
}

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
  const blanks = batchRes.results || [];
  const avgScore = blanks.length > 0
    ? Math.round(blanks.reduce((s, b) => s + b.score, 0) / blanks.length)
    : 0;
  return {
    ok: true, version: VERSION,
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
  };
}

function quickEqual(a, b) {
  const norm = s => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!?,]+$/, '');
  return norm(a) === norm(b);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
