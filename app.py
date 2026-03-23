import streamlit as st
import pandas as pd
from google import genai
from utils import fetch_apt_trades, get_area_news, get_hogangnono_reviews
from datetime import datetime
from dateutil.relativedelta import relativedelta
import gspread
from google.oauth2.service_account import Credentials
from regions import REGION_CODES

SHEET_ID = "1G3eUgMu4Of3gFKoqeH43ctevduZgcgDPAQ8sVGIKl8o"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

def get_gsheet():
    """Google Sheets 연결을 반환합니다."""
    try:
        if "gcp_service_account" in st.secrets:
            creds_dict = dict(st.secrets["gcp_service_account"])
        else:
            keys = ["type", "project_id", "private_key_id", "private_key",
                    "client_email", "client_id", "auth_uri", "token_uri",
                    "auth_provider_x509_cert_url", "client_x509_cert_url", "universe_domain"]
            creds_dict = {k: st.secrets[k] for k in keys if k in st.secrets}
        creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
        client = gspread.authorize(creds)
        sheet = client.open_by_key(SHEET_ID).sheet1
        return sheet
    except Exception:
        return None

def get_analysis_sheet():
    sheet1 = get_gsheet()
    if sheet1 is None: return None
    try:
        doc = sheet1.spreadsheet
        try:
            worksheet = doc.worksheet("Analysis")
        except gspread.WorksheetNotFound:
            worksheet = doc.add_worksheet(title="Analysis", rows=100, cols=5)
            worksheet.append_row(["sido", "sigungu", "apt", "size", "report"])
        return worksheet
    except Exception:
        return None

def save_analysis_result(sido, sigungu, apt, size, report_text):
    sheet = get_analysis_sheet()
    if sheet is None: return
    try:
        records = sheet.get_all_records()
        row_to_update = None
        for i, row in enumerate(records):
            if row.get("sido") == sido and row.get("sigungu") == sigungu and row.get("apt") == apt and str(row.get("size")) == str(size):
                row_to_update = i + 2
                break
        
        if row_to_update:
            sheet.update_cell(row_to_update, 5, report_text)
        else:
            sheet.append_row([sido, sigungu, apt, str(size), report_text])
    except Exception as e:
        pass

def load_analysis_result(sido, sigungu, apt, size):
    sheet = get_analysis_sheet()
    if sheet is None: return None
    try:
        records = sheet.get_all_records()
        for row in records:
            if row.get("sido") == sido and row.get("sigungu") == sigungu and row.get("apt") == apt and str(row.get("size")) == str(size):
                return row.get("report")
        return None
    except Exception:
        return None

def load_history():
    sheet = get_gsheet()
    if sheet is None:
        return []
    try:
        records = sheet.get_all_records()
        return records[:10]
    except Exception:
        return []

def save_history(history):
    sheet = get_gsheet()
    if sheet is None:
        return
    try:
        sheet.clear()
        if history:
            sheet.append_row(["sido", "sigungu", "apt", "size"])
            for record in history:
                sheet.append_row([record["sido"], record["sigungu"], record["apt"], record["size"]])
    except Exception:
        pass

if 'search_history' not in st.session_state:
    st.session_state.search_history = load_history()

def add_to_history(sido, sigungu, apt, size):
    record = {"sido": sido, "sigungu": sigungu, "apt": apt, "size": int(size)}
    history = st.session_state.search_history
    if record in history:
        history.remove(record)
    history.insert(0, record)
    history = history[:10]
    st.session_state.search_history = history
    save_history(history)
    
def clear_history():
    st.session_state.search_history = []
    save_history([])

def apply_history(sido, sigungu, apt):
    """검색 기록 클릭 시 지역/아파트 선택 상태를 설정합니다."""
    st.session_state.selected_sido = sido
    st.session_state.selected_sigungu = sigungu
    st.session_state.prefill_apt = apt  # 위젯 렌더링 전에 적용할 아파트명

def get_month_list(months_back):
    """현재부터 N개월 전까지의 YYYYMM 리스트를 생성합니다."""
    now = datetime.now()
    result = []
    for i in range(months_back):
        dt = now - relativedelta(months=i)
        result.append(dt.strftime("%Y%m"))
    return result

st.set_page_config(page_title="아파트 적정가 분석 AI", layout="wide")

st.title("🏙️ 아파트 AI 적정가 분석 시스템")
st.markdown("전체 지역 실거래가 조회 및 AI 기반 분석을 제공합니다.")

with st.sidebar:
    st.header("🔑 설정")
    st.info("API 키는 Streamlit Cloud의 Secrets 메뉴(Advanced Settings)에서 안전하게 관리됩니다.")
    molit_key = st.secrets.get("MOLIT_API_KEY", "")
    gemini_key = st.secrets.get("GEMINI_API_KEY", "")

# --- 1. 지역 선택 ---
st.subheader("📍 검색할 지역 선택")
col_sido, col_sigungu = st.columns(2)

default_sido = st.session_state.get('selected_sido', "경기도")
if default_sido not in REGION_CODES: default_sido = "경기도"

with col_sido:
    sido = st.selectbox("시/도", list(REGION_CODES.keys()), index=list(REGION_CODES.keys()).index(default_sido))

sigungu_list = list(REGION_CODES[sido].keys())
default_sigungu = st.session_state.get('selected_sigungu', sigungu_list[0])
if default_sigungu not in sigungu_list: default_sigungu = sigungu_list[0]

with col_sigungu:
    sigungu = st.selectbox("시/군/구", sigungu_list, index=sigungu_list.index(default_sigungu))

lawd_cd = REGION_CODES[sido][sigungu]

# --- 2. 조회 기간 선택 ---
period_options = {"최근 3개월": 3, "최근 6개월": 6, "최근 1년": 12}
selected_period = st.radio("📅 조회 기간", list(period_options.keys()), horizontal=True)
months_back = period_options[selected_period]

st.markdown("---")

# --- 3. 데이터 불러오기 ---
@st.cache_data(ttl=3600)
def load_base_data(key, code, deal_ymd):
    return fetch_apt_trades(code, deal_ymd, key)

base_df = pd.DataFrame()
if molit_key:
    target_months = get_month_list(months_back)
    
    frames = []
    for ymd in target_months:
        df = load_base_data(molit_key, lawd_cd, ymd)
        if df is not None and not df.empty:
            frames.append(df)
    
    if frames:
        base_df = pd.concat(frames, ignore_index=True).drop_duplicates()

# --- 4. 아파트 선택 및 검색 기록 ---
col_apt, col_hist = st.columns([2, 1])

with col_hist:
    st.subheader("🕒 최근 검색 기록")
    if st.session_state.search_history:
        for idx, item in enumerate(st.session_state.search_history):
            label = f"{item['sigungu']} {item['apt']} ({item['size']}평형)"
            if st.button(label, key=f"hist_{idx}", use_container_width=True):
                apply_history(item['sido'], item['sigungu'], item['apt'])
                st.rerun()
        if st.button("🗑️ 전체 삭제", type="secondary", key="clear_hist"):
            clear_history()
            st.rerun()
    else:
        st.caption("표시할 검색 기록이 없습니다.")

with col_apt:
    st.subheader("🏢 아파트 및 평형 선택")
    if not base_df.empty:
        apt_names = sorted(base_df['aptNm'].dropna().unique())
        
        # 히스토리에서 선택된 아파트가 있으면 위젯 키에 직접 설정
        if 'prefill_apt' in st.session_state:
            target_apt = st.session_state.prefill_apt
            if target_apt in apt_names:
                st.session_state.apt_select = target_apt
            del st.session_state['prefill_apt']

        selected_apt = st.selectbox(
            "검색하려는 아파트를 타이핑하거나 목록에서 고르세요", 
            options=apt_names, 
            index=None,
            placeholder="목록에서 아파트를 선택해 주세요",
            key="apt_select"
        )
        
        if selected_apt:
            apt_df = base_df[base_df['aptNm'] == selected_apt].copy()
            apt_df['excluUseAr'] = apt_df['excluUseAr'].astype(float)
            apt_df['size_py'] = (apt_df['excluUseAr'] / 2.58).round().astype(int)
            
            unique_sizes = sorted(apt_df['size_py'].unique())
            selected_size = st.radio("📐 평형 선택", options=unique_sizes, format_func=lambda x: f"{x}평형", horizontal=True)
            
            st.markdown("<br>", unsafe_allow_html=True)
            
            cached_report = load_analysis_result(sido, sigungu, selected_apt, selected_size)
            if cached_report:
                st.info("✅ 최근에 분석된 결과가 저장되어 있습니다.")
                with st.expander("저장된 분석 결과 보기", expanded=True):
                    st.markdown(cached_report)
                analyze_btn = st.button("🔄 가치 분석 갱신하기 (리뷰 및 데이터 최신화)", type="primary", use_container_width=True)
            else:
                analyze_btn = st.button("🔍 가치 분석 시작", type="primary", use_container_width=True)

            if analyze_btn:
                if not gemini_key:
                    st.error("⚠️ Streamlit Secrets에 `GEMINI_API_KEY`를 먼저 설정해주세요.")
                else:
                    add_to_history(sido, sigungu, selected_apt, selected_size)

                    try:
                        st.write(f"### 🔎 {selected_apt} ({selected_size}평형) 분석 중...")
                        
                        progress = st.progress(0, text="실거래 데이터 필터링 중...")
                        
                        # Step 1: 데이터 필터링
                        filtered_df = apt_df[apt_df['size_py'] == selected_size]
                        progress.progress(20, text="✅ 실거래 데이터 필터링 완료")
                        
                        # Step 2: 뉴스 및 리뷰 수집
                        import time
                        progress.progress(30, text="📰 지역 뉴스 및 호갱노노 리뷰 수집 중...")
                        area_news = get_area_news(selected_apt)
                        hogangnono_reviews = get_hogangnono_reviews(selected_apt)
                        progress.progress(50, text="✅ 수집 완료")

                        if not filtered_df.empty:
                            # Step 3: AI 분석
                            progress.progress(60, text="🤖 Gemini AI 분석 요청 중... (30초~1분 소요)")
                            
                            current_date = datetime.now().strftime('%Y년 %m월 %d일')
                            
                            prompt = f"""
                            당신은 아파트 가치 분석 전문가입니다. 아래 데이터를 바탕으로 '{selected_apt} {selected_size}평형'의 적정가격을 분석해 주세요.

                            [중요 참고]
                            - 현재 날짜는 {current_date}입니다.
                            - 아래 데이터의 dealYear는 실제 거래 연도이며, 오기가 아닙니다.
                            - 데이터 내의 거래금액(dealAmount) 단위는 만원입니다.
                            - 분석 기간: {selected_period}

                            [참고 부동산 정보 소스]
                            분석 시 아래 주요 부동산 플랫폼들의 정보와 데이터 패턴을 참고하여 종합적으로 판단해 주세요:
                            - 네이버부동산(land.naver.com): 매물 시세, 호가 동향
                            - KB부동산(kbland.kr): KB시세, 전세가율, 매매/전세 지수
                            - 호갱노노(hogangnono.com): 실거래가 추이, 단지별 시세 분석
                            - 아실(asil.kr): 매물 증감, 급매 현황
                            - 부동산지인(aptgin.com): 입주 물량, 미분양 현황
                            - 리치고(richgo.ai): AI 시세 예측, 투자 분석
                            - 직방(zigbang.com), 다방(dabangapp.com): 매물 호가, 전월세 시세
                            - 부동산114(r114.com), 부동산뱅크(neonet.co.kr): 시세 데이터, 시장 분석
                            - 부동산써브(serve.co.kr): 분양 정보, 청약 현황
                            - 땅야(ddangya.com), 벨류맵(valueupmap.com), 부동산플래닛(bdsplanet.com): 토지/개발 정보

                            [실거래 데이터]
                            {filtered_df[['dealYear','dealMonth','dealDay','aptNm','excluUseAr','floor','dealAmount']].to_string()}
                            
                            [지역 뉴스 및 규제 정보]
                            {area_news}

                            [호갱노노 리뷰 스니펫 (구글검색 기반)]
                            {hogangnono_reviews}

                            [요청 사항]
                            0. [리뷰 키워드]: 위 호갱노노 리뷰 스니펫을 분석하여 이 아파트에서 가장 많이 언급되는 주요 특징 단어 5~10개를 추출해 리포트 최상단에 `#키워드 #키워드` 형태로 보여주세요. (단, 스니펫이 없으면 대중적인 예상 키워드로 작성)
                            1. {selected_period} 실거래가 추이 요약 (평균가, 최고가, 최저가 포함)
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
                            """
                            
                            client = genai.Client(api_key=gemini_key)
                            response = client.models.generate_content(
                                model='gemini-2.5-flash',
                                contents=prompt
                            )
                            
                            progress.progress(100, text="✅ 분석 완료!")
                            
                            st.write("---")
                            st.subheader("🤖 AI 가치 평가 리포트")
                            st.markdown(response.text)
                            
                            save_analysis_result(sido, sigungu, selected_apt, selected_size, response.text)
                        else:
                            st.warning("선택한 기간 내 해당 평형의 실거래 데이터가 없습니다.")

                    except Exception as e:
                        st.error(f"분석 중 오류 발생: {e}")
    else:
        if molit_key:
            st.warning(f"{selected_period} 동안 선택하신 지역에 실거래 데이터가 없습니다.")
        else:
            st.info("좌측에 🔐 API 키가 설정되면 자동으로 지역 데이터를 불러옵니다.")