// ============================================================
// 채움학원 — AI 시험 영역 분석 API (Vercel Serverless Function)
// 파일 경로: chaeum-teacher/api/analyze-exam-categories.js
// ============================================================
// 버전 이력
// ─────────────────────────────────────────
// v1.0 (2026-05-13)
//   ★ Gemini 2.5 Flash 로 문항별 영역 분류
//   ★ 영어: 문법 / 어휘 / 독해 / 구문 / 회화 / 어법 / 단어 / 해석
//   ★ 수학: 대수 / 기하 / 확률 / 통계 / 함수 / 도형 / 수와연산
//   ★ 국어: 문학 / 문법 / 독해 / 화법
//   ★ 학생앱 결과 화면에서 카테고리별 정답률 막대그래프 표시
//
// 입력 (POST JSON):
//   {
//     "subject": "영어",
//     "grade": "중2",
//     "examType": "문법시험",
//     "questions": [
//       {"number":1, "question":"...", "answer":"...", "choices":[...], "type":"obj"},
//       ...
//     ]
//   }
//
// 출력 (JSON):
//   {
//     "ok": true,
//     "version": "v1.0",
//     "categories": { "1": "문법", "2": "어휘", "3": "독해", ... },
//     "summary": {
//       "totalCategories": ["문법", "어휘", "독해"],
//       "byCategory": { "문법": [1,4,7,12], "어휘": [2,8], ... }
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

const CATEGORIES = {
  영어: ["문법", "어휘", "독해", "구문", "어법", "해석", "회화"],
  수학: ["대수", "기하", "확률", "통계", "함수", "수와연산"],
  국어: ["문학", "문법", "독해", "화법", "어휘"]
};

const PROMPT_TEMPLATE = (subject, grade, examType, cats, questionsBlock) => `
너는 채움학원의 시험 영역 분류 전문가다.
주어진 시험 문항 목록을 보고, 각 문항을 다음 영역 중 하나로 분류해라.

[과목] ${subject}
[학년] ${grade}
[시험종류] ${examType}

[허용된 영역]
${cats.join(" / ")}

[분류 원칙]
- 각 문항을 정확히 하나의 영역으로만 분류
- 명확한 영역이 없으면 가장 가까운 것 선택
- 답안과 선택지를 함께 참고하여 판단
- 영역명은 위에 명시한 것만 사용 (다른 이름 X)

[응답 — JSON 만, 마크다운 금지]
{
  "categories": {
    "1": "문법",
    "2": "어휘",
    ...
  }
}

[분류할 문항]
${questionsBlock}
`;

export default async function handler(req, res) {
  Object.keys(CORS_HEADERS).forEach(k => res.setHeader(k, CORS_HEADERS[k]));
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only', version: VERSION });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) {
      res.status(400).json({ ok: false, error: 'Invalid JSON: ' + String(e), version: VERSION });
      return;
    }
  }
  if (!body) body = {};

  const subject  = String(body.subject  || '').trim();
  const grade    = String(body.grade    || '').trim();
  const examType = String(body.examType || '').trim();
  const questions = Array.isArray(body.questions) ? body.questions : [];

  if (!subject) {
    res.status(400).json({ ok: false, error: 'subject 필수', version: VERSION });
    return;
  }
  if (questions.length === 0) {
    res.status(400).json({ ok: false, error: 'questions 배열 비어있음', version: VERSION });
    return;
  }

  // 영역 결정
  let cats = CATEGORIES[subject];
  if (!cats) {
    // 과목 이름이 영어로 들어왔을 경우
    if (subject.indexOf("영어") >= 0) cats = CATEGORIES.영어;
    else if (subject.indexOf("수학") >= 0) cats = CATEGORIES.수학;
    else if (subject.indexOf("국어") >= 0) cats = CATEGORIES.국어;
    else cats = ["기타1", "기타2", "기타3"];  // fallback
  }

  try {
    const result = await analyzeCategoriesViaGemini(subject, grade, examType, questions, cats);
    res.status(200).json({ ok: true, version: VERSION, ...result });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: 'Analysis failed: ' + String(e),
      version: VERSION
    });
  }
}

async function analyzeCategoriesViaGemini(subject, grade, examType, questions, cats) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 미설정');

  // 문항 블록 생성 (긴 본문은 잘라냄)
  const questionsBlock = questions.map(q => {
    const num = q.number || q.q || "?";
    const text = String(q.question || q.text || "").slice(0, 200);
    const ans = String(q.answer || q.a || "").slice(0, 50);
    const choicesStr = Array.isArray(q.choices) ? " | 선택지: " + q.choices.map(c => String(c).slice(0, 30)).join(" / ") : "";
    return `[${num}] ${text} (답: ${ans})${choicesStr}`;
  }).join("\n");

  const prompt = PROMPT_TEMPLATE(subject, grade, examType, cats, questionsBlock);

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);

  const callGemini = async () => {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: Math.min(8000, 50 * questions.length + 500)
        }
      })
    });
  };

  let r = await callGemini();
  if (!r.ok && r.status === 429) {
    await new Promise(res => setTimeout(res, 3000));
    r = await callGemini();
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Gemini HTTP ' + r.status + ': ' + txt.slice(0, 200));
  }

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
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); }
      catch (_) { throw new Error('JSON 파싱 실패'); }
    } else {
      throw new Error('JSON 파싱 실패');
    }
  }

  const categories = parsed.categories || {};

  // 검증 + 정규화
  const normalized = {};
  questions.forEach(q => {
    const num = String(q.number || q.q || "");
    const cat = String(categories[num] || "").trim();
    // 허용된 영역만 받아들임, 그 외는 첫 번째 영역으로
    normalized[num] = cats.indexOf(cat) >= 0 ? cat : cats[0];
  });

  // 영역별 그룹화
  const byCategory = {};
  Object.keys(normalized).forEach(num => {
    const c = normalized[num];
    if (!byCategory[c]) byCategory[c] = [];
    byCategory[c].push(Number(num));
  });

  return {
    categories: normalized,
    summary: {
      totalCategories: Object.keys(byCategory).sort(),
      byCategory: byCategory,
      questionCount: questions.length
    }
  };
}
