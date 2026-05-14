const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
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

    const aiResponse = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const aiData = await aiResponse.json();
    if (!aiResponse.ok || aiData.error) {
      return sendJson(res, aiResponse.status || 500, {
        error: aiData.error?.message || "Gemini API 호출 중 오류가 발생했습니다."
      });
    }

    const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return sendJson(res, 502, { error: "AI 응답을 생성할 수 없습니다." });
    }

    return sendJson(res, 200, { text });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Gemini 프록시 호출 중 오류가 발생했습니다." });
  }
}
