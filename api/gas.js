const GAS_URL = process.env.GAS_URL;
const MOLIT_API_KEY = process.env.MOLIT_API_KEY;

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!GAS_URL) {
    return sendJson(res, 500, { error: "GAS_URL 환경변수가 설정되지 않았습니다." });
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    if (payload.action === "getMolitData") {
      if (!MOLIT_API_KEY) {
        return sendJson(res, 500, { error: "MOLIT_API_KEY 환경변수가 설정되지 않았습니다." });
      }
      payload.service_key = MOLIT_API_KEY;
    }

    const gasResponse = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const text = await gasResponse.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || "Google Apps Script 응답을 해석할 수 없습니다." };
    }

    return sendJson(res, gasResponse.ok ? 200 : gasResponse.status, data);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "GAS 프록시 호출 중 오류가 발생했습니다." });
  }
}
