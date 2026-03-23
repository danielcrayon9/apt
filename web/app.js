// ============================================================
// 아파트 AI 적정가 분석 시스템 - app.js (개선판)
// 주요 변경사항:
//   [성능] fetchBaseData에 캐시 레이어 추가 (동일 구/기간 재호출 방지)
//   [성능] aptInput 입력 디바운싱 (keyup마다 DOM 재렌더링 방지)
//   [성능] autocomplete 드롭다운 최대 50개 제한 (대량 단지 시 DOM 과부하 방지)
//   [버그] handleAptInput 하단에 handleAptSelection(null) 중복 호출 제거
//   [버그] checkCachedAnalysis를 GAS 미설정 시 안전하게 skip
//   [버그] 히스토리 클릭 복원 시 sigungu 값이 없을 경우 방어 처리
//   [버그] size_py 계산을 filter 전 baseData에서 선처리 → 중복 계산 제거
//   [버그] radio-chip 클릭 이벤트가 input 클릭 이벤트와 이중 발화하던 문제 수정
//   [버그] 분석 시작 시 aptNames 미로드 상태 검증 추가
//   [UX]  fetchBaseData 중 UI 입력 비활성화로 중복 요청 방지
//   [UX]  설정 모달 외부 클릭 시 닫기
//   [UX]  오류 메시지 한국어 표준화
// ============================================================

// ────────────────────────────────────────────────────────────
// 1. 상태 및 DOM 참조
// ────────────────────────────────────────────────────────────
let state = {
    gasUrl: localStorage.getItem('gas_url') || '',
    molitKey: localStorage.getItem('molit_key') || '',
    geminiKey: localStorage.getItem('gemini_key') || '',
    baseData: [],
    aptNames: [],
    searchHistory: [],
    // [성능] 캐시: { key → { data, timestamp } }
    dataCache: {},
    isFetching: false  // [버그] 중복 요청 방지 플래그
};

const els = {
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    gasUrlInput: document.getElementById('gasUrlInput'),
    molitKeyInput: document.getElementById('molitKeyInput'),
    geminiKeyInput: document.getElementById('geminiKeyInput'),

    sidoSelect: document.getElementById('sidoSelect'),
    sigunguSelect: document.getElementById('sigunguSelect'),
    aptInputGroup: document.getElementById('aptInputGroup'),
    loadingBaseData: document.getElementById('loadingBaseData'),

    historyContainer: document.getElementById('historyContainer'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),

    aptSelectionArea: document.getElementById('aptSelectionArea'),
    emptyAptState: document.getElementById('emptyAptState'),
    aptInput: document.getElementById('aptInput'),
    aptDropdown: document.getElementById('aptDropdown'),
    sizesGroup: document.getElementById('sizesGroup'),
    sizeRadios: document.getElementById('sizeRadios'),
    aptAddressInfo: document.getElementById('aptAddressInfo'),
    aptAddressText: document.getElementById('aptAddressText'),
    naverMapLink: document.getElementById('naverMapLink'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    cachedResultAlert: document.getElementById('cachedResultAlert'),

    analysisResultSection: document.getElementById('analysisResultSection'),
    analysisProgress: document.getElementById('analysisProgress'),
    progressText: document.getElementById('progressText'),
    analysisContent: document.getElementById('analysisContent')
};

// ────────────────────────────────────────────────────────────
// 2. 유틸
// ────────────────────────────────────────────────────────────

/** [성능] 디바운스 헬퍼 */
function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/** [성능] 캐시 키 생성 */
function cacheKey(lawd_cd, period) {
    return `${lawd_cd}_${period}`;
}

/** GAS API 호출 */
async function callGAS(payload) {
    if (!state.gasUrl) throw new Error("GAS URL이 설정되지 않았습니다. ⚙️ 설정을 확인해주세요.");
    const response = await fetch(state.gasUrl, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    return result;
}

// ────────────────────────────────────────────────────────────
// 3. 초기화
// ────────────────────────────────────────────────────────────
function init() {
    els.gasUrlInput.value = state.gasUrl;
    els.molitKeyInput.value = state.molitKey;
    els.geminiKeyInput.value = state.geminiKey;

    if (!state.gasUrl || !state.molitKey || !state.geminiKey) {
        els.settingsModal.classList.remove('hidden');
    }

    // 시/도 드롭다운 초기화
    const sidos = Object.keys(REGION_CODES);
    sidos.forEach(sido => {
        const opt = document.createElement('option');
        opt.value = sido;
        opt.textContent = sido;
        if (sido === "경기도") opt.selected = true;
        els.sidoSelect.appendChild(opt);
    });

    updateSigungu(false);

    // 이벤트 바인딩
    els.sidoSelect.addEventListener('change', () => updateSigungu(true));
    els.sigunguSelect.addEventListener('change', fetchBaseData);
    document.querySelectorAll('input[name="period"]').forEach(r =>
        r.addEventListener('change', fetchBaseData)
    );

    els.settingsBtn.addEventListener('click', () => els.settingsModal.classList.remove('hidden'));
    els.saveSettingsBtn.addEventListener('click', saveSettings);
    els.analyzeBtn.addEventListener('click', startAnalysis);
    els.clearHistoryBtn.addEventListener('click', clearHistory);

    // [버그] autocomplete: input 이벤트만 사용, click은 별도 처리
    const debouncedInput = debounce(handleAptInput, 200); // [성능] 디바운싱
    els.aptInput.addEventListener('input', debouncedInput);
    // [버그] click 시에는 debounce 없이 즉시 드롭다운 열기
    els.aptInput.addEventListener('click', () => {
        if (state.aptNames && state.aptNames.length > 0) {
            renderDropdown(els.aptInput.value.trim().toLowerCase());
        }
    });

    // [UX] 외부 클릭 시 드롭다운 + 설정 모달 닫기
    document.addEventListener('click', (e) => {
        if (e.target !== els.aptInput && !els.aptDropdown.contains(e.target)) {
            els.aptDropdown.classList.add('hidden');
        }
        if (e.target === els.settingsModal) {
            els.settingsModal.classList.add('hidden');
        }
    });

    loadHistoryFromGAS();

    if (state.molitKey && state.gasUrl) {
        fetchBaseData();
    }
}

// ────────────────────────────────────────────────────────────
// 4. 지역 선택
// ────────────────────────────────────────────────────────────
function updateSigungu(autoFetch = true) {
    els.sigunguSelect.innerHTML = '';
    const sido = els.sidoSelect.value;
    const sigungus = Object.keys(REGION_CODES[sido]);
    sigungus.forEach((sig, idx) => {
        const opt = document.createElement('option');
        opt.value = sig;
        opt.textContent = sig;
        if (idx === 0) opt.selected = true;
        els.sigunguSelect.appendChild(opt);
    });
    if (autoFetch && state.molitKey && state.gasUrl) {
        fetchBaseData();
    }
}

// ────────────────────────────────────────────────────────────
// 5. 설정 저장
// ────────────────────────────────────────────────────────────
function saveSettings() {
    state.gasUrl = els.gasUrlInput.value.trim();
    state.molitKey = els.molitKeyInput.value.trim();
    state.geminiKey = els.geminiKeyInput.value.trim();

    localStorage.setItem('gas_url', state.gasUrl);
    localStorage.setItem('molit_key', state.molitKey);
    localStorage.setItem('gemini_key', state.geminiKey);

    // [성능] 설정 변경 시 캐시 무효화
    state.dataCache = {};

    els.settingsModal.classList.add('hidden');
    loadHistoryFromGAS();

    if (state.molitKey && state.gasUrl) {
        fetchBaseData();
    }
}

// ────────────────────────────────────────────────────────────
// 6. 히스토리
// ────────────────────────────────────────────────────────────
async function loadHistoryFromGAS() {
    if (!state.gasUrl) return;
    try {
        const res = await callGAS({ action: "getHistory" });
        state.searchHistory = res.history || [];
        renderHistory();
    } catch (e) {
        console.error("히스토리 로드 오류:", e);
    }
}

function renderHistory() {
    els.historyContainer.innerHTML = '';
    if (state.searchHistory.length === 0) {
        els.historyContainer.innerHTML = '<p class="empty-state">표시할 검색 기록이 없습니다.</p>';
        els.clearHistoryBtn.classList.add('hidden');
        return;
    }

    els.clearHistoryBtn.classList.remove('hidden');
    state.searchHistory.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `<strong>${item.sigungu} ${item.apt}</strong> (${item.size}평형)`;
        div.onclick = () => restoreHistory(item);
        els.historyContainer.appendChild(div);
    });
}

/** [버그] 히스토리 복원 - sigungu 미매칭 방어 처리 분리 */
async function restoreHistory(item) {
    // sido 설정
    if (els.sidoSelect.querySelector(`option[value="${item.sido}"]`)) {
        els.sidoSelect.value = item.sido;
    }
    updateSigungu(false);

    // sigungu 설정 - 옵션 존재 여부 확인
    const sigunguOpt = els.sigunguSelect.querySelector(`option[value="${item.sigungu}"]`);
    if (sigunguOpt) {
        els.sigunguSelect.value = item.sigungu;
    } else {
        console.warn(`저장된 시군구(${item.sigungu})를 찾을 수 없습니다.`);
    }

    await fetchBaseData();

    // [버그] baseData 로드 후 아파트명 설정
    if (state.aptNames.includes(item.apt)) {
        els.aptInput.value = item.apt;
        handleAptSelection(item.size);
    } else {
        console.warn(`저장된 아파트(${item.apt})를 현재 데이터에서 찾을 수 없습니다.`);
        alert(`'${item.apt}' 아파트를 현재 선택된 지역/기간 데이터에서 찾을 수 없습니다.`);
    }
}

async function clearHistory() {
    state.searchHistory = [];
    renderHistory();
    if (state.gasUrl) {
        try {
            await callGAS({ action: "saveHistory", history: [] });
        } catch (e) {
            console.error("히스토리 삭제 오류:", e);
        }
    }
}

async function addHistory(sido, sigungu, apt, size) {
    const record = { sido, sigungu, apt, size };
    state.searchHistory = state.searchHistory.filter(
        h => !(h.apt === apt && Number(h.size) === Number(size))
    );
    state.searchHistory.unshift(record);
    if (state.searchHistory.length > 10) state.searchHistory.pop();
    renderHistory();
    // [UX] 비동기로 백그라운드 저장 (UI 블로킹 방지)
    callGAS({ action: "saveHistory", history: state.searchHistory }).catch(e =>
        console.error("히스토리 저장 오류:", e)
    );
}

// ────────────────────────────────────────────────────────────
// 7. 국토부 데이터 fetch (캐시 적용)
// ────────────────────────────────────────────────────────────
async function fetchBaseData() {
    if (!state.gasUrl || !state.molitKey) return;

    // [버그] 중복 요청 방지
    if (state.isFetching) return;

    const sido = els.sidoSelect.value;
    const sigungu = els.sigunguSelect.value;
    const lawd_cd = REGION_CODES[sido]?.[sigungu];
    if (!lawd_cd) return;

    const period = document.querySelector('input[name="period"]:checked').value;
    const key = cacheKey(lawd_cd, period);

    // [성능] 캐시 HIT: 5분 이내 동일 요청은 재호출 안 함
    const CACHE_TTL = 5 * 60 * 1000;
    if (state.dataCache[key] && (Date.now() - state.dataCache[key].timestamp < CACHE_TTL)) {
        applyBaseData(state.dataCache[key].data);
        return;
    }

    state.isFetching = true;
    setFetchingUI(true);

    try {
        const res = await callGAS({
            action: 'getMolitData',
            lawd_cd,
            months_back: parseInt(period),
            service_key: state.molitKey
        });

        const data = res.data || [];

        // [성능] size_py를 여기서 한 번만 계산 (handleAptSelection에서 반복 계산 방지)
        data.forEach(d => {
            d.size_py = Math.round(parseFloat(d.excluUseAr) / 2.58);
        });

        // [성능] 캐시 저장
        state.dataCache[key] = { data, timestamp: Date.now() };
        applyBaseData(data);

    } catch (e) {
        alert("데이터를 가져오는 중 오류가 발생했습니다: " + e.message);
        console.error("fetchBaseData 오류:", e);
    } finally {
        state.isFetching = false;
        setFetchingUI(false);
    }
}

/** [UX] fetch 중 UI 비활성화 */
function setFetchingUI(isFetching) {
    els.loadingBaseData.classList.toggle('hidden', !isFetching);
    els.sidoSelect.disabled = isFetching;
    els.sigunguSelect.disabled = isFetching;
    document.querySelectorAll('input[name="period"]').forEach(r => r.disabled = isFetching);
}

/** 데이터 fetch 후 상태 및 UI 갱신 */
function applyBaseData(data) {
    state.baseData = data;
    state.aptNames = [...new Set(data.map(d => d.aptNm))].sort();

    // 아파트 입력 초기화
    els.aptInput.value = '';
    els.aptDropdown.innerHTML = '';
    els.aptDropdown.classList.add('hidden');
    els.aptAddressInfo.classList.add('hidden');
    els.analyzeBtn.classList.add('hidden');
    els.cachedResultAlert.classList.add('hidden');
    els.sizesGroup.classList.add('hidden');
    els.aptInputGroup.classList.remove('hidden');

    if (state.aptNames.length === 0) {
        els.aptInput.placeholder = "해당 기간에 거래 내역이 없습니다.";
        els.aptInput.disabled = true;
    } else {
        els.aptInput.placeholder = "아파트 이름 검색...";
        els.aptInput.disabled = false;
    }

    els.emptyAptState.classList.add('hidden');
    els.aptSelectionArea.classList.remove('hidden');
}

// ────────────────────────────────────────────────────────────
// 8. 아파트 검색 Autocomplete
// ────────────────────────────────────────────────────────────

/** [버그] handleAptInput에서 handleAptSelection 중복 호출 제거 */
function handleAptInput() {
    const val = els.aptInput.value.trim().toLowerCase();
    renderDropdown(val);
    // 입력 중에는 평형/분석 UI 초기화
    if (!val) {
        els.sizesGroup.classList.add('hidden');
        els.analyzeBtn.classList.add('hidden');
        els.cachedResultAlert.classList.add('hidden');
        els.aptAddressInfo.classList.add('hidden');
    }
}

/** [성능] 드롭다운 렌더링: 최대 50개 제한 */
function renderDropdown(val) {
    els.aptDropdown.innerHTML = '';

    if (!state.aptNames || state.aptNames.length === 0) {
        els.aptDropdown.classList.add('hidden');
        return;
    }

    const matches = val
        ? state.aptNames.filter(n => n.toLowerCase().includes(val))
        : state.aptNames;

    // [성능] DocumentFragment 사용으로 DOM 리플로우 최소화
    const frag = document.createDocumentFragment();

    if (matches.length > 0) {
        const limited = matches.slice(0, 50); // [성능] 최대 50개
        limited.forEach(name => {
            const li = document.createElement('li');
            li.textContent = name;
            li.onclick = () => {
                els.aptInput.value = name;
                els.aptDropdown.classList.add('hidden');
                handleAptSelection(null);
            };
            frag.appendChild(li);
        });
        if (matches.length > 50) {
            const li = document.createElement('li');
            li.textContent = `... 외 ${matches.length - 50}개 (더 입력하여 범위를 좁히세요)`;
            li.style.color = "#999";
            li.style.pointerEvents = "none";
            li.style.fontSize = "0.85em";
            frag.appendChild(li);
        }
        els.aptDropdown.appendChild(frag);
        els.aptDropdown.classList.remove('hidden');
    } else {
        const li = document.createElement('li');
        li.textContent = "일치하는 아파트 이름이 없습니다.";
        li.style.color = "#999";
        li.style.pointerEvents = "none";
        frag.appendChild(li);
        els.aptDropdown.appendChild(frag);
        els.aptDropdown.classList.remove('hidden');
    }
}

// ────────────────────────────────────────────────────────────
// 9. 아파트 선택 후 평형 표시
// ────────────────────────────────────────────────────────────
async function handleAptSelection(prefillSize = null) {
    const selectedApt = els.aptInput.value.trim();
    if (!selectedApt) {
        els.sizesGroup.classList.add('hidden');
        els.analyzeBtn.classList.add('hidden');
        els.cachedResultAlert.classList.add('hidden');
        els.aptAddressInfo.classList.add('hidden');
        return;
    }

    const aptDf = state.baseData.filter(d => d.aptNm === selectedApt);
    if (aptDf.length === 0) {
        els.sizesGroup.classList.add('hidden');
        els.analyzeBtn.classList.add('hidden');
        els.cachedResultAlert.classList.add('hidden');
        els.aptAddressInfo.classList.add('hidden');
        return;
    }

    // 주소 표시
    const sido = els.sidoSelect.value;
    const sigungu = els.sigunguSelect.value;
    const dong = aptDf[0].umdNm || "";
    const jibun = aptDf[0].jibun || "";
    const fullAddress = `${sido} ${sigungu} ${dong} ${jibun}`.replace(/\s+/g, ' ').trim();

    els.aptAddressText.textContent = fullAddress;
    els.naverMapLink.href = `https://map.naver.com/p/search/${encodeURIComponent(fullAddress)}`;
    els.aptAddressInfo.classList.remove('hidden');

    // [성능] size_py는 fetchBaseData에서 이미 계산됨 → 중복 계산 없음
    const sizes = [...new Set(aptDf.map(d => d.size_py))].sort((a, b) => a - b);

    // 평형 라디오 버튼 렌더링
    els.sizeRadios.innerHTML = '';
    const frag = document.createDocumentFragment();

    sizes.forEach((s, idx) => {
        const label = document.createElement('label');
        label.className = 'radio-chip';
        const isSelected = prefillSize
            ? (String(prefillSize) === String(s))
            : (idx === 0);
        if (isSelected) label.classList.add('selected');

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'sizeSelect';
        input.value = s;
        if (isSelected) input.checked = true;

        label.appendChild(input);
        label.append(` ${s}평형`);

        // [버그] input 클릭 이벤트와 이중 발화 방지: label.onclick 대신 input.onchange 사용
        input.addEventListener('change', () => {
            document.querySelectorAll('.radio-chip').forEach(l => l.classList.remove('selected'));
            label.classList.add('selected');
            checkCachedAnalysis();
        });

        frag.appendChild(label);
    });

    els.sizeRadios.appendChild(frag);
    els.sizesGroup.classList.remove('hidden');
    els.analyzeBtn.classList.remove('hidden');
    checkCachedAnalysis();
}

// ────────────────────────────────────────────────────────────
// 10. 캐시된 분석 결과 확인
// ────────────────────────────────────────────────────────────
async function checkCachedAnalysis() {
    // [버그] GAS 미설정 시 skip
    if (!state.gasUrl) return;

    const sido = els.sidoSelect.value;
    const sigungu = els.sigunguSelect.value;
    const apt = els.aptInput.value;
    const sizeInput = document.querySelector('input[name="sizeSelect"]:checked');
    if (!sizeInput) return;
    const size = sizeInput.value;

    els.cachedResultAlert.classList.add('hidden');
    els.analyzeBtn.textContent = "🔍 가치 분석 시작";

    try {
        const res = await callGAS({ action: 'getAnalysis', sido, sigungu, apt, size });

        if (res.report) {
            els.cachedResultAlert.classList.remove('hidden');
            els.analyzeBtn.textContent = "🔄 가치 분석 갱신하기 (최신화)";
            els.analysisResultSection.classList.remove('hidden');
            els.analysisContent.innerHTML = (typeof marked !== 'undefined')
                ? marked.parse(res.report)
                : res.report;
        } else {
            els.analysisContent.innerHTML = "";
            els.analysisResultSection.classList.add('hidden');
        }
    } catch (e) {
        // [버그] 캐시 확인 실패는 조용히 처리 (분석 자체는 진행 가능)
        console.warn("캐시 확인 오류 (무시됨):", e.message);
    }
}

// ────────────────────────────────────────────────────────────
// 11. AI 분석 실행
// ────────────────────────────────────────────────────────────
async function startAnalysis() {
    if (!state.geminiKey) {
        alert("Gemini API 키가 필요합니다. 우측 상단 ⚙️ 설정을 눌러주세요.");
        els.settingsModal.classList.remove('hidden');
        return;
    }

    // [버그] aptNames 미로드 상태 검증
    if (!state.aptNames || state.aptNames.length === 0) {
        alert("먼저 지역을 선택하여 아파트 데이터를 불러오세요.");
        return;
    }

    const apt = els.aptInput.value.trim();
    if (!apt) {
        alert("분석할 아파트를 선택해주세요.");
        return;
    }

    const sizeInput = document.querySelector('input[name="sizeSelect"]:checked');
    if (!sizeInput) {
        alert("평형을 선택해주세요.");
        return;
    }

    // UI 초기화
    els.analysisResultSection.classList.remove('hidden');
    els.analysisContent.innerHTML = '';
    els.analysisProgress.classList.remove('hidden');
    els.progressText.textContent = "분석 준비 중...";
    els.analyzeBtn.disabled = true;

    try {
        const sido = els.sidoSelect.value;
        const sigungu = els.sigunguSelect.value;
        const size = sizeInput.value;
        const periodNode = document.querySelector('input[name="period"]:checked');
        const periodStr = periodNode.parentNode.textContent.trim();

        addHistory(sido, sigungu, apt, size);

        // 1. 데이터 필터링 (size_py는 이미 계산됨)
        const aptDf = state.baseData.filter(
            d => d.aptNm === apt && d.size_py == size
        );

        if (aptDf.length === 0) {
            throw new Error(`'${apt}' ${size}평형의 실거래 데이터가 없습니다.`);
        }

        let tableStr = "dealYear | dealMonth | dealDay | aptNm | excluUseAr | floor | dealAmount\n";
        tableStr += "---|---|---|---|---|---|---\n";
        aptDf.forEach(d => {
            tableStr += `${d.dealYear} | ${d.dealMonth} | ${d.dealDay} | ${d.aptNm} | ${d.excluUseAr} | ${d.floor} | ${d.dealAmount}\n`;
        });

        // 2. 뉴스/리뷰 수집
        els.progressText.textContent = "📰 지역 뉴스 및 호갱노노 리뷰 수집 중...";
        const proxyRes = await callGAS({
            action: 'getNewsAndReviews',
            region_name: sigungu,
            apt_name: apt
        });
        const area_news = proxyRes.news || "수집된 지역 뉴스가 없습니다.";
        const hogangnono_reviews = proxyRes.reviews || "수집된 리뷰 스니펫이 없습니다.";

        // 3. Gemini 호출
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
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiRes.json();
        if (aiData.error) throw new Error(aiData.error.message || JSON.stringify(aiData.error));
        if (!aiData.candidates || aiData.candidates.length === 0) {
            throw new Error("AI 응답을 생성할 수 없습니다. 모델 차단 또는 네트워크 연결을 확인하세요.");
        }

        const reportText = aiData.candidates[0].content.parts[0].text;

        els.progressText.textContent = "✅ 분석 완료! 스프레드시트에 데이터를 저장하는 중...";
        els.analysisContent.innerHTML = (typeof marked !== 'undefined')
            ? marked.parse(reportText)
            : reportText;

        // 4. GAS에 저장
        await callGAS({ action: 'saveAnalysis', sido, sigungu, apt, size, report: reportText });

        els.progressText.textContent = "🎉 완료되었습니다!";

    } catch (e) {
        els.progressText.textContent = "❌ 분석 중 오류 발생";
        els.analysisContent.innerHTML = `
            <div class="alert" style="color:#d32f2f; background:#ffebee; padding:1rem; border-radius:8px;">
                <strong>오류 내용:</strong> ${e.message}
                <br><br>
                <small>개발자 도구(F12) → Console 탭에서 자세한 원인을 확인할 수 있습니다.</small>
            </div>`;
        console.error("startAnalysis 오류:", e);
    } finally {
        setTimeout(() => els.analysisProgress.classList.add('hidden'), 2000);
        els.analyzeBtn.disabled = false;
        els.cachedResultAlert.classList.add('hidden');
        els.analyzeBtn.textContent = "🔄 가치 분석 갱신하기 (리뷰 및 데이터 최신화)";
    }
}

// ────────────────────────────────────────────────────────────
// 앱 시작
// ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);