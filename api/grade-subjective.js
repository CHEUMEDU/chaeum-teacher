// ============================================================
// 채움학원 — 주관식 답안 자동 채점 API (Vercel Serverless Function)
// 파일 경로: chaeum-teacher/api/grade-subjective.js
// ============================================================
// 버전 이력
// ─────────────────────────────────────────
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

const VERSION = "v23.3"; // ★ v23.3: 해석시험 채점 기준 강화 — 핵심 내용·주제·어휘 반영, 의역 후한 인정

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// 5단계 채점 기준 (엄격 — 단어/영작/단답)
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
7. ★ 단순 나열의 쉼표(,) 누락은 감점하지 않음
   - 예: "balloon, honey, creative" ↔ "balloon honey creative" → 감점 X (단순 나열)
   - 예: "Pooh, Honey" ↔ "Pooh Honey" → 감점 X
   - 예: "사과, 배, 포도" ↔ "사과 배 포도" → 감점 X
   - 단순 명사 나열에서 쉼표는 가독성 도구일 뿐 문법 포인트가 아님
8. ★ 다음 경우의 쉼표 누락은 감점 (문법적 의미가 있음)
   - 분사구문 분리 (예: "Walking down the street, I saw a dog")
   - 부사절/주절 분리 (예: "When I came home, mom was cooking")
   - 동격 구문 (예: "My friend, John, is here")
   - 호격 (예: "Hello, Tom")
   - 학생이 이런 경우 쉼표를 빼면 "문장부호 누락 -5%" 감점

## 응답 필드 (필수)
- "q": 문항 번호
- "score": 0~100 점수
- "category": "A" / "B" / "C" / "D" / "E"
- "deductions": [{type, amount, reason}, ...] (빈 배열 가능)
- "reasoning": 채점 사유 (간략하게 1-2문장, 반말)
- "grammarTip": ★ 학생 학습용 문법/구문 팁 (1-3문장)

## ★ grammarTip 작성 규칙 (매우 중요)
- **반말로 친근하게** 쓰기 (과외 선생님이 학생에게 설명하듯)
- **좋은 뉘앙스** — 부드럽고 격려하는 톤 (질책 X)
- 학생이 이해할 수 있는 쉬운 표현
- 핵심 문법 포인트 1-2개 + 짧은 예시
- 정답인 경우 빈 문자열 ""

좋은 예시 (이렇게 써):
- "비교급은 'more~' 또는 '-er', 최상급은 'most~' 또는 '-est' 형태야. 'popular'는 긴 단어니까 'most popular' 로 써주면 돼!"
- "여기는 분사구문이야. 동사를 -ing 형태로 바꾸면 '~하면서' 의미가 돼. 예) 'Walking down the street' = '거리를 걸어가면서'"
- "to 부정사가 명사를 꾸밀 때는 '~할' 의미야. 'a movie to watch' = '볼 영화'. 외워두면 영작할 때 편해!"

나쁜 예시 (이렇게 쓰지 마):
- "오류가 있습니다." (반말 X, 격식체)
- "당신은 ~를 모르는 것 같습니다." (불쾌한 뉘앙스)
- 너무 어려운 문법 용어만 나열

## ★ overallComment (학생 총평) 별도 필드 — 응답 마지막에 1개
- 학생 이름으로 시작 (예: "{학생이름} 학생")
- 1~2 문장 반말로 친근하게
- 학생의 강점과 약점을 모두 균형있게 언급
- 격려 톤 (절대 깎아내리지 말기)

좋은 예시:
- "유지인 학생, 객관식은 거의 다 맞췄는데 주관식 영작에서 작은 실수가 많았어. 단어 철자랑 시제만 좀 더 신경 쓰면 더 잘 할 수 있어!"
- "유지인 학생, 시제랑 단복수 부분이 헷갈리는 것 같네. 그래도 의미는 잘 전달했어. 다음엔 'is/are' 같은 동사 변형을 한 번 더 체크해보자!"
- "유지인 학생, 거의 만점에 가까운 점수야! 정말 잘했어. 한두 개 작은 철자 실수만 더 조심하면 완벽해."
- "유지인 학생, 이번 시험은 좀 어려웠나봐. 괜찮아, 천천히 하나씩 다시 보자. 특히 비교급/최상급 부분 한 번 더 복습해봐."
`;

// ★ v22.7: 유연 채점 기준 (해석/번역 — 의역 인정)
const GRADING_RUBRIC_LOOSE = `
당신은 중·고등부 영어→한국어 해석/번역 시험 채점 전문가입니다.
학생이 **영어 원문의 핵심 내용·주제·주장·흐름**을 이해했는지를 중점적으로 판단하세요.
단어 단위가 아니라 **문장 전체의 의미 전달**을 봅니다.

## ★ 중·고등 해석시험 핵심 평가 기준 (★★★ 매우 중요)
1. **핵심 내용 이해**: 원문이 말하려는 핵심 메시지·주장·주제를 학생답이 담고 있는가?
2. **핵심 어휘 반영**: 주요 명사/동사/형용사가 의미상 정확히 반영되어 있는가?
   - 예: "global warming" → "지구온난화"/"지구온난화 현상" (정답) vs "환경 문제" (부분점수)
3. **문장 흐름·논리**: 주어-동사-목적어/보어 관계, 시제, 인과관계, 대조관계 등 흐름 파악
4. **의역 자유**: 직역하지 않아도, 의미가 통하고 자연스러우면 100점 인정
5. **학생의 이해도** > 모범답안 일치도 — 학생이 "안다"는 게 보이면 후하게

## ★ 해석 모드 절대 원칙
- 정답은 모범답안일 뿐 — 학생이 의역해도 핵심 의미가 통하면 정답
- **어순/조사 차이는 절대 감점하지 않음** (한국어는 어순 자유)
- 동의어/유사 표현 인정 ("말했다" = "이야기했다" = "언급했다" = "전했다")
- 한국어로 풀어쓴 표현 인정 ("a lot of" → "많은"/"수많은"/"엄청나게 많은")
- 자연스러운 한국어 우선시 — 직역 강요 X

## 5단계 채점 기준 (해석 모드 — 의역 후한 적용)

### A. 완전정답 (95~100점)
- **핵심 내용·주제·핵심 어휘 모두 살아있음** — 의역해도 OK
- 자연스러운 한국어로 의미가 명확히 전달됨
- 어순이 달라도, 의역해도, 동의어를 써도 정답
- 예시:
  - 정답: "그는 학교에 늦게 도착했다고 말했다"
  - 학생: "그가 학교에 늦었다고 얘기했다" → 100점 (의역 OK, 핵심 동일)
  - 학생: "그는 본인이 학교에 지각했다는 사실을 전했다" → 95점 (살짝 풀어쓴 의역)

### B. 거의 정답 (85~95점)
- 핵심 의미 정확, 핵심 어휘 살아있음
- 보조 표현 1개 약간 부자연스럽거나 의역 폭이 큼
- 사소한 오타 (1~2글자)
- 한국어 표현이 약간 어색해도 의미 전달은 OK

### C. 부분 정답 (60~85점)
- **핵심 메시지는 파악했음** — 학생이 무슨 내용인지는 알고 있음
- 보조 어휘 1~2개 누락 또는 의역 폭이 매우 큼
- 시제/태가 어색하지만 핵심 의미는 통함
- 핵심 어휘 1개 의미가 약간 변형 (완전 오역은 아님)

### D. 일부 오답 (30~60점)
- 일부 핵심 내용은 맞으나 **핵심 어휘/주어/목적어 1개가 잘못됨**
- 주제는 비슷하나 세부 내용에 명확한 오류
- 의미가 부분적으로 변형됨 (반전은 아님)

### E. 오답 (0~30점)
- **핵심 내용을 이해하지 못함** — 주제/주장 파악 실패
- 의미가 완전히 다르거나 반전 (긍정↔부정)
- 핵심 동사·명사 다수 잘못 → 흐름 자체를 못 잡음
- 빈칸, 미답, 의미 없는 단어 나열

## ★ 절대 감점하지 말 것 (★★★ 강조)
- 어순 차이 ("나는 사과를 먹었다" = "사과를 나는 먹었다")
- 조사 차이 ("-는/-은/-이/-가/-을/-를")
- 동의어 사용 ("매우" = "정말" = "아주")
- 자연스러운 의역 ("happy" → "기쁜" / "행복한")
- 한국어로 풀어쓴 표현 ("a lot of" → "많은" / "다수의" / "수많은")
- 줄임/생략 가능한 보조사 차이

## ★ 감점할 것 (★★★ 핵심)
- 핵심 동사 의미 변형 (예: "달렸다" → "걸었다") → C/D
- 핵심 명사 누락 (예: "엄마가 사과를" → "엄마가") → C/D
- 시제 큰 오류 (과거 → 현재로 잘못 해석) → C
- 부정/긍정 반전 (예: "좋아한다" ↔ "싫어한다") → E
- 주어/목적어 바뀜 → D
- 문장 일부 완전 누락 → D/E

## 응답 필드 (필수)
- "q": 문항 번호
- "score": 0~100 점수
- "category": "A" / "B" / "C" / "D" / "E"
- "deductions": [{type, amount, reason}, ...] (빈 배열 가능)
- "reasoning": 채점 사유 (1-2문장 반말, 의역 인정 여부 명시)
- "grammarTip": ★ 학습용 해석/번역 팁 (1-3문장 반말, 정답이면 빈 문자열)

## ★ grammarTip 작성 규칙 (해석 모드)
- 반말로 친근하게 (과외 선생님이 학생에게 설명하듯)
- 좋은 뉘앙스 (격려 + 부드러운 조언)
- 핵심 어휘·구문 1-2개 짚어주기
- 더 자연스러운 표현 제시

좋은 예시:
- "의미는 잘 전달했어! 'said'를 '말했다' 대신 '얘기했다'로 의역해도 OK야. 다만 시제가 과거니까 '말한다'(현재)는 피해줘."
- "'a lot of'는 '많은' 외에도 '수많은', '엄청난' 등으로 다양하게 의역할 수 있어. 한국어로 자연스러운 표현을 골라봐!"
- "분사구문 'Walking down the street'는 '거리를 걸어가면서' 또는 '거리를 걷다가' 둘 다 정답이야."

나쁜 예시 (해석 모드에서는 쓰지 마):
- "어순이 다르므로 감점" (★ 어순은 감점 대상 아님)
- "원문과 정확히 일치해야 함" (★ 의역 허용)

## ★ overallComment (학생 총평) — 응답 마지막에 1개
- 학생 이름으로 시작
- 1~2 문장 반말, 격려 톤
- 해석 능력의 강점·약점 균형있게

좋은 예시:
- "유지인 학생, 전체적으로 의미는 잘 파악하고 있어! 좀 더 자연스러운 한국어 표현을 익히면 완벽해질 거야."
- "유지인 학생, 핵심 의미는 잘 잡았는데 보조 단어들을 가끔 빼먹는 것 같아. 문장 전체를 한 번 더 훑어보면 좋겠어."
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
  const prompt = RUBRIC +
    `\n\n## 채점 모드: ${modeLabel}\n` +
    `## 채점 대상 (${items.length}개 문항)\n\n${promptItems}\n\n` +
    `## 응답 형식 (JSON 배열만 출력 — 마크다운 코드블록 금지)\n` +
    `[\n` +
    items.map(it => `  {"q": "${it.q}", "score": 95, "category": "B", "deductions": [{"type":"...", "amount":-5, "reason":"..."}], "reasoning": "...", "grammarTip": "..."}`).join(',\n') +
    `\n]\n\n각 문항을 위 채점 기준대로 평가해 ${items.length}개 항목 JSON 배열로만 응답하세요.\n` +
    `★ 중요: deductions 합계와 score 가 정확히 일치 (100 + 합계 = score, 0 미만은 0)\n` +
    `★ grammarTip: 학생이 이해할 수 있는 1-2문장 문법/구문 설명 (정답이면 "")` +
    (isLoose ? `\n★ 해석 모드: 어순/조사 차이 절대 감점 금지. 의미 통하면 정답.` : '');
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
