import streamlit as st
import pandas as pd
from google import genai
from utils import fetch_apt_trades, get_area_news
from datetime import datetime
import json
import os
from regions import REGION_CODES

HISTORY_FILE = "search_history.json"

def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_history(history):
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False)

if 'search_history' not in st.session_state:
    st.session_state.search_history = load_history()

def add_to_history(sido, sigungu, apt, size):
    record = {"sido": sido, "sigungu": sigungu, "apt": apt, "size": size}
    history = st.session_state.search_history
    if record in history:
        history.remove(record)
    history.insert(0, record)
    history = history[:10] # 최대 10개 유지
    st.session_state.search_history = history
    save_history(history)
    
def clear_history():
    st.session_state.search_history = []
    save_history([])

def set_search_state(sido, sigungu, apt):
    st.session_state.selected_sido = sido
    st.session_state.selected_sigungu = sigungu
    st.session_state.selected_apt = apt

st.set_page_config(page_title="아파트 적정가 분석 AI", layout="wide")

st.title("🏙️ 아파트 AI 적정가 분석 시스템")
st.markdown("전체 지역 실거래가 조회 및 AI 기반 분석을 제공합니다.")

with st.sidebar:
    st.header("🔑 설정")
    st.info("API 키는 Streamlit Cloud의 Secrets 메뉴(Advanced Settings)에서 안전하게 관리됩니다.")
    molit_key = st.secrets.get("MOLIT_API_KEY", "")
    gemini_key = st.secrets.get("GEMINI_API_KEY", "")

# --- 1. 지역 선택 (서울 / 경기 전체) ---
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

st.markdown("---")

# --- 2. 데이터 불러오기 ---
@st.cache_data(ttl=3600)
def load_base_data(key, code, deal_ymd):
    return fetch_apt_trades(code, deal_ymd, key)

base_df = pd.DataFrame()
if molit_key:
    # 이번 달과 지난달 YYYYMM 계산
    now = datetime.now()
    current_month = now.strftime("%Y%m")
    if now.month == 1:
        prev_month = f"{now.year - 1}12"
    else:
        prev_month = f"{now.year}{now.month - 1:02d}"

    # 두 달치 데이터 병합
    df_current = load_base_data(molit_key, lawd_cd, current_month)
    df_prev = load_base_data(molit_key, lawd_cd, prev_month)
    frames = [df for df in [df_current, df_prev] if df is not None and not df.empty]
    if frames:
        base_df = pd.concat(frames, ignore_index=True).drop_duplicates()

# --- 3. 아파트 선택 및 검색 기록 ---
col_apt, col_hist = st.columns([2, 1])

with col_hist:
    st.subheader("🕒 최근 검색 기록")
    if st.session_state.search_history:
        for idx, item in enumerate(st.session_state.search_history):
            if st.button(f"{item['sigungu']} {item['apt']} ({item['size']}평형)", key=f"hist_{idx}"):
                set_search_state(item['sido'], item['sigungu'], item['apt'])
                st.rerun()
        if st.button("🗑️ 전체 삭제", type="secondary", key="clear_hist"):
            clear_history()
            st.rerun()
    else:
        st.write("표시할 검색 기록이 없습니다.")

with col_apt:
    st.subheader("🏢 아파트 및 평형 선택")
    if not base_df.empty:
        apt_names = sorted(base_df['aptNm'].dropna().unique())
        
        default_apt_index = None
        if 'selected_apt' in st.session_state and st.session_state.selected_apt in apt_names:
            default_apt_index = apt_names.index(st.session_state.selected_apt)
            # 사용 후 상태 지우기 (원할 경우 계속 유지 가능)
            del st.session_state['selected_apt']

        # placeholder와 index=None을 사용하여 클릭 시 이전 검색어 없이 백지 상태에서 고를 수 있는 UX 
        selected_apt = st.selectbox(
            "검색하려는 아파트를 타이핑하거나 목록에서 고르세요", 
            options=apt_names, 
            index=default_apt_index,
            placeholder="목록에서 아파트를 선택해 주세요",
            key="apt_select"
        )
        
        if selected_apt:
            # 해당 아파트의 데이터 필터링 및 평형 구하기
            apt_df = base_df[base_df['aptNm'] == selected_apt].copy()
            apt_df['excluUseAr'] = apt_df['excluUseAr'].astype(float)
            apt_df['size_py'] = (apt_df['excluUseAr'] / 2.58).round().astype(int)
            
            unique_sizes = sorted(apt_df['size_py'].unique())
            selected_size = st.radio("📐 평형 선택", options=unique_sizes, format_func=lambda x: f"{x}평형", horizontal=True)
            
            st.markdown("<br>", unsafe_allow_html=True)
            analyze_btn = st.button("🔍 가치 분석 시작", type="primary", use_container_width=True)

            if analyze_btn:
                if not gemini_key:
                    st.error("⚠️ Streamlit Secrets에 `GEMINI_API_KEY`를 먼저 설정해주세요.")
                else:
                    # 히스토리 저장
                    add_to_history(sido, sigungu, selected_apt, selected_size)

                    try:
                        st.write(f"### 🔎 {selected_apt} ({selected_size}평형) 분석 중...")
                        
                        with st.status("정보 수집 중...", expanded=True) as status:
                            st.write(f"- '{selected_apt}' {selected_size}평형 실거래 기록 로드 중...")
                            filtered_df = apt_df[apt_df['size_py'] == selected_size]
                            
                            st.write("- 지역 호재 및 뉴스 검색 중...")
                            area_news = get_area_news(selected_apt)
                            
                            status.update(label="데이터 수집 완료!", state="complete", expanded=False)

                        if not filtered_df.empty:
                            st.write("---")
                            st.subheader("🤖 AI 가치 평가 리포트")
                            
                            prompt = f"""
                            당신은 아파트 가치 분석 전문가입니다. 아래 데이터를 바탕으로 '{selected_apt} {selected_size}평형'의 적정가격을 분석해 주세요.

                            [데이터 원본]
                            - 최근 인근 실거래 데이터:
                            {filtered_df.to_string()}
                            
                            [지역 개발 호재 및 뉴스]
                            {area_news}

                            [요청 사항]
                            1. 최근 실거래가 추이 요약
                            2. 지역 호재(교통, 개발 등)와 규제가 가격에 미칠 영향 분석
                            3. 추천 매수 가격 (단기 투자용 / 실거주용 구분)
                            4. 추천 매도 가격 (목표 수익률 고려)
                            5. 종합 의견
                            """
                            
                            client = genai.Client(api_key=gemini_key)
                            response = client.models.generate_content(
                                model='gemini-2.5-flash',
                                contents=prompt
                            )
                            
                            st.markdown(response.text)
                        else:
                            st.warning("최근 실거래 데이터를 찾을 수 없습니다. (거래량이 없거나 날짜를 확인해 주세요)")

                    except Exception as e:
                        st.error(f"분석 중 오류 발생: {e}")
    else:
        if molit_key:
            st.warning("최근 2개월 간 선택하신 지역에 실거래 데이터가 없습니다.")
        else:
            st.info("좌측에 🔐 API 키가 설정되면 자동으로 지역 데이터를 불러옵니다.")