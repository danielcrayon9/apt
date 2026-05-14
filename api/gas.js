import { XMLParser } from "fast-xml-parser";

const GAS_URL = process.env.GAS_URL;
const MOLIT_API_KEY = process.env.MOLIT_API_KEY;
const MOLIT_API_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true
});

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function getRecentMonths(monthsBack) {
  const count = Math.max(1, Math.min(Number.parseInt(monthsBack, 10) || 3, 12));
  const now = new Date();

  return Array.from({ length: count }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const yyyy = month.getFullYear();
    const mm = String(month.getMonth() + 1).padStart(2, "0");
    return `${yyyy}${mm}`;
  });
}

function normalizeItems(items) {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  return [items];
}

async function fetchMolitMonth(lawdCd, dealYmd) {
  const params = new URLSearchParams({
    serviceKey: MOLIT_API_KEY,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    numOfRows: "100",
    pageNo: "1"
  });

  const response = await fetch(`${MOLIT_API_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`${dealYmd} 조회 실패 (${response.status})`);
  }

  const xml = await response.text();
  const parsed = xmlParser.parse(xml);
  const body = parsed?.response?.body;
  const resultCode = parsed?.response?.header?.resultCode;
  const resultMsg = parsed?.response?.header?.resultMsg;

  if (resultCode && resultCode !== "00") {
    throw new Error(`${dealYmd} API 오류: ${resultMsg || resultCode}`);
  }

  return normalizeItems(body?.items?.item);
}

async function getMolitData(lawdCd, monthsBack) {
  if (!MOLIT_API_KEY) {
    throw new Error("MOLIT_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  if (!lawdCd) {
    throw new Error("lawd_cd가 필요합니다.");
  }

  const monthResults = await Promise.allSettled(
    getRecentMonths(monthsBack).map((dealYmd) => fetchMolitMonth(lawdCd, dealYmd))
  );

  const data = [];
  const errors = [];

  for (const result of monthResults) {
    if (result.status === "fulfilled") {
      data.push(...result.value);
    } else {
      errors.push(result.reason?.message || String(result.reason));
    }
  }

  if (data.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    if (payload.action === "getMolitData") {
      const data = await getMolitData(payload.lawd_cd, payload.months_back);
      return sendJson(res, 200, { data });
    }

    if (!GAS_URL) {
      return sendJson(res, 500, { error: "GAS_URL 환경변수가 설정되지 않았습니다." });
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
