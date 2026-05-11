// ============================================================
// 채움학원 — 주관식 답안 자동 채점 API (Vercel Serverless Function)
// 파일 경로: chaeum-teacher/api/grade-subjective.js
// ============================================================
// 버전 이력
// ─────────────────────────────────────────
// v23.9 (2026-05-11) — v23.8 timeout 픽스 (Failed to fetch 해결)
//   ★ 프롬프트 길이 절반 압축 — Gemini 응답 60초 한도 초과 방지
//   ★ 응답 형식 기존 q/score/category 로 유지 — 변환 layer 단순화
//   ★ 동의어 사전·핵심 원칙은 그대로 (감점 기준 동일)
//   ★ maxOutputTokens 조정 (400/item + 800)
//
// v23.8 (2026-05-11) — 의미 기반 채점 엔진으로 완전 전환 (학원 실무 피드백 최종 반영)
//   ★ 표면 유사도 채점 → "학생이 핵심 의미를 이해했는지" 평가
//   ★ 단답·영작·해석 3가지 시나리오 통합 처리
//   ★ 동의어 사전 내장 ("양치하다"="이를 닦다", "챙긴다"="가지고 간다" 등)
//   ★ 띄어쓰기·문장부호·반말/존댓말 차이 절대 감점 X
//   ★ 단답형 — 문장 전체에 정답 단어 포함 시 80~100점 (기존: 0점)
//   ★ 영작형은 문법 오류 엄격 검사 유지
//   ★ 응답 스펙 새로 (questionNumber/isCorrect/reason/correctionGuide/acceptedExpressions)
//   ★ 기존 frontend 호환 위한 변환 layer (q/category/reasoning/grammarTip 자동 매핑)
//
// v23.7 (2026-05-11) — 해석시험 채점 기준 대폭 완화 (학원 실무 피드백)
//   ★ 동의어 절대 감점 X ("정말"="실로", "영향력"="영향", "이러한 이유로"="이 때문에")
//   ★ 띄어쓰기·문장부호 절대 감점 X ("기울여야한다"="기울여야 한다")
//   ★ 풀어쓴 표현·능동/수동 표현 차이 인정
//   ★ 동사·명사 동의어 폭넓게 인정 ("형성하다"="만들다", "결정"="선택"="의사결정")
//   ★ 점수 기준 관대화 — 핵심 의미만 통하면 대부분 95~100점
//
// v22.5 (2026-04-28)
//   ★ 문법 설명(grammarTip) 톤 변경 — 과외 선생님 반말, 좋은 뉘앙스
//   ★ 학생 총평(overallComment) 추가 — 이름 + 강점/약점 1~2줄 (반말)
//   ★ 응답 형식 변경: { ok, results, overallComment, version }
//   ★ studentName 입력 받기 (총평 개인화)
//
// v22.4  — 쉼표 예외 + quickEqual 쉼표 무시
// v22.3  — 빈칸 분리 + 점수 정확 + 문법 설명
// v22.2  — Node Runtime Express-style 전환 (60초 한도)
// v22.0  — 5단계 채점 + 배치 모드
// ============================================================

export const maxDuration = 60;

const VERSION = "v23.9"; // ★ v23.9: 의미 기반 채점 (압축 프롬프트) — v23.8 timeout 픽스, 응답 형식 안정화

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// ★ v23.9: 의미 기반 채점 — 압축 버전 (타임아웃 방지)
//   v23.8 의 긴 프롬프트가 Gemini 응답 60초 한도 초과 → "Failed to fetch" 발생
//   v23.9: 핵심만 유지하고 프롬프트 길이 절반으로 압축
const GRADING_RUBRIC = `
너는 중·고등 영어 학원 주관식 채점 엔진이다.
원칙: 학생이 핵심 의미를 이해했는지가 전부. 글자 일치 X.

[필수 인정 — 100점]
- 동의어: 양치하다=이를 닦다, 우산 챙긴다=가지고 간다, 식사 후=먹은 뒤, 영향력=영향, 정말=실로=참으로, 이러한 이유로=이 때문에=그래서, 형성=만들기, 결정=선택=의사결정, 행동=행위=활동
- 띄어쓰기·문장부호·반말/존댓말 차이 절대 감점 X
- 어순·조사 차이 절대 감점 X
- 풀어쓴 표현 인정

[감점 사유]
- 핵심 동사/명사 누락 또는 변형
- 시제 큰 오류 (과거↔현재)
- 부정↔긍정 반전
- 빈도부사(always 등) 누락 → -10
- 의문문↔평서문 변형
- 50% 이상 누락

[영작 모드만 엄격]
영어 영작 답안에서 3인칭 -s, 시제, 주어 누락, be↔일반동사 혼동 → 명확히 감점

[단답형 — 정답이 단어 하나]
- 정답 단어만 → 100점
- 문장에 정답 단어 포함 + 문법 OK → 80~100점
- 다른 단어 → 0점

[점수 기준]
- 의미 같음, 표현만 다름 → 95~100
- 핵심 OK, 보조 표현 살짝 어색 → 90~95
- 핵심 1개 누락 → 80~90
- 매우 어색·직역투 심함 → 70
- 일부 의미만 → 50
- 의미 다름·빈칸 → 0

[응답 — JSON 배열만, 마크다운 금지]
각 항목: {"q": 번호, "score": 0~100, "category": "A/B/C/D/E", "reasoning": "1~2문장 반말 사유", "grammarTip": "필요시 학습 팁"}
- score 95+ : A, 85+ : B, 60+ : C, 30+ : D, 30 미만: E
- reasoning: "표현은 달라도 의미가 같아 정답 인정" 같이 명확하게
- grammarTip: 의미 변형이 있을 때만 작성 (동의어 차이로는 쓰지 마라)
`;

// ★ v23.9: LOOSE 모드 — 해석/번역용 (영작 문법 검사 제외)
const GRADING_RUBRIC_LOOSE = GRADING_RUBRIC + `

[해석 모드 추가]
영어→한국어 해석 시험이다. 영작 문법 엄격 검사 미적용.
한국어 자연스러움만 본다. 의역·동의어·풀어쓴 표현 100점.
직역투로 의미가 무너지는 경우만 감점.
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

  // ★ v22.7: gradingMode 추출 (loose=해석/번역, strict=단답형) — 기본값 strict
  const gradingMode = (String(body.gradingMode || '').toLowerCase() === 'loose') ? 'loose' : 'strict';

  // 배치 모드
  if (Array.isArray(body.items) && body.items.length > 0) {
    const studentName = String(body.studentName || '').trim() || '학생';
    const result = await handleBatchGrade(body.items, studentName, gradingMode);
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

// ★ v22.7: gradingMode 추가 — loose(해석/번역)는 의역 허용, strict(단답형)는 정확성 강조
async function handleBatchGrade(items, studentName, gradingMode) {
  studentName = studentName || '학생';
  gradingMode = (String(gradingMode || '').toLowerCase() === 'loose') ? 'loose' : 'strict';
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
    // ★ v22.7: gradingMode 전달 (loose면 해석 모드, strict면 단답 모드)
    aiResults = await gradeBatchViaGemini(expanded, gradingMode);
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

  // ★ v22.5: 학생 총평 생성 (Gemini 호출 또는 코드 자동 fallback)
  let overallComment = '';
  try {
    overallComment = await generateOverallComment(studentName, finalResults, items);
  } catch(e) {
    overallComment = generateFallbackComment(studentName, finalResults);
  }

  return { ok: true, results: finalResults, overallComment, version: VERSION };
}

// ★ v22.5: 학생 총평 — Gemini 한 번 더 호출 (또는 폴백)
async function generateOverallComment(studentName, results, items) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return generateFallbackComment(studentName, results);
  if (!results || results.length === 0) return '';

  // 채점 결과 요약 (총평 생성용)
  const totalScore = Math.round(results.reduce((s, r) => s + (r.score || 0), 0) / results.length);
  const summary = results.map(r => {
    const reason = r.reasoning ? r.reasoning.substring(0, 80) : '';
    return `Q${r.q}: ${r.score}점 (${reason})`;
  }).join('\n');

  const prompt = `학생 이름: ${studentName}
학생의 주관식 답안 채점 결과:
${summary}

평균 점수: ${totalScore}점

★ 위 결과를 보고 학생에게 줄 1~2문장 총평을 작성해주세요.

작성 규칙:
- "${studentName} 학생," 으로 시작
- 반말로 친근하게 (과외 선생님이 학생에게 말하듯)
- 좋은 뉘앙스 (격려 + 부드러운 조언)
- 강점과 약점을 균형있게 언급
- 절대 학생을 깎아내리거나 비난하지 말기

좋은 예시:
"${studentName} 학생, 시제랑 단복수가 좀 헷갈리는 것 같은데 의미 전달은 잘 했어. 'is/are' 같은 동사 변형만 한 번 더 체크하면 더 잘 할 수 있어!"

응답: 총평 1~2문장만 출력 (다른 설명, JSON, 마크다운 없이 텍스트만)`;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 500
        }
      })
    });
    if (!r.ok) return generateFallbackComment(studentName, results);
    const json = await r.json();
    const cand = (json.candidates || [])[0];
    let text = '';
    if (cand && cand.content && cand.content.parts) {
      text = cand.content.parts.map(p => p.text || '').join('');
    }
    text = text.trim();
    if (!text) return generateFallbackComment(studentName, results);
    return text;
  } catch(e) {
    return generateFallbackComment(studentName, results);
  }
}

// 코드 자동 폴백 총평 (Gemini 실패 시)
function generateFallbackComment(studentName, results) {
  if (!results || results.length === 0) return `${studentName} 학생, 답안 잘 제출했어!`;
  const total = results.length;
  const avgScore = Math.round(results.reduce((s, r) => s + (r.score || 0), 0) / total);
  const perfect = results.filter(r => r.score === 100).length;
  const zero = results.filter(r => r.score === 0).length;
  if (avgScore >= 90) {
    return `${studentName} 학생, 거의 완벽해! 정말 잘했어. 한두 개 작은 실수만 더 조심하면 돼.`;
  } else if (avgScore >= 70) {
    return `${studentName} 학생, 잘했어! ${perfect}개는 완벽한데 몇 개 작은 실수가 있네. 틀린 부분 다시 보면서 복습하자.`;
  } else if (avgScore >= 50) {
    return `${studentName} 학생, 절반 정도는 맞췄어. 틀린 문제 위주로 좀 더 연습하면 충분해. 화이팅!`;
  } else {
    return `${studentName} 학생, 이번엔 좀 어려웠나봐. 괜찮아, 천천히 하나씩 다시 보자!`;
  }
}

// Gemini 배치 호출
// ★ v22.7: gradingMode 추가 — loose=해석/번역(의역 인정), strict=단답형(엄격)
async function gradeBatchViaGemini(items, gradingMode) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return items.map(it => ({ q: it.q, score: 0, category: "ERROR", deductions: [], reasoning: "GEMINI_API_KEY 미설정" }));
  }
  // ★ v22.7: 모드별 채점 기준 분기
  const isLoose = String(gradingMode || '').toLowerCase() === 'loose';
  const RUBRIC = isLoose ? GRADING_RUBRIC_LOOSE : GRADING_RUBRIC;
  const modeLabel = isLoose ? "해석/번역 (의역 인정)" : "단답형/영작 (엄격)";
  const promptItems = items.map((it) =>
    `[문항 ${it.q}]\n학생 답안: "${it.studentAnswer}"\n정답: "${it.correctAnswer}"` +
    (it.questionContext ? `\n맥락: ${it.questionContext}` : '')
  ).join('\n\n');
  // ★ v23.9: 응답 형식을 기존 q/score 로 유지 (안정성 — v23.8의 새 형식은 timeout 위험)
  const prompt = RUBRIC +
    `\n\n채점 모드: ${modeLabel}\n채점 대상 (${items.length}개):\n${promptItems}\n\n` +
    `응답 예시 (이 형식만 사용 — JSON 배열만, 마크다운 X):\n[` +
    items.map(it => `{"q":"${it.q}","score":100,"category":"A","reasoning":"의미 동일","grammarTip":""}`).join(',') +
    `]`;
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
          maxOutputTokens: Math.min(8000, 400 * items.length + 800)
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
              maxOutputTokens: Math.min(8000, 400 * items.length + 800)
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

// ★ v23.8: 점수 → category 자동 매핑 (의미 기반 채점에서는 deductions 사용 X)
function _scoreToCategory(score) {
  if (score >= 95) return "A";
  if (score >= 85) return "B";
  if (score >= 60) return "C";
  if (score >= 30) return "D";
  return "E";
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
    // ★ v23.8: 새 응답 형식 → 기존 frontend 호환 형식으로 변환
    //   새 형식: { questionNumber, score, isCorrect, reason, correctionGuide[], acceptedExpressions[] }
    //   구 형식: { q, score, category, deductions[], reasoning, grammarTip }
    //   둘 다 처리 (q 와 questionNumber 모두 받아들임)
    // _overall element 가 섞여 있으면 제거 (혹시 AI 가 무시하고 넣은 경우 대응)
    parsed = parsed.filter(p => {
      const qn = p.questionNumber !== undefined ? p.questionNumber : p.q;
      return String(qn || "").indexOf("_overall") !== 0;
    });
    return parsed.map(p => {
      // 문항 번호 추출
      const qNum = p.questionNumber !== undefined ? p.questionNumber : p.q;
      let score = parseInt(p.score, 10);
      if (isNaN(score) || score < 0) score = 0;
      if (score > 100) score = 100;
      // 기존 deductions 사용 시에는 합산 검증 (구 형식 호환)
      if (Array.isArray(p.deductions) && p.deductions.length > 0) {
        const totalDed = p.deductions.reduce((s, d) => s + Math.abs(Number(d.amount) || 0), 0);
        const calc = Math.max(0, 100 - totalDed);
        if (Math.abs(score - calc) > 5) score = calc;
      }
      // category: 새 형식 (isCorrect) 우선, 없으면 점수 → 자동 매핑
      let category;
      if (p.category) {
        category = String(p.category).toUpperCase();
      } else {
        category = _scoreToCategory(score);
      }
      // reasoning: 새 형식 reason 우선
      const reasoning = String(p.reason || p.reasoning || '');
      // grammarTip: correctionGuide 배열 → 줄바꿈으로 합침 / 구 grammarTip
      let grammarTip = '';
      if (Array.isArray(p.correctionGuide) && p.correctionGuide.length > 0) {
        grammarTip = p.correctionGuide.join("\n");
      } else if (p.grammarTip) {
        grammarTip = String(p.grammarTip);
      }
      // acceptedExpressions 있으면 reasoning 뒤에 부가 정보로 표시
      let extraNote = '';
      if (Array.isArray(p.acceptedExpressions) && p.acceptedExpressions.length > 0) {
        extraNote = "\n인정 표현: " + p.acceptedExpressions.join(", ");
      }
      const orig = items.find(it => String(it.q) === String(qNum));
      return {
        q: qNum,
        parentQ: orig ? orig.parentQ : undefined,
        blank: orig ? orig.blank : undefined,
        score: score,
        category: category,
        deductions: Array.isArray(p.deductions) ? p.deductions : [],
        reasoning: reasoning + extraNote,
        grammarTip: grammarTip,
        // ★ v23.8: 새 필드 보존 (frontend 에서 활용 가능)
        isCorrect: typeof p.isCorrect === 'boolean' ? p.isCorrect : (score >= 90),
        correctionGuide: Array.isArray(p.correctionGuide) ? p.correctionGuide : [],
        acceptedExpressions: Array.isArray(p.acceptedExpressions) ? p.acceptedExpressions : []
      };
    });
  } catch (e) {
    return items.map(it => ({ q: it.q, parentQ: it.parentQ, blank: it.blank, score: 0, category: "ERROR", deductions: [], reasoning: "응답 파싱 실패: " + String(e), grammarTip: "" }));
  }
}

async function gradeSingleViaGemini(studentAnswer, correctAnswer, questionContext) {
  const result = await gradeBatchViaGemini([{ q: 1, studentAnswer, correctAnswer, questionContext }], 'strict');
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
  // ★ v22.4: 두 가지 정규화 비교 (정확/관대)
  //   - normExact: 끝의 문장부호만 제거 (대소문자/공백/끝 마침표 차이만 허용)
  //   - normLoose: 모든 쉼표 + 끝 문장부호 제거 (단순 나열 쉼표 차이 허용)
  //   둘 중 하나라도 일치하면 100점 (단순 나열의 쉼표 누락은 감점 X)
  const normExact = s => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!?,]+$/, '');
  const normLoose = s => String(s || '').toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
  return normExact(a) === normExact(b) || normLoose(a) === normLoose(b);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
