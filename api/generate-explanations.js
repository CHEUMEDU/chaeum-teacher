// ============================================================
// 채움학원 — 객관식 풀이·선택지 분석 즉시 생성 API
// 파일 경로: chaeum-teacher/api/generate-explanations.js
// ============================================================
// 버전 이력
// ─────────────────────────────────────────
// v1.0 (2026-05-13)
//   ★ Gemini 2.5 Flash 로 객관식 문항의 풀이 + 선택지별 분석 즉시 생성
//   ★ 학생앱 정오표 객관식 오답 클릭 시 호출 → 캐시 후 표시
//   ★ 옛 시험 (T열 explanations 없음) 도 학생이 즉시 풀이 확인 가능
//
// 입력 (POST JSON):
//   {
//     "subject": "영어",
//     "grade": "중2",
//     "questions": [
//       {"number":1, "question":"...", "answer":3, "choices":["①...", "②...", ...]},
//       {"number":7, ...}
//     ]
//   }
//
// 출력 (JSON):
//   {
//     "ok": true,
//     "version": "v1.0",
//     "explanations": {
//       "1": {
//         "explanation": "정답이 3인 이유 — ...",
//         "choiceExplanations": {
//           "1": "① 이 오답인 이유...",
//           "2": "② ...",
//           "3": "★ 정답: ...",
//           "4": "④ ...",
//           "5": "⑤ ..."
//         }
//       },
//       "7": { ... }
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

const PROMPT_TEMPLATE = (subject, grade, questionsBlock) => `
너는 채움학원의 ${subject} ${grade} 강사다.
주어진 객관식 문항들에 대해 정답 풀이 + 선택지별 분석을 작성해라.

[작성 원칙]
- 학생 입장에서 이해하기 쉽게 설명
- 친근한 반말 (선생님이 학생에게 설명하듯)
- 정답 이유는 명확하게, 1~2 문장
- 각 오답 선택지에 대해 "왜 오답인지" 1 문장으로 설명
- 정답 선택지에는 "★ 정답: ..." 형식

[응답 — JSON 만, 마크다운 금지]
{
  "explanations": {
    "1": {
      "explanation": "정답이 3인 이유 ...",
      "choiceExplanations": {
        "1": "이 오답인 이유 ...",
        "2": "이 오답인 이유 ...",
        "3": "★ 정답: ...",
        "4": "이 오답인 이유 ...",
        "5": "이 오답인 이유 ..."
      }
    },
    ...
  }
}

[분석할 문항]
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
  const questions = Array.isArray(body.questions) ? body.questions : [];

  if (questions.length === 0) {
    res.status(400).json({ ok: false, error: 'questions 배열 비어있음', version: VERSION });
    return;
  }
  if (questions.length > 20) {
    res.status(400).json({ ok: false, error: '한 번에 최대 20문항까지 (현재 ' + questions.length + '개)', version: VERSION });
    return;
  }

  try {
    const result = await generateExplanationsViaGemini(subject, grade, questions);
    res.status(200).json({ ok: true, version: VERSION, explanations: result });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: 'Generation failed: ' + String(e),
      version: VERSION
    });
  }
}

async function generateExplanationsViaGemini(subject, grade, questions) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 미설정');

  const questionsBlock = questions.map(q => {
    const num = q.number || q.q || "?";
    const text = String(q.question || q.text || "").slice(0, 400);
    const ans = String(q.answer || q.a || "");
    const choices = Array.isArray(q.choices) ? q.choices : [];
    let cStr = "";
    if (choices.length > 0) {
      cStr = "\n선택지:\n" + choices.map((c, i) => `  ${["①","②","③","④","⑤"][i] || (i+1)} ${String(c).slice(0, 100)}`).join("\n");
    }
    return `[${num}번 문항]\n${text}\n정답: ${ans}${cStr}`;
  }).join("\n\n");

  const prompt = PROMPT_TEMPLATE(subject || "일반", grade || "", questionsBlock);

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);

  const callGemini = async () => {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: Math.min(8000, 600 * questions.length + 500)
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

  return parsed.explanations || {};
}
