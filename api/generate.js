// ============================================================
// 📄 api/generate.js  |  v1.4  |  2026-05-11
// Vercel Serverless Function — POST /api/generate
// chaeum-teacher 프로젝트의 api/generate.js 로 들어가는 파일
// ============================================================
// v1.4 변경 (2026-05-11):
//   - PDF 첨부 입력 지원 (Claude document content) — 교재 본문 직접 활용
//   - max_tokens: 16000 → 32000 (50~100문제 생성 안정화)
//   - maxDuration: 60 → 120초 (대량 문제 + 재생성 여유)
//   - body 크기 제한 확대 (Vercel 기본 4.5MB → bodyParser sizeLimit 25MB)
// v1.3 변경 (2026-05-11):
//   - @anthropic-ai/sdk 제거 → fetch 로 직접 호출 (ai-extract.js 와 동일 패턴)
//   - 패키지 의존성 추가 불필요 (FUNCTION_INVOCATION_FAILED 해결)
//   - 모델: claude-sonnet-4-5-20250929 (실제 존재 모델)
// v1.2 변경 (2026-05-11):
//   - 자가 검증 함수 추가 (보기 개수·정답 일치·ID 연속성·해설 길이·난이도 분포)
//   - 부분 재생성 (실패 ID만 모델에 재요청, 최대 2회)
//   - 서술형 스키마 확장 (answer + recommendedAnswer + acceptableAnswers)
//   - warnings 배열 (재생성으로도 해결 안 된 항목 사용자에게 노출)
// ============================================================
// 💡 OMR 선생님앱 통합 배포 메모:
//   - chaeum-teacher 프로젝트의 api/ 폴더에 들어감
//   - 필요 파일: lib/prompts.js v3.0 (출판사 출제위원 페르소나 포함)
//   - 환경변수 ANTHROPIC_API_KEY (이미 ai-extract 에서 설정됨)
//   - PDF 입력: body.pdfFiles = [{name, base64}, ...] (최대 3개, 합계 25MB)
// ============================================================

import { SYSTEM_PROMPT } from "../lib/prompts.js";

export const maxDuration = 120;  // Vercel Node Runtime 한도 (Pro 플랜)

// body 크기 제한 확대 (PDF 첨부용)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb'
    }
  }
};

const VERSION = "v1.4";
const MODEL = "claude-sonnet-4-5-20250929";

const PRICING = {
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 }
};
const USD_TO_KRW = 1380;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY 미설정', version: VERSION });
    return;
  }

  // body 파싱 (text/plain 또는 application/json 모두 지원)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) {
      res.status(400).json({ ok: false, error: 'Invalid JSON: ' + String(e), version: VERSION });
      return;
    }
  }
  if (!body) body = {};

  try {
    const params = body;
    const pdfFiles = Array.isArray(params.pdfFiles) ? params.pdfFiles.filter(f => f && f.base64) : [];
    const userPrompt = buildUserPrompt(params);

    console.log('[generate] params:', JSON.stringify({
      bookCategory: params.bookCategory,
      bookName: params.bookName,
      questionCount: params.questionCount,
      pdfCount: pdfFiles.length,
      pdfNames: pdfFiles.map(f => f.name)
    }));

    // ── 1차 생성 ──
    const first = await callClaude(apiKey, userPrompt, pdfFiles);
    if (first.error) {
      res.status(500).json({ ok: false, error: first.error, debug: first.debug || null, version: VERSION });
      return;
    }

    let questions = first.questions;
    let totalUsage = first.usage;

    // ── 자가 검증 + 부분 재생성 (최대 2회) ──
    let regenerationAttempts = 0;
    const warnings = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      const errors = validateQuestions(questions, params);
      if (errors.length === 0) break;

      console.log('[generate] 검증 실패 ' + errors.length + '건, 재생성 시도 ' + (attempt+1) + '/2');

      const failedIds = [...new Set(errors.filter(e => e.id != null).map(e => e.id))];
      if (failedIds.length === 0) {
        warnings.push({ kind: "structural_error", errors });
        break;
      }

      // 재생성은 PDF 빼고 (이미 본문 정보가 questions 안에 들어있음 + 비용 절감)
      const regen = await regenerateFailedQuestions(apiKey, failedIds, errors, questions, params);
      if (regen.error) {
        warnings.push({ kind: "regen_failed", message: regen.error });
        break;
      }
      questions = mergeRegenerated(questions, regen.questions);
      totalUsage = mergeUsage(totalUsage, regen.usage);
      regenerationAttempts++;
    }

    const residualErrors = validateQuestions(questions, params);
    if (residualErrors.length > 0) {
      warnings.push({ kind: "validation_residual", count: residualErrors.length, errors: residualErrors });
    }

    res.status(200).json({
      success: true,
      questions,
      summary: autoSummary(questions),
      warnings,
      meta: {
        model: MODEL,
        version: VERSION,
        pdfAttached: pdfFiles.length,
        usage: {
          inputTokens: totalUsage.input_tokens || 0,
          outputTokens: totalUsage.output_tokens || 0,
          cacheReadTokens: totalUsage.cache_read_input_tokens || 0,
          cacheCreationTokens: totalUsage.cache_creation_input_tokens || 0
        },
        cost: computeCost(totalUsage),
        regenerationAttempts,
        validationPassed: residualErrors.length === 0
      }
    });

  } catch (err) {
    console.error('[generate] 오류:', err);
    res.status(500).json({
      ok: false,
      error: err.message || '알 수 없는 오류가 발생했습니다.',
      stack: String(err.stack || '').substring(0, 500),
      version: VERSION
    });
  }
}

// ============================================================
// Claude API 호출 (fetch 방식 + PDF document 입력 지원)
// ============================================================
async function callClaude(apiKey, userPrompt, pdfFiles = []) {
  // user content 구성: PDF 첨부가 있으면 document 블록 + text 블록
  const userContent = [];

  pdfFiles.forEach(f => {
    if (f.base64) {
      userContent.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: stripDataUrl(f.base64)
        }
      });
    }
  });

  // 텍스트 프롬프트는 항상 마지막에 (PDF 분석 결과를 반영하라는 지시)
  userContent.push({ type: 'text', text: userPrompt });

  const payload = {
    model: MODEL,
    max_tokens: 32000,  // 50~100문제 안정 생성
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }  // 5분 TTL (시스템 프롬프트 캐싱)
      }
    ],
    messages: [{ role: "user", content: userContent }]
  };

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return { error: 'fetch 실패: ' + e.message };
  }

  const text = await r.text();
  if (!r.ok) {
    let detail = '';
    try {
      const errJson = JSON.parse(text);
      detail = (errJson.error && (errJson.error.message || errJson.error.type)) || '';
    } catch (_e) {}
    return {
      error: 'Anthropic HTTP ' + r.status + (detail ? ' — ' + detail.substring(0, 300) : ''),
      debug: { rawHttp: text.substring(0, 800) }
    };
  }

  let json;
  try { json = JSON.parse(text); }
  catch (e) {
    return { error: 'JSON 파싱 실패: ' + e.message, debug: { rawHttp: text.substring(0, 800) } };
  }

  const blocks = json.content || [];
  const rawText = blocks.filter(b => b.type === 'text').map(b => b.text).join('');

  if (!rawText.trim()) {
    return { error: '모델이 빈 응답을 반환했습니다.', debug: { stopReason: json.stop_reason } };
  }

  let questionData;
  try {
    questionData = parseJsonRobust(rawText);
  } catch (e) {
    return { error: '모델 응답 파싱 실패: ' + e.message, debug: { rawPreview: rawText.substring(0, 1500) } };
  }

  if (!questionData.questions || !Array.isArray(questionData.questions)) {
    return { error: 'questions 배열 없음', debug: { rawPreview: rawText.substring(0, 1500) } };
  }

  return {
    questions: questionData.questions,
    usage: json.usage || { input_tokens: 0, output_tokens: 0 }
  };
}

// data URL 접두사 제거 (data:application/pdf;base64,XXXX → XXXX)
function stripDataUrl(s) {
  if (typeof s !== 'string') return '';
  const idx = s.indexOf('base64,');
  return idx >= 0 ? s.substring(idx + 7) : s;
}

// ============================================================
// 자가 검증 — Layer 6 체크리스트 코드로 구현
// ============================================================
function validateQuestions(questions, params) {
  const errors = [];
  const expected = computeExpected(params);

  if (questions.length !== expected.total) {
    errors.push({ kind: "count_mismatch", got: questions.length, expected: expected.total });
  }

  questions.forEach((q, i) => {
    const id = q.id;

    if (q.id !== i + 1) {
      errors.push({ id: q.id != null ? q.id : (i + 1), kind: "id_skip", got: q.id, expectedId: i + 1 });
    }

    if (!["easy", "mid", "hard"].includes(q.difficulty)) {
      errors.push({ id, kind: "invalid_difficulty", got: q.difficulty });
    }

    if (q.type === "mc") {
      const expectedChoiceCount = q.difficulty === "easy" ? 4 : 5;
      const choiceLen = Array.isArray(q.choices) ? q.choices.length : 0;
      if (choiceLen !== expectedChoiceCount) {
        errors.push({ id, kind: "mc_choice_count_wrong", got: choiceLen, expectedCount: expectedChoiceCount, difficulty: q.difficulty });
      }
      const matchCount = (q.choices || []).filter(c => c === q.answer).length;
      if (matchCount === 0) {
        errors.push({ id, kind: "mc_answer_not_in_choices", answer: q.answer, choices: q.choices });
      } else if (matchCount > 1) {
        errors.push({ id, kind: "mc_answer_duplicate_in_choices", count: matchCount });
      }
    }

    if (q.type === "ss") {
      if (Array.isArray(q.choices) && q.choices.length > 0) {
        errors.push({ id, kind: "ss_should_have_empty_choices", got: q.choices.length });
      }
      if (!q.recommendedAnswer || String(q.recommendedAnswer).trim() === "") {
        errors.push({ id, kind: "ss_missing_recommended_answer" });
      }
      if (!Array.isArray(q.acceptableAnswers)) {
        errors.push({ id, kind: "ss_missing_acceptable_answers_array" });
      }
    }

    if (!q.answer || String(q.answer).trim() === "") {
      errors.push({ id, kind: "empty_answer" });
    }

    const minExpLen = q.difficulty === "easy" ? 60 : q.difficulty === "hard" ? 150 : 100;
    const expLen = (q.explanation || "").length;
    if (expLen < minExpLen) {
      errors.push({ id, kind: "explanation_too_short", got: expLen, minExpected: minExpLen, difficulty: q.difficulty });
    }
  });

  const diffCounts = {
    easy: questions.filter(q => q.difficulty === "easy").length,
    mid:  questions.filter(q => q.difficulty === "mid").length,
    hard: questions.filter(q => q.difficulty === "hard").length
  };
  ["easy", "mid", "hard"].forEach(d => {
    if (Math.abs(diffCounts[d] - expected[d]) > 1) {
      errors.push({ kind: "difficulty_distribution_off", level: d, got: diffCounts[d], expected: expected[d] });
    }
  });

  return errors;
}

function computeExpected(params) {
  const total = Number(params.questionCount) || 30;
  const diff = params.difficulty || { easy: 30, mid: 50, hard: 20 };
  const easy = Math.round((total * diff.easy) / 100);
  const mid  = Math.round((total * diff.mid)  / 100);
  const hard = total - easy - mid;
  return { total, easy, mid, hard };
}

// ============================================================
// 부분 재생성 — 실패한 ID만 모델에 재요청 (PDF 없이)
// ============================================================
async function regenerateFailedQuestions(apiKey, failedIds, errors, currentQuestions, params) {
  const failedQs = currentQuestions.filter(q => failedIds.includes(q.id));
  const errorSummary = errors
    .map(e => e.id != null
      ? 'Q' + e.id + ': ' + e.kind + (e.got !== undefined ? ' (got=' + JSON.stringify(e.got) + ')' : '') + (e.expectedCount !== undefined ? ' (expected count=' + e.expectedCount + ')' : '') + (e.minExpected !== undefined ? ' (min=' + e.minExpected + ')' : '')
      : '전체: ' + e.kind
    )
    .join('\n');

  const regenPrompt = '[부분 재생성 요청]\n\n다음 문제들이 검증에서 실패했습니다. 같은 `id`를 유지한 채 검증 오류를 모두 해결해 다시 작성해주세요.\n\n## 검증 오류\n' + errorSummary + '\n\n## 재작성 대상 문제 (현재 상태)\n' + JSON.stringify(failedQs, null, 2) + '\n\n## 요구사항\n- 위 문제들과 동일한 `id` 유지: ' + failedIds.join(', ') + '\n- 시스템 가이드(Layer 1~6) 모든 룰 준수\n- 특히 객관식은 `choices` 개수(easy=4, mid/hard=5)와 `answer`가 `choices`에 정확히 포함되는지 다시 확인\n- `explanation` 글자수 (easy≥60, mid≥100, hard≥150)\n- 응답은 다음 JSON 형식: `{"questions": [...]}`\n- 재작성한 문제만 포함 (정상 문제는 넣지 말 것)\n- JSON 외 일체 텍스트 금지';

  const result = await callClaude(apiKey, regenPrompt, []);  // PDF 없이 재호출
  if (result.error) return { error: result.error };
  return { questions: result.questions, usage: result.usage };
}

function mergeRegenerated(original, regenerated) {
  const regenMap = new Map(regenerated.map(q => [q.id, q]));
  return original.map(q => regenMap.has(q.id) ? regenMap.get(q.id) : q);
}

function mergeUsage(a, b) {
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
    cache_read_input_tokens: (a.cache_read_input_tokens || 0) + (b.cache_read_input_tokens || 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens || 0) + (b.cache_creation_input_tokens || 0)
  };
}

// ============================================================
// robust JSON 추출 + 파싱
// ============================================================
function parseJsonRobust(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('JSON 객체를 찾을 수 없습니다');
  }
  cleaned = cleaned.substring(start, end + 1);
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

  return JSON.parse(cleaned);
}

// ============================================================
// 자동 summary 계산
// ============================================================
function autoSummary(questions) {
  const total = questions.length;
  const mc   = questions.filter(q => q.type === "mc").length;
  const easy = questions.filter(q => q.difficulty === "easy").length;
  const mid  = questions.filter(q => q.difficulty === "mid").length;
  return {
    total,
    mcCount: mc,
    ssCount: total - mc,
    easyCount: easy,
    midCount: mid,
    hardCount: total - easy - mid
  };
}

// ============================================================
// 유저 프롬프트 빌더
// ============================================================
function buildUserPrompt(p) {
  const {
    bookCategory = "grammar",
    bookName = "(미지정)",
    ranges = [],
    rangeMode = "chapter",
    testTypes = [{ type: "grammar", percentage: 100, subtypes: [] }],
    questionCount = 30,
    mcRatio = 60,
    difficulty = { easy: 30, mid: 50, hard: 20 },
    pdfFiles = []
  } = p;

  const mcCount   = Math.round((questionCount * mcRatio) / 100);
  const ssCount   = questionCount - mcCount;
  const easyCount = Math.round((questionCount * difficulty.easy) / 100);
  const midCount  = Math.round((questionCount * difficulty.mid)  / 100);
  const hardCount = questionCount - easyCount - midCount;

  const rangesLine = ranges.length > 0 ? ranges.join(", ") : "(전체 범위)";

  const typeBlock = testTypes.map(t => {
    const typeCount = Math.round((questionCount * t.percentage) / 100);
    const typeKr = TYPE_KR[t.type] || t.type;
    let subLines = "  (전체 세부 유형 균등 분포)";
    if (t.subtypes && t.subtypes.length > 0) {
      subLines = t.subtypes.map(s => {
        const subCount = Math.round((typeCount * s.percentage) / 100);
        return '    - ' + s.name + ': ' + s.percentage + '% (약 ' + subCount + '문제)';
      }).join("\n");
    }
    return '- **' + typeKr + '**: ' + t.percentage + '% (약 ' + typeCount + '문제)\n' + subLines;
  }).join("\n");

  // PDF 첨부 가이드 (있을 때만)
  const pdfBlock = pdfFiles.length > 0
    ? '\n## 📎 첨부 교재 PDF (' + pdfFiles.length + '개)\n' +
      pdfFiles.map((f, i) => '- ' + (i+1) + '. ' + (f.name || '교재' + (i+1) + '.pdf')).join('\n') +
      '\n\n**중요**: 첨부된 PDF 본문을 우선 분석한 후, 본문에 등장한 어휘·문장·예문을 기반으로 문제를 출제하세요.\n' +
      '본문에 없는 어휘·문법을 정답 근거로 사용하지 마세요.\n'
    : '\n## 📎 교재 PDF\n첨부되지 않음. "' + bookName + '"의 일반적 수준 기준으로 출제하세요.\n';

  return '다음 조건에 맞춰 영어 시험 문제 ' + questionCount + '개를 생성해주세요.\n\n' +
    '## 교재 정보\n' +
    '- 분류: ' + (CATEGORY_KR[bookCategory] || bookCategory) + '\n' +
    '- 교재명: ' + bookName + '\n' +
    '- 범위 (' + (rangeMode === "chapter" ? "챕터" : "페이지") + '): ' + rangesLine + '\n' +
    pdfBlock + '\n' +
    '## 시험 유형 (혼합 출제)\n' + typeBlock + '\n\n' +
    '## 문항 구성\n' +
    '- 총 문항수: ' + questionCount + '개\n' +
    '- 객관식: ' + mcCount + '개 (' + mcRatio + '%)\n' +
    '- 서술형: ' + ssCount + '개 (' + (100 - mcRatio) + '%)\n\n' +
    '## 난이도 분포\n' +
    '- 쉬움(easy): ' + easyCount + '개 (' + difficulty.easy + '%) — 보기 4개\n' +
    '- 보통(mid): ' + midCount + '개 (' + difficulty.mid + '%) — 보기 5개\n' +
    '- 어려움(hard): ' + hardCount + '개 (' + difficulty.hard + '%) — 보기 5개\n\n' +
    '## 출력 규칙 (반드시 준수)\n' +
    '1. 응답은 **JSON 객체 하나만** 반환합니다.\n' +
    '2. 마크다운 코드 블록(```)으로 감싸지 마세요.\n' +
    '3. JSON 외에 어떤 설명·인사·서론·결론도 추가하지 마세요.\n' +
    '4. `questions` 배열의 길이는 정확히 ' + questionCount + '이어야 합니다.\n' +
    '5. `summary` 필드의 값들도 위 분포와 정확히 일치해야 합니다.\n' +
    '6. `passage`가 필요 없는 문제(예: 단어 단답)는 빈 문자열 `""` 사용.\n' +
    '7. 서술형(`type: "ss"`)은 `choices`를 빈 배열 `[]`로, `recommendedAnswer`/`acceptableAnswers` 필드를 반드시 포함.\n' +
    '8. 객관식은 easy=4지, mid/hard=5지선다. `answer`는 `choices` 안에 정확히 포함된 문자열 (대소문자·구두점 완전 일치).\n' +
    '9. 응답 직전 Layer 6 자가 검수 체크리스트 16개 항목을 모두 통과시키세요.\n\n' +
    '⚠️ 가장 자주 발생하는 실수: 객관식 `answer`와 `choices` 안 정답 문자열이 미세하게 다른 경우 (앞뒤 공백·구두점). 반드시 일치시키세요.\n\n' +
    '지금 바로 JSON으로 응답하세요.';
}

const CATEGORY_KR = {
  grammar: "문법", writing: "서술형", syntax: "구문",
  vocab: "단어", reading: "리딩", mock: "모의고사"
};
const TYPE_KR = {
  grammar: "📝 문법 (어법, 빈칸, 문장 변형 등)",
  vocab: "🔤 단어 (의미, 철자, 동의·반의어 등)",
  reading: "📖 리딩 (주제, 추론, 순서 등)",
  writing: "✍️ 서술형 (영작, 어순, 빈칸 채우기 등)",
  translation: "🌐 해석 (영→한 번역, 구문 분석)"
};

// ============================================================
// 비용 계산
// ============================================================
function computeCost(usage) {
  const p = PRICING[MODEL];
  if (!p) return null;
  const inputCost      = ((usage.input_tokens || 0) / 1_000_000) * p.input;
  const outputCost     = ((usage.output_tokens || 0) / 1_000_000) * p.output;
  const cacheReadCost  = ((usage.cache_read_input_tokens || 0) / 1_000_000) * p.cacheRead;
  const cacheWriteCost = ((usage.cache_creation_input_tokens || 0) / 1_000_000) * p.cacheWrite;
  const totalUSD = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return {
    usd: totalUSD.toFixed(4),
    krw: Math.round(totalUSD * USD_TO_KRW),
    cached: (usage.cache_read_input_tokens || 0) > 0
  };
}
