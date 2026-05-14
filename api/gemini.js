const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGeminiError(status, message = "") {
  return status === 429 || status === 503 || /high demand|overloaded|try again later/i.test(message);
}

async function generateWithModel(model, prompt) {
  const response = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });

  const data = await response.json();
  const errorMessage = data.error?.message;

  if (!response.ok || data.error) {
    const error = new Error(errorMessage || "Gemini API 호출 중 오류가 발생했습니다.");
    error.status = response.status || 500;
    error.model = model;
    throw error;
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const error = new Error("AI 응답을 생성할 수 없습니다.");
    error.status = 502;
    error.model = model;
    throw error;
  }

  return { text, model };
}

async function generateWithFallback(prompt) {
  let lastError;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await generateWithModel(model, prompt);
      } catch (error) {
        lastError = error;
        if (!isRetryableGeminiError(error.status, error.message)) {
          throw error;
        }
        if (attempt === 0) {
          await sleep(700);
        }
      }
    }
  }

  throw lastError || new Error("Gemini API 호출 중 오류가 발생했습니다.");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!GEMINI_API_KEY) {
    return sendJson(res, 500, { error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다." });
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const prompt = payload.prompt;

    if (!prompt || typeof prompt !== "string") {
      return sendJson(res, 400, { error: "prompt가 필요합니다." });
    }

    const result = await generateWithFallback(prompt);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.status || 500, {
      error: error.message || "Gemini 프록시 호출 중 오류가 발생했습니다."
    });
  }
}
