// ============================================================
// 📄 api/generate.js  |  v1.2  |  2026-05-11
// Vercel Serverless Function — POST /api/generate
// chaeum-teacher 프로젝트의 api/generate.js 로 들어가는 파일
// ============================================================
// v1.2 변경 (2026-05-11):
//   - 프롬프트 캐싱 TTL 5분 → 1시간 (cache_control ttl: "1h")
//   - 자가 검증 함수 추가 (보기 개수, 정답 일치, ID 연속성, 해설 길이, 난이도 분포)
//   - 부분 재생성 (실패 ID만 모델에 재요청, 최대 2회)
//   - 서술형 스키마 확장 (answer + recommendedAnswer + acceptableAnswers)
//   - warnings 배열 (재생성으로도 해결 안 된 항목 사용자에게 노출)
// v1.1 변경 (2026-05-09):
//   - JSON 파싱 robust화 (마크다운 코드 블록 자동 제거)
//   - 다중 시험 유형 + 유형별 비율 지원
// ============================================================
// 💡 OMR 선생님앱 통합 배포 메모:
//   - 이 파일은 chaeum-teacher 프로젝트의 api/ 폴더 안에 들어갑니다
//   - 같은 폴더의 api/ai-extract.js 처럼 Vercel Serverless Function 으로 동작
//   - lib/prompts.js 도 함께 chaeum-teacher 프로젝트 루트의 lib/ 폴더에 넣어야 작동
//   - 환경변수 ANTHROPIC_API_KEY 는 ai-extract 에서 이미 설정되어 있으니 추가 작업 X
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../lib/prompts.js";

const MODEL = "claude-sonnet-4-6";  // 기본 (Claude Sonnet)
// 변경 가능:
//   "claude-sonnet-4-6"  ← 기본 (추천)
//   "claude-haiku-4-5"   ← 저렴
//   "claude-opus-4-7"    ← 고급

const PRICING = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5":  { input: 1.0, output: 5.0,  cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-4-7":   { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 }
};
const USD_TO_KRW = 1380;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// 메인 핸들러
// ============================================================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST 요청만 허용됩니다." });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다. Vercel 대시보드에서 추가하세요."
    });
  }

  try {
    const params = req.body || {};
    const userPrompt = buildUserPrompt(params);

    // ── 1차 생성 ──
    const first = await callModel(userPrompt);
    if (first.error) return res.status(500).json(first.error);

    let questions = first.questions;
    let totalUsage = first.usage;

    // ── 자가 검증 + 부분 재생성 (최대 2회) ──
    let regenerationAttempts = 0;
    const warnings = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      const errors = validateQuestions(questions, params);
      if (errors.length === 0) break;

      console.log(`[generate] 검증 실패 ${errors.length}건, 재생성 시도 ${attempt+1}/2`);
      console.log(`[generate] errors:`, JSON.stringify(errors).slice(0, 500));

      // 실패한 문제 ID 추출
      const failedIds = [...new Set(errors.filter(e => e.id != null).map(e => e.id))];
      if (failedIds.length === 0) {
        // ID 무관 에러 (전체 카운트 등)는 재생성으로 못 고침 → 경고만
        warnings.push({ kind: "structural_error", errors });
        break;
      }

      const regen = await regenerateFailedQuestions(failedIds, errors, questions, params);
      if (regen.error) {
        warnings.push({ kind: "regen_failed", message: regen.error });
        break;
      }

      questions = mergeRegenerated(questions, regen.questions);
      totalUsage = mergeUsage(totalUsage, regen.usage);
      regenerationAttempts++;
    }

    // ── 최종 잔존 오류 (사용자에게 노출) ──
    const residualErrors = validateQuestions(questions, params);
    if (residualErrors.length > 0) {
      warnings.push({ kind: "validation_residual", count: residualErrors.length, errors: residualErrors });
    }

    return res.status(200).json({
      success: true,
      questions,
      summary: autoSummary(questions),
      warnings,
      meta: {
        model: MODEL,
        usage: {
          inputTokens: totalUsage.input_tokens,
          outputTokens: totalUsage.output_tokens,
          cacheReadTokens: totalUsage.cache_read_input_tokens || 0,
          cacheCreationTokens: totalUsage.cache_creation_input_tokens || 0
        },
        cost: computeCost(totalUsage),
        regenerationAttempts,
        validationPassed: residualErrors.length === 0
      }
    });

  } catch (err) {
    console.error("[generate] 오류:", err);

    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "API 호출 한도 초과. 잠시 후 다시 시도해주세요." });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(401).json({ error: "API 키가 잘못되었습니다. ANTHROPIC_API_KEY를 확인하세요." });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(err.status || 500).json({ error: `Anthropic API 오류 (${err.status}): ${err.message}` });
    }
    return res.status(500).json({ error: err.message || "알 수 없는 오류가 발생했습니다." });
  }
}

// ============================================================
// 모델 호출 (1차 생성 / 재생성 공용)
// ============================================================
async function callModel(userPrompt) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // ★ v1.2: TTL 1시간 — 같은 시스템 프롬프트로 1시간 안에 재호출 시 캐시 적중 (90% 비용 절감)
        cache_control: { type: "ephemeral", ttl: "1h" }
      }
    ],
    messages: [{ role: "user", content: userPrompt }]
  });

  const finalMessage = await stream.finalMessage();

  const textParts = finalMessage.content
    .filter(b => b.type === "text" && b.text && b.text.trim().length > 0)
    .map(b => b.text);

  if (textParts.length === 0) {
    return { error: { error: "모델이 빈 응답을 반환했습니다. 다시 시도해주세요.", debug: { stopReason: finalMessage.stop_reason } } };
  }

  const rawText = textParts.join("\n");

  let questionData;
  try {
    questionData = parseJsonRobust(rawText);
  } catch (e) {
    console.error("[callModel] JSON parse error:", e.message);
    console.error("[callModel] Raw response (first 2000 chars):", rawText.slice(0, 2000));
    return { error: { error: `모델 응답 파싱 실패: ${e.message}`, rawPreview: rawText.slice(0, 1500) } };
  }

  if (!questionData.questions || !Array.isArray(questionData.questions)) {
    return { error: { error: "모델 응답에 questions 배열이 없습니다.", rawPreview: rawText.slice(0, 1500) } };
  }

  return {
    questions: questionData.questions,
    usage: finalMessage.usage
  };
}

// ============================================================
// 자가 검증 — Layer 5 체크리스트 코드로 구현
// ============================================================
function validateQuestions(questions, params) {
  const errors = [];
  const expected = computeExpected(params);

  // 1) 총 문항수
  if (questions.length !== expected.total) {
    errors.push({ kind: "count_mismatch", got: questions.length, expected: expected.total });
  }

  questions.forEach((q, i) => {
    const id = q.id;

    // 2) ID 연속성
    if (q.id !== i + 1) {
      errors.push({ id: q.id ?? (i + 1), kind: "id_skip", got: q.id, expectedId: i + 1 });
    }

    // 3) difficulty 유효성
    if (!["easy", "mid", "hard"].includes(q.difficulty)) {
      errors.push({ id, kind: "invalid_difficulty", got: q.difficulty });
    }

    // 4) 객관식 검증
    if (q.type === "mc") {
      const expectedChoiceCount = q.difficulty === "easy" ? 4 : 5;
      const choiceLen = Array.isArray(q.choices) ? q.choices.length : 0;
      if (choiceLen !== expectedChoiceCount) {
        errors.push({
          id,
          kind: "mc_choice_count_wrong",
          got: choiceLen,
          expectedCount: expectedChoiceCount,
          difficulty: q.difficulty
        });
      }
      const matchCount = (q.choices || []).filter(c => c === q.answer).length;
      if (matchCount === 0) {
        errors.push({
          id,
          kind: "mc_answer_not_in_choices",
          answer: q.answer,
          choices: q.choices
        });
      } else if (matchCount > 1) {
        errors.push({ id, kind: "mc_answer_duplicate_in_choices", count: matchCount });
      }
    }

    // 5) 서술형 검증
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

    // 6) 정답 비어있지 않음
    if (!q.answer || String(q.answer).trim() === "") {
      errors.push({ id, kind: "empty_answer" });
    }

    // 7) explanation 최소 길이 (난이도별)
    const minExpLen = q.difficulty === "easy" ? 60 : q.difficulty === "hard" ? 150 : 100;
    const expLen = (q.explanation || "").length;
    if (expLen < minExpLen) {
      errors.push({
        id,
        kind: "explanation_too_short",
        got: expLen,
        minExpected: minExpLen,
        difficulty: q.difficulty
      });
    }
  });

  // 8) 난이도 분포 (±1 허용)
  const diffCounts = {
    easy: questions.filter(q => q.difficulty === "easy").length,
    mid:  questions.filter(q => q.difficulty === "mid").length,
    hard: questions.filter(q => q.difficulty === "hard").length
  };
  ["easy", "mid", "hard"].forEach(d => {
    if (Math.abs(diffCounts[d] - expected[d]) > 1) {
      errors.push({
        kind: "difficulty_distribution_off",
        level: d,
        got: diffCounts[d],
        expected: expected[d]
      });
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
// 부분 재생성 — 실패한 ID만 모델에 재요청
// ============================================================
async function regenerateFailedQuestions(failedIds, errors, currentQuestions, params) {
  const failedQs = currentQuestions.filter(q => failedIds.includes(q.id));
  const errorSummary = errors
    .map(e => e.id != null
      ? `Q${e.id}: ${e.kind}${e.got !== undefined ? ` (got=${JSON.stringify(e.got)})` : ""}${e.expectedCount !== undefined ? ` (expected count=${e.expectedCount})` : ""}${e.minExpected !== undefined ? ` (min=${e.minExpected})` : ""}`
      : `전체: ${e.kind}`
    )
    .join("\n");

  const regenPrompt = `[부분 재생성 요청]

다음 문제들이 검증에서 실패했습니다. 같은 \`id\`를 유지한 채 검증 오류를 모두 해결해 다시 작성해주세요.

## 검증 오류
${errorSummary}

## 재작성 대상 문제 (현재 상태)
${JSON.stringify(failedQs, null, 2)}

## 요구사항
- 위 문제들과 동일한 \`id\` 유지: ${failedIds.join(", ")}
- 시스템 가이드(Layer 1~5) 모든 룰 준수
- 특히 객관식은 \`choices\` 개수(easy=4, mid/hard=5)와 \`answer\`가 \`choices\`에 정확히 포함되는지 다시 확인
- \`explanation\` 글자수 (easy≥60, mid≥100, hard≥150)
- 응답은 다음 JSON 형식: \`{"questions": [...]}\`
- 재작성한 문제만 포함 (정상 문제는 넣지 말 것)
- JSON 외 일체 텍스트 금지`;

  try {
    const result = await callModel(regenPrompt);
    if (result.error) return { error: typeof result.error === "string" ? result.error : (result.error.error || "재생성 실패") };
    return { questions: result.questions, usage: result.usage };
  } catch (e) {
    return { error: String(e) };
  }
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

  // 1) 마크다운 코드 블록 제거: ```json ... ``` 또는 ``` ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  // 2) 첫 '{'부터 마지막 '}'까지 추출 (앞뒤 설명 텍스트 제거)
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("JSON 객체를 찾을 수 없습니다");
  }
  cleaned = cleaned.substring(start, end + 1);

  // 3) 흔한 trailing comma 정리
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");

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
    difficulty = { easy: 30, mid: 50, hard: 20 }
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
        return `    - ${s.name}: ${s.percentage}% (약 ${subCount}문제)`;
      }).join("\n");
    }
    return `- **${typeKr}**: ${t.percentage}% (약 ${typeCount}문제)\n${subLines}`;
  }).join("\n");

  return `다음 조건에 맞춰 영어 시험 문제 ${questionCount}개를 생성해주세요.

## 교재 정보
- 분류: ${CATEGORY_KR[bookCategory] || bookCategory}
- 교재명: ${bookName}
- 범위 (${rangeMode === "chapter" ? "챕터" : "페이지"}): ${rangesLine}

## 시험 유형 (혼합 출제)
${typeBlock}

## 문항 구성
- 총 문항수: ${questionCount}개
- 객관식: ${mcCount}개 (${mcRatio}%)
- 서술형: ${ssCount}개 (${100 - mcRatio}%)

## 난이도 분포
- 쉬움(easy): ${easyCount}개 (${difficulty.easy}%)
- 보통(mid): ${midCount}개 (${difficulty.mid}%)
- 어려움(hard): ${hardCount}개 (${difficulty.hard}%)

## 출력 규칙 (반드시 준수)
1. 응답은 **JSON 객체 하나만** 반환합니다.
2. 마크다운 코드 블록(\`\`\`)으로 감싸지 마세요.
3. JSON 외에 어떤 설명·인사·서론·결론도 추가하지 마세요.
4. \`questions\` 배열의 길이는 정확히 ${questionCount}이어야 합니다.
5. \`summary\` 필드의 값들도 위 분포와 정확히 일치해야 합니다.
6. \`passage\`가 필요 없는 문제(예: 단어 단답)는 빈 문자열 \`""\` 사용.
7. 서술형(\`type: "ss"\`)은 \`choices\`를 빈 배열 \`[]\`로, \`recommendedAnswer\`/\`acceptableAnswers\` 필드를 반드시 포함.
8. 객관식은 easy=4지, mid/hard=5지선다. \`answer\`는 \`choices\` 안에 정확히 포함된 문자열.
9. 응답 직전 Layer 5 자가 검증 체크리스트를 모두 통과시키세요.

지금 바로 JSON으로 응답하세요.`;
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
