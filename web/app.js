// State and Elements
let state = {
    gasUrl: localStorage.getItem('gas_url') || '',
    molitKey: localStorage.getItem('molit_key') || '',
    geminiKey: localStorage.getItem('gemini_key') || '',
    baseData: [], // Stores fetched MOLIT data
    searchHistory: []
};

// DOM Elements
const els = {
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    gasUrlInput: document.getElementById('gasUrlInput'),
    molitKeyInput: document.getElementById('molitKeyInput'),
    geminiKeyInput: document.getElementById('geminiKeyInput'),
    
    sidoSelect: document.getElementById('sidoSelect'),
    sigunguSelect: document.getElementById('sigunguSelect'),
    fetchDataBtn: document.getElementById('fetchDataBtn'),
    loadingBaseData: document.getElementById('loadingBaseData'),
    
    historyContainer: document.getElementById('historyContainer'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    
    aptSelectionArea: document.getElementById('aptSelectionArea'),
    emptyAptState: document.getElementById('emptyAptState'),
    aptInput: document.getElementById('aptInput'),
    aptList: document.getElementById('aptList'),
    sizesGroup: document.getElementById('sizesGroup'),
    sizeRadios: document.getElementById('sizeRadios'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    cachedResultAlert: document.getElementById('cachedResultAlert'),
    
    analysisResultSection: document.getElementById('analysisResultSection'),
    analysisProgress: document.getElementById('analysisProgress'),
    progressText: document.getElementById('progressText'),
    analysisContent: document.getElementById('analysisContent')
};

// --- Initialization ---
function init() {
    // Load Settings
    els.gasUrlInput.value = state.gasUrl;
    els.molitKeyInput.value = state.molitKey;
    els.geminiKeyInput.value = state.geminiKey;

    if(!state.gasUrl || !state.molitKey || !state.geminiKey) {
        els.settingsModal.classList.remove('hidden');
    }

    // Populate Sido
    const sidos = Object.keys(REGION_CODES);
    sidos.forEach(sido => {
        const opt = document.createElement('option');
        opt.value = sido; opt.textContent = sido;
        if(sido === "경기도") opt.selected = true;
        els.sidoSelect.appendChild(opt);
    });

    updateSigungu();

    // Event Listeners
    els.sidoSelect.addEventListener('change', updateSigungu);
    els.settingsBtn.addEventListener('click', () => els.settingsModal.classList.remove('hidden'));
    els.saveSettingsBtn.addEventListener('click', saveSettings);
    els.fetchDataBtn.addEventListener('click', fetchBaseData);
    els.aptInput.addEventListener('input', () => handleAptSelection(null));
    els.analyzeBtn.addEventListener('click', startAnalysis);
    els.clearHistoryBtn.addEventListener('click', clearHistory);

    loadHistoryFromGAS();
}

function updateSigungu() {
    els.sigunguSelect.innerHTML = '';
    const sido = els.sidoSelect.value;
    const sigungus = Object.keys(REGION_CODES[sido]);
    sigungus.forEach((sig, idx) => {
        const opt = document.createElement('option');
        opt.value = sig; opt.textContent = sig;
        if(idx === 0) opt.selected = true;
        els.sigunguSelect.appendChild(opt);
    });
}

function saveSettings() {
    state.gasUrl = els.gasUrlInput.value.trim();
    state.molitKey = els.molitKeyInput.value.trim();
    state.geminiKey = els.geminiKeyInput.value.trim();
    
    localStorage.setItem('gas_url', state.gasUrl);
    localStorage.setItem('molit_key', state.molitKey);
    localStorage.setItem('gemini_key', state.geminiKey);
    
    els.settingsModal.classList.add('hidden');
    loadHistoryFromGAS();
}

// --- GAS API Helper ---
async function callGAS(payload) {
    if (!state.gasUrl) throw new Error("GAS URL이 설정되지 않았습니다.");
    const response = await fetch(state.gasUrl, {
        method: 'POST',
        body: JSON.stringify(payload) // Text/plain to avoid preflight
    });
    const result = await response.json();
    if(result.error) throw new Error(result.error);
    return result;
}

// --- History & DB ---
async function loadHistoryFromGAS() {
    if(!state.gasUrl) return;
    try {
        const res = await callGAS({action: "getHistory"});
        state.searchHistory = res.history || [];
        renderHistory();
    } catch(e) {
        console.error("History load error:", e);
    }
}

function renderHistory() {
    els.historyContainer.innerHTML = '';
    if(state.searchHistory.length === 0) {
        els.historyContainer.innerHTML = '<p class="empty-state">표시할 검색 기록이 없습니다.</p>';
        els.clearHistoryBtn.classList.add('hidden');
        return;
    }
    
    els.clearHistoryBtn.classList.remove('hidden');
    state.searchHistory.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `<strong>${item.sigungu} ${item.apt}</strong> (${item.size}평형)`;
        div.onclick = () => {
            // Apply history (Simplified flow)
            els.sidoSelect.value = item.sido;
            updateSigungu();
            els.sigunguSelect.value = item.sigungu;
            // Fetch dat automatically to load apt list
            fetchBaseData().then(() => {
                els.aptInput.value = item.apt;
                handleAptSelection(item.size);
            });
        };
        els.historyContainer.appendChild(div);
    });
}

async function clearHistory() {
    state.searchHistory = [];
    renderHistory();
    if(state.gasUrl) {
        await callGAS({action: "saveHistory", history: []});
    }
}

async function addHistory(sido, sigungu, apt, size) {
    const record = {sido, sigungu, apt, size};
    state.searchHistory = state.searchHistory.filter(h => !(h.apt === apt && Number(h.size) === Number(size)));
    state.searchHistory.unshift(record);
    if(state.searchHistory.length > 10) state.searchHistory.pop();
    renderHistory();
    callGAS({action: "saveHistory", history: state.searchHistory});
}

// --- Fetch MOLIT Data ---
async function fetchBaseData() {
    if(!state.gasUrl || !state.molitKey) {
        alert("설정에서 GAS URL과 Molit Key를 먼저 입력해주세요.");
        els.settingsModal.classList.remove('hidden');
        return;
    }

    const sido = els.sidoSelect.value;
    const sigungu = els.sigunguSelect.value;
    const lawd_cd = REGION_CODES[sido][sigungu];
    const period = document.querySelector('input[name="period"]:checked').value;

    els.loadingBaseData.classList.remove('hidden');
    els.fetchDataBtn.disabled = true;

    try {
        const res = await callGAS({
            action: 'getMolitData',
            lawd_cd: lawd_cd,
            months_back: parseInt(period),
            service_key: state.molitKey
        });

        state.baseData = res.data || [];
        
        // Populate APT Select
        const aptNames = [...new Set(state.baseData.map(d => d.aptNm))].sort();
        els.aptList.innerHTML = '';
        els.aptInput.value = '';
        aptNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            els.aptList.appendChild(opt);
        });

        els.emptyAptState.classList.add('hidden');
        els.aptSelectionArea.classList.remove('hidden');
    } catch (e) {
        alert("데이터를 가져오는 중 오류가 발생했습니다: " + e.message);
    } finally {
        els.loadingBaseData.classList.add('hidden');
        els.fetchDataBtn.disabled = false;
    }
}

async function handleAptSelection(prefillSize = null) {
    const selectedApt = els.aptInput.value.trim();
    if(!selectedApt) {
        els.sizesGroup.classList.add('hidden');
        els.analyzeBtn.classList.add('hidden');
        els.cachedResultAlert.classList.add('hidden');
        return;
    }

    const aptDf = state.baseData.filter(d => d.aptNm === selectedApt);
    if(aptDf.length === 0) {
        // Not a full match yet, hide sizes
        els.sizesGroup.classList.add('hidden');
        els.analyzeBtn.classList.add('hidden');
        els.cachedResultAlert.classList.add('hidden');
        return;
    }
    
    // Calc size in py (평형) -> excluUseAr / 2.58
    aptDf.forEach(d => {
        d.size_py = Math.round(parseFloat(d.excluUseAr) / 2.58);
    });

    const sizes = [...new Set(aptDf.map(d => d.size_py))].sort((a,b)=>a-b);
    
    els.sizeRadios.innerHTML = '';
    sizes.forEach((s, idx) => {
        const label = document.createElement('label');
        label.className = 'radio-chip';
        if(prefillSize && prefillSize == s) label.classList.add('selected');
        else if(!prefillSize && idx === 0) label.classList.add('selected');

        const input = document.createElement('input');
        input.type = 'radio'; input.name = 'sizeSelect'; input.value = s;
        if(label.classList.contains('selected')) input.checked = true;

        label.appendChild(input);
        label.append(` ${s}평형`);
        
        label.onclick = () => {
            document.querySelectorAll('.radio-chip').forEach(l => l.classList.remove('selected'));
            label.classList.add('selected');
            input.checked = true;
            checkCachedAnalysis();
        };
        
        els.sizeRadios.appendChild(label);
    });

    els.sizesGroup.classList.remove('hidden');
    els.analyzeBtn.classList.remove('hidden');
    checkCachedAnalysis();
}

async function checkCachedAnalysis() {
    const sido = els.sidoSelect.value;
    const sigungu = els.sigunguSelect.value;
    const apt = els.aptInput.value;
    const sizeInput = document.querySelector('input[name="sizeSelect"]:checked');
    if(!sizeInput) return;
    const size = sizeInput.value;

    els.cachedResultAlert.classList.add('hidden');
    els.analyzeBtn.textContent = "🔍 가치 분석 시작";

    try {
        const res = await callGAS({
            action: 'getAnalysis',
            sido, sigungu, apt, size
        });
        
        // Show cached result
        els.analysisResultSection.classList.remove('hidden');
        if(res.report) {
            els.cachedResultAlert.classList.remove('hidden');
            els.analyzeBtn.textContent = "🔄 가치 분석 갱신하기 (최신화)";
            els.analysisContent.innerHTML = marked.parse(res.report);
        } else {
            els.analysisContent.innerHTML = "";
            els.analysisResultSection.classList.add('hidden');
        }
    } catch(e) {
        console.error("Cache check error", e);
    }
}

// --- AI Analysis ---
async function startAnalysis() {
    if(!state.geminiKey) {
        alert("Gemini API 키가 필요합니다. 우측 상단 ⚙️ 설정을 눌러주세요.");
        els.settingsModal.classList.remove('hidden');
        return;
    }

    // UI Reset
    els.analysisResultSection.classList.remove('hidden');
    els.analysisContent.innerHTML = '';
    els.analysisProgress.classList.remove('hidden');
    els.progressText.textContent = "분석 준비 중...";
    els.analyzeBtn.disabled = true;

    try {
        const sido = els.sidoSelect.value;
        const sigungu = els.sigunguSelect.value;
        const apt = els.aptInput.value;
        const sizeInput = document.querySelector('input[name="sizeSelect"]:checked');
        if(!sizeInput) throw new Error("평형(크기)이 선택되지 않았습니다.");
        const size = sizeInput.value;
        
        const periodNode = document.querySelector('input[name="period"]:checked');
        if(!periodNode) throw new Error("조회 기간이 선택되지 않았습니다.");
        const periodStr = periodNode.parentNode.textContent.trim();

        addHistory(sido, sigungu, apt, size);

        // 1. Filter Data
        const aptDf = state.baseData.filter(d => d.aptNm === apt && Math.round(parseFloat(d.excluUseAr) / 2.58) == size);
        let tableStr = "dealYear | dealMonth | dealDay | aptNm | excluUseAr | floor | dealAmount\n";
        tableStr += "---|---|---|---|---|---|---\n";
        aptDf.forEach(d => {
            tableStr += `${d.dealYear} | ${d.dealMonth} | ${d.dealDay} | ${d.aptNm} | ${d.excluUseAr} | ${d.floor} | ${d.dealAmount}\n`;
        });

        // 2. Fetch News and Reviews via GAS
        els.progressText.textContent = "📰 지역 뉴스 및 호갱노노 리뷰 수집 중...";
        const proxyRes = await callGAS({action: 'getNewsAndReviews', region_name: apt, apt_name: apt});
        const area_news = proxyRes.news || "수집된 지역 뉴스가 없습니다.";
        const hogangnono_reviews = proxyRes.reviews || "수집된 리뷰 스니펫이 없습니다.";

        // 3. Call Gemini
        els.progressText.textContent = "🤖 Gemini AI 분석 진행 중 (30~60초 소요될 수 있습니다)...";
        const today = new Date().toLocaleDateString('ko-KR');
        const prompt = `
당신은 아파트 가치 분석 전문가입니다. 아래 데이터를 바탕으로 '${apt} ${size}평형'의 적정가격을 분석해 주세요.

[중요 참고]
- 현재 날짜는 ${today}입니다.
- 아래 데이터의 dealAmount 단위는 만원입니다.
- 분석 기간: ${periodStr}

[실거래 데이터]
${tableStr}

[지역 뉴스 및 규제 정보]
${area_news}

[호갱노노 리뷰 스니펫 (구글검색 기반)]
${hogangnono_reviews}

[요청 사항]
0. **[가장 중요 - 리뷰 키워드 필수 출력]**: 위 제공된 호갱노노 리뷰 스니펫과 당신의 사전 지식을 총동원하여, 이 아파트 단지의 입지, 인프라, 직주근접, 실거주 만족도 등 대중이 가장 많이 언급하는 주요 특징 키워드 5~10개를 추출해 리포트 **최상단**에 반드시 명시하세요. 
   (표현 형식: \`### 💡 주요 모니터링 키워드\` 아래에 \`#역세권\` \`#초품아\` \`#주차불편\` 등과 같이 해시태그 나열)
1. ${periodStr} 실거래가 추이 요약 (평균가, 최고가, 최저가 포함)
2. 지역 개발 호재 분석 (교통, 신규 개발, 학군, 인프라 등)
3. 부동산 규제 현황 분석:
    - 해당 지역이 조정대상지역/투기과열지구인지 여부
    - 토지거래허가구역 지정 여부 및 영향
    - 대출 규제 (LTV, DTI, DSR 적용 현황)
    - 양도세, 취득세 등 세금 관련 규제
4. 시장 동향 (KB시세, 호가 동향, 매물 증감, 입주 물량 등 참고)
5. 추천 매수 가격 (단기 투자용 / 실거주용 구분)
6. 추천 매도 가격 (목표 수익률 고려)
7. 종합 의견 및 투자 시 주의사항
`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${state.geminiKey}`;
        const aiRes = await fetch(geminiUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const aiData = await aiRes.json();
        if(aiData.error) throw new Error(aiData.error.message || JSON.stringify(aiData.error));
        if(!aiData.candidates || aiData.candidates.length === 0) throw new Error("AI 응답을 생성할 수 없습니다. 모델 차단 또는 네트워크 연결을 확인하세요.");

        const reportText = aiData.candidates[0].content.parts[0].text;
        
        els.progressText.textContent = "✅ 분석 완료! 스프레드시트에 데이터를 저장하는 중...";
        
        if (typeof marked !== 'undefined') {
            els.analysisContent.innerHTML = marked.parse(reportText);
        } else {
            els.analysisContent.innerText = reportText;
        }

        // 4. Save to GAS
        await callGAS({
            action: 'saveAnalysis',
            sido, sigungu, apt, size, report: reportText
        });
        
        els.progressText.textContent = "🎉 완료되었습니다!";

    } catch(e) {
        els.progressText.textContent = "❌ 분석 중 오류 발생";
        els.analysisContent.innerHTML = `<div class="alert" style="color:#d32f2f; background:#ffebee;">오류 내용: ${e.message}<br><br><small>개발자 도구(F12) Console 창에서 자세한 원인을 확인할 수 있습니다.</small></div>`;
        console.error("Start Analysis Error:", e);
    } finally {
        setTimeout(() => els.analysisProgress.classList.add('hidden'), 2000);
        els.analyzeBtn.disabled = false;
        els.cachedResultAlert.classList.add('hidden');
        els.analyzeBtn.textContent = "🔄 가치 분석 갱신하기 (리뷰 및 데이터 최신화)";
    }
}

// Start app
document.addEventListener('DOMContentLoaded', init);
