// ============================================================
// 채움학원 — 시험지 PDF에서 특정 문항 본문 추출 API
// 파일 경로: chaeum-teacher/api/extract-question-from-pdf.js
// ============================================================
// 버전 이력
// ─────────────────────────────────────────
// v1.0 (2026-05-13)
//   ★ Gemini 2.5 Flash 가 시험지 PDF (Base64) 를 분석하여
//     지정된 문항 번호들의 본문 + 선택지를 추출
//   ★ Top 7 오답노트 PDF 에서 영어 문제 본문 자동 채움 (옛 시험 대응)
//   ★ 한 번 호출로 최대 20문항 추출 (배치)
//
// 입력 (POST JSON):
//   {
//     "subject": "영어",
//     "grade": "중2",
//     "pdfBase64": "JVBERi0xLjQK...",     ← 시험지 PDF Base64
//     "questionNumbers": [2, 5, 9, 12]     ← 추출할 문항 번호
//   }
//
// 출력 (JSON):
//   {
//     "ok": true,
//     "version": "v1.0",
//     "questions": {
//       "2": {
//         "question": "I'm going ___ school. Choose the correct preposition.",
//         "choices": ["at", "in", "to", "on", "for"]
//       },
//       "5": { ... }
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

const PROMPT_TEMPLATE = (subject, grade, qNumStr) => `
당신은 시험지 OCR 전문가입니다.
주어진 시험지 PDF 에서 지정된 문항 번호의 본문과 선택지를 정확히 추출합니다.

[과목] ${subject}
[학년] ${grade}
[추출할 문항 번호] ${qNumStr}

[원칙]
- PDF 의 문항을 보고 본문 그대로 옮기세요. 추측이나 의역 금지
- 영어 문제는 영어 그대로
- 객관식이면 ①②③④⑤ 선택지도 포함 (배열로)
- 주관식이면 choices 는 null
- 본문에 그래프·도형 있으면 텍스트로 묘사 (예: "원의 반지름 그림")
- 본문이 너무 길면 핵심 부분만 (300자 이내)

[응답 — JSON 만, 마크다운 금지]
{
  "questions": {
    "2": {
      "question": "문항 본문",
      "choices": ["선택지1", "선택지2", "선택지3", "선택지4", "선택지5"]
    },
    "5": {
      "question": "주관식 문항 본문",
      "choices": null
    }
  }
}
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

  const subject = String(body.subject || '').trim();
  const grade = String(body.grade || '').trim();
  let pdfBase64 = String(body.pdfBase64 || body.base64 || '').trim();
  const questionNumbers = Array.isArray(body.questionNumbers) ? body.questionNumbers.map(Number) : [];

  if (!pdfBase64) {
    res.status(400).json({ ok: false, error: 'pdfBase64 필수', version: VERSION });
    return;
  }
  if (questionNumbers.length === 0) {
    res.status(400).json({ ok: false, error: 'questionNumbers 비어있음', version: VERSION });
    return;
  }
  if (questionNumbers.length > 20) {
    res.status(400).json({ ok: false, error: '최대 20문항 (현재 ' + questionNumbers.length + '개)', version: VERSION });
    return;
  }

  // base64 prefix 제거
  if (pdfBase64.indexOf(',') >= 0) pdfBase64 = pdfBase64.split(',').pop();

  try {
    const result = await extractViaGemini(subject, grade, pdfBase64, questionNumbers);
    res.status(200).json({ ok: true, version: VERSION, questions: result });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: 'Extraction failed: ' + String(e),
      version: VERSION
    });
  }
}

async function extractViaGemini(subject, grade, pdfBase64, qNums) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 미설정');

  const qNumStr = qNums.join(', ') + '번';
  const prompt = PROMPT_TEMPLATE(subject || '일반', grade || '', qNumStr);
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: Math.min(8000, 500 * qNums.length + 500)
    }
  };

  const callGemini = async () => {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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

  return parsed.questions || {};
}
