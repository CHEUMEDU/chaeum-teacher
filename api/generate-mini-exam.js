// ============================================================
// 채움학원 — 미니 보강 시험 자동 생성 API (Vercel Serverless Function)
// 파일 경로: chaeum-teacher/api/generate-mini-exam.js
// ============================================================
// 버전 이력
// ─────────────────────────────────────────
// v1.0 (2026-05-13)
//   ★ Gemini 2.5 Flash 로 5문항 미니 보강 시험 실시간 생성
//   ★ 개념 점검 5단계 구조 (concept → component → meaning → basic → application)
//   ★ 영어·수학·국어 공통 — 수학은 그래프·도형 제외 (텍스트·LaTeX만)
//   ★ 학생 약점 영역 + 본 시험 메타 입력 → 5문항 JSON 반환
//   ★ choiceExplanations (선택지별 분석) 포함
//   ★ GAS recommend_mini_exam_ 에서 호출
//
// 입력 (POST JSON):
//   {
//     "student": "김민준",
//     "subject": "영어",
//     "grade": "중2",
//     "level": "A",
//     "examType": "문법시험",
//     "weakArea": "객관식",      // "객관식" | "주관식" | "혼합"
//     "weakPct": 60,
//     "textbook": "Grammar Inside Level 3",
//     "range": "Unit 1~3",
//     "wrongQuestions": [3, 7, 12]   // 본 시험에서 틀린 문항 번호
//   }
//
// 출력 (JSON):
//   {
//     "ok": true,
//     "version": "v1.0",
//     "miniExam": {
//       "mode": "mini",
//       "miniInfo": { ... },
//       "questions": [
//         { "number":1, "stage":"concept", "type":"multiple_choice",
//           "question":"...", "choices":[...], "answer":2,
//           "explanation":"...", "choiceExplanations":{...} },
//         ... 5개
//       ]
//     }
//   }
// ============================================================

export const maxDuration = 60;

const VERSION = "v1.0";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// ============================================================
// 미니 보강 시험 출제 프롬프트
// ============================================================
const MINI_EXAM_PROMPT_BASE = `
너는 채움학원의 미니 보강 시험 출제 엔진이다.
학생이 본 시험에서 특정 영역(객관식/주관식)이 약했을 때, 즉시 풀 수 있는 5분짜리 미니 시험을 만든다.

[출제 원칙]
- 정확히 5문항만 출제 (이상도 이하도 X)
- 5문항이 다음 5단계 구조를 정확히 따른다:
  1. concept    — 핵심 개념·공식·규칙을 직접 묻기 (가장 기본)
  2. component  — 개념의 부분 요소·구성 묻기
  3. meaning    — 개념의 의미·왜 그런가 묻기
  4. basic      — 매우 간단한 예제로 개념 적용 (본 시험보다 쉬움)
  5. application — 본 시험에서 틀린 문항과 비슷한 유형 (본 시험 유사 난이도)
- 학생이 풀고 5분 안에 끝나도록 짧고 명확하게
- 응답은 JSON만 — 마크다운, 코드블록, 설명문 X

[과목별 제약]
- 수학: 그래프·도형 출제 절대 금지. 텍스트·LaTeX·수식만 ($$x^2+2x=3$$ 형태)
- 영어 해석 문제: 해석 직접 묻기 X. 대신 어휘/구문/시제/동의 표현/짧은 의미로 분해

[출제 형식 — 객관식 (mcRatio=100)]
- 4지선다 또는 5지선다
- 각 선택지마다 choiceExplanations 필수 (왜 정답·왜 오답)
- choices 배열: ["① ...", "② ...", "③ ...", "④ ...", "⑤ ..."] 형식
- answer: 1~5 정수 (정답 번호)

[출제 형식 — 서술형 (mcRatio=0)]
- 단답·키워드 위주 (한 단어 ~ 한 문장 정도)
- 풀이 과정 X
- gradingGuide.commonMistakes 에 자주 하는 오답 명시

[응답 JSON 스키마]
{
  "questions": [
    {
      "number": 1,
      "stage": "concept",                       // concept | component | meaning | basic | application
      "difficulty": "easy",                      // easy | medium | hard
      "type": "multiple_choice",                 // multiple_choice | short_answer
      "question": "문제 본문 (수학은 LaTeX 사용)",
      "choices": ["① ...", "② ...", "③ ...", "④ ..."],
      "answer": 2,
      "explanation": "정답 풀이 (1~2문장)",
      "choiceExplanations": {
        "1": "왜 ①이 오답인지",
        "2": "★ 정답 ② 이유",
        "3": "왜 ③이 오답인지",
        "4": "왜 ④이 오답인지"
      }
    }
  ]
}
`;

// ============================================================
// 메인 핸들러
// ============================================================
export default async function handler(req, res) {
  Object.keys(CORS_HEADERS).forEach(k => res.setHeader(k, CORS_HEADERS[k]));
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only', version: VERSION });
    return;
  }

  // body 파싱
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) {
      res.status(400).json({ ok: false, error: 'Invalid JSON: ' + String(e), version: VERSION });
      return;
    }
  }
  if (!body) body = {};

  // 입력 검증
  const student   = String(body.student   || '').trim();
  const subject   = String(body.subject   || '').trim();
  const grade     = String(body.grade     || '').trim();
  const level     = String(body.level     || '').trim();
  const examType  = String(body.examType  || '').trim();
  const weakArea  = String(body.weakArea  || '객관식').trim();
  const weakPct   = Number(body.weakPct)   || 0;
  const textbook  = String(body.textbook  || '').trim();
  const range     = String(body.range     || '').trim();
  const wrongQs   = Array.isArray(body.wrongQuestions) ? body.wrongQuestions : [];

  if (!subject) {
    res.status(400).json({ ok: false, error: 'subject 필수', version: VERSION });
    return;
  }

  try {
    const miniExam = await generateMiniExam({
      student, subject, grade, level, examType,
      weakArea, weakPct, textbook, range, wrongQs
    });
    res.status(200).json({ ok: true, version: VERSION, miniExam });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: 'Generation failed: ' + String(e),
      version: VERSION
    });
  }
}

// ============================================================
// Gemini 호출 + 5문항 생성
// ============================================================
async function generateMiniExam(input) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 미설정');

  // 객관식/주관식 비율 결정
  const isObj = input.weakArea === '객관식' || input.weakArea === '혼합';
  const isSub = input.weakArea === '주관식';
  const mcRatio = isObj ? 100 : 0;
  const subjectIsMath = input.subject.indexOf('수학') >= 0;
  const subjectIsEnglish = input.subject.indexOf('영어') >= 0;

  // 과목별 추가 지침
  let subjectHint = '';
  if (subjectIsMath) {
    subjectHint = `
[수학 미니 시험 — 절대 규칙]
- 그래프·도형·기하 도형 출제 절대 금지
- 모든 식은 LaTeX 표기 ($$x^2 + 2x + 1 = 0$$ 형태)
- 선택지도 LaTeX 가능
- 계산·공식 기억·식 분해 위주`;
  } else if (subjectIsEnglish) {
    subjectHint = `
[영어 미니 시험 — 해석 문제 분해]
- 해석 직접 묻지 말 것
- 어휘 / 구문 / 시제 / 동의 표현 / 짧은 문장 의미 로 분해
- 빈칸 채우기, 어법 고르기, 동의어 찾기 위주`;
  }

  // 학생 컨텍스트
  const studentCtx = `
[학생 정보]
- 이름: ${input.student || '학생'}
- 과목: ${input.subject}
- 학년·레벨: ${input.grade} ${input.level}
- 본 시험: ${input.examType}${input.textbook ? ' · ' + input.textbook : ''}${input.range ? ' · ' + input.range : ''}
- 약점 영역: ${input.weakArea} (정답률 ${input.weakPct}%)
- 본 시험에서 틀린 문항: ${input.wrongQs.length > 0 ? input.wrongQs.join(', ') + '번' : '(데이터 없음)'}`;

  const formatHint = mcRatio === 100
    ? `\n[출제 형식: 객관식 5문항 모두]`
    : `\n[출제 형식: 단답형 5문항 모두]`;

  const prompt = MINI_EXAM_PROMPT_BASE + subjectHint + studentCtx + formatHint +
    `\n\n[지금 5문항을 위 JSON 스키마로 생성해라. JSON 객체 하나만, 다른 텍스트 X.]`;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);

  const callGemini = async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,                       // 약간의 다양성 (같은 학생 두 번 풀이 시 다른 문제)
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 4000
        }
      })
    });
    return r;
  };

  let r = await callGemini();
  if (!r.ok) {
    // 429 (rate limit) 재시도
    if (r.status === 429) {
      await sleep(3000);
      r = await callGemini();
    }
    if (!r.ok) {
      const txt = await r.text();
      throw new Error('Gemini HTTP ' + r.status + ': ' + txt.slice(0, 200));
    }
  }

  // 응답 파싱
  const json = await r.json();
  const cand = (json.candidates || [])[0];
  if (!cand || !cand.content || !cand.content.parts) {
    throw new Error('Gemini 응답 형식 비정상');
  }
  let text = cand.content.parts.map(p => p.text || '').join('');
  text = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();

  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) {
    // JSON 파싱 실패 → 첫 { ~ 마지막 } 사이 추출 재시도
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); }
      catch (_) { throw new Error('JSON 파싱 실패: ' + e.message); }
    } else {
      throw new Error('JSON 파싱 실패: ' + e.message);
    }
  }

  // 응답 검증 + 정규화
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (questions.length === 0) {
    throw new Error('Gemini 가 questions 배열을 반환하지 않음');
  }

  // 5문항으로 맞춤 + stage 검증
  const stages = ['concept', 'component', 'meaning', 'basic', 'application'];
  const normalized = [];
  for (let i = 0; i < 5; i++) {
    const q = questions[i] || questions[questions.length - 1] || {};
    normalized.push({
      number: i + 1,
      stage: q.stage && stages.indexOf(q.stage) >= 0 ? q.stage : stages[i],
      difficulty: q.difficulty || (i < 3 ? 'easy' : i < 4 ? 'medium' : 'hard'),
      type: q.type || (mcRatio === 100 ? 'multiple_choice' : 'short_answer'),
      question: String(q.question || '').trim(),
      choices: Array.isArray(q.choices) ? q.choices : null,
      answer: q.answer !== undefined ? q.answer : null,
      explanation: String(q.explanation || '').trim(),
      choiceExplanations: q.choiceExplanations || null,
      gradingGuide: q.gradingGuide || null
    });
  }

  return {
    mode: 'mini',
    miniInfo: {
      weakArea: input.weakArea,
      weakPct: input.weakPct,
      studentName: input.student,
      stage5Structure: true,
      sourceExam: input.examType,
      textbook: input.textbook,
      range: input.range
    },
    questions: normalized,
    generatedAt: new Date().toISOString(),
    generator: 'gemini-2.5-flash'
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
