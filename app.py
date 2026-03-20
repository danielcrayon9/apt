import streamlit as st
import pandas as pd
from google import genai
from utils import fetch_apt_trades, get_area_news
from datetime import datetime # 날짜 계산을 위해 추가

st.set_page_config(page_title="아파트 적정가 분석 AI", layout="wide")

st.title("🏙️ 아파트 AI 적정가 분석 시스템")
st.markdown("국토부 실거래가 데이터와 지역 정보를 바탕으로 AI가 적정 매수/매도 가격을 분석합니다.")

with st.sidebar:
    st.header("🔑 설정")
    st.info("API 키는 Streamlit Cloud의 Secrets 메뉴(Advanced Settings)에서 안전하게 관리됩니다.")
    
    # st.secrets에서 키 불러오기
    molit_key = st.secrets.get("MOLIT_API_KEY", "")
    gemini_key = st.secrets.get("GEMINI_API_KEY", "")

@st.cache_data(ttl=3600)
def load_base_data(key, lawd_cd, deal_ymd):
    return fetch_apt_trades(lawd_cd, deal_ymd, key)

base_df = pd.DataFrame()

if molit_key:
    # 1. 현재 날짜 기준으로 이번 달과 지난달 YYYYMM 계산
    now = datetime.now()
    current_month = now.strftime("%Y%m")
    
    # 연도가 넘어가는 1월인 경우를 대비한 지난달 계산 로직
    if now.month == 1:
        prev_month = f"{now.year - 1}12"
    else:
        prev_month = f"{now.year}{now.month - 1:02d}"

    # 2. 지역 코드 설정 (기흥구: 41463 / 일산서구: 41285)
    lawd_cd = "41463" 

    # 3. 이번 달과 지난달 데이터를 각각 불러와서 하나로 합치기
    df_current = load_base_data(molit_key, lawd_cd, current_month)
    df_prev = load_base_data(molit_key, lawd_cd, prev_month)
    
    # 두 데이터프레임 병합
    frames = [df for df in [df_current, df_prev] if not df.empty]
    if frames:
        base_df = pd.concat(frames, ignore_index=True)
        # 중복 데이터 제거 (필수)
        base_df = base_df.drop_duplicates()

# 입력 폼
if not base_df.empty:
    apt_names = sorted(base_df['aptNm'].dropna().unique())
    selected_apt = st.selectbox("🏢 아파트명 검색 및 선택", options=["선택하세요"] + list(apt_names))
    
    if selected_apt != "선택하세요":
        # 해당 아파트의 데이터 필터링 및 평형(py) 계산
        apt_df = base_df[base_df['aptNm'] == selected_apt].copy()
        apt_df['excluUseAr'] = apt_df['excluUseAr'].astype(float)
        # 평형 계산 로직: 공급면적 기준 평형을 대략적으로 역산 (전용면적 / 2.58)
        apt_df['size_py'] = (apt_df['excluUseAr'] / 2.58).round().astype(int)
        
        unique_sizes = sorted(apt_df['size_py'].unique())
        selected_size = st.radio("📐 평형 선택", options=unique_sizes, format_func=lambda x: f"{x}평형", horizontal=True)
        
        # 구분선 추가
        st.markdown("<br>", unsafe_allow_html=True)
        analyze_btn = st.button("🔍 가치 분석 시작", type="primary", use_container_width=True)

        if analyze_btn:
            if not gemini_key:
                st.error("⚠️ Streamlit Secrets에 `GEMINI_API_KEY`를 먼저 설정해주세요.")
            else:
                try:
                    st.write(f"### 🔎 {selected_apt} ({selected_size}평형) 분석 중...")
                    
                    with st.status("정보 수집 중...", expanded=True) as status:
                        st.write(f"- '{selected_apt}' {selected_size}평형 실거래 기록 로드 중...")
                        # 이미 필터링된 데이터에서 선택된 평형만 추출
                        filtered_df = apt_df[apt_df['size_py'] == selected_size]
                        
                        st.write("- 지역 호재 및 뉴스 검색 중...")
                        area_news = get_area_news(selected_apt)
                        
                        status.update(label="데이터 수집 완료!", state="complete", expanded=False)

                    # 3. AI 분석 요청
                    if not filtered_df.empty:
                        st.write("---")
                        st.subheader("🤖 AI 가치 평가 리포트")
                        
                        # Gemini 프롬프트 구성
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
                            model='gemini-2.5-flash', # 더 최신 모델로 변경
                            contents=prompt
                        )
                        
                        st.markdown(response.text)
                    else:
                        st.warning("최근 실거래 데이터를 찾을 수 없습니다. (거래량이 없거나 날짜를 확인해 주세요)")

                except Exception as e:
                    st.error(f"분석 중 오류 발생: {e}")
else:
    if molit_key:
        st.warning("데이터를 불러오지 못했습니다. 국토부 API 설정이나 조회 기간을 확인해 주세요.")
    else:
        st.info("좌측에 🔐 API 키가 설정되면 자동으로 지역 데이터를 불러옵니다.")
