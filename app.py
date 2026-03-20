import streamlit as st
import pandas as pd
from google import genai
from utils import fetch_apt_trades, get_area_news

st.set_page_config(page_title="아파트 적정가 분석 AI", layout="wide")

st.title("🏙️ 아파트 가치 및 실거래가 분석 시스템")
st.markdown("최근 3개월 국토부 실거래가 데이터 기반 평균가 분석 및 AI(Gemini) 가치 평가 리포트를 제공합니다.")

with st.sidebar:
    st.header("🔑 설정")
    st.info("API 키는 Streamlit Cloud의 Secrets 메뉴(Advanced Settings)에서 안전하게 관리됩니다.")
    
    # st.secrets에서 키 불러오기
    molit_key = st.secrets.get("MOLIT_API_KEY", "")
    gemini_key = st.secrets.get("GEMINI_API_KEY", "")

@st.cache_data(ttl=3600)
def load_base_data(key, lawd_cd, target_months):
    dfs = []
    for ymd in target_months:
        df = fetch_apt_trades(lawd_cd, ymd, key)
        if df is not None and not df.empty:
            dfs.append(df)
    if dfs:
        return pd.concat(dfs, ignore_index=True)
    return pd.DataFrame()

base_df = pd.DataFrame()
if molit_key:
    # 프로토타입용 데이터 (기흥구, 최근 3개월 분량)
    # 실제 운영 시 datetime을 활용해 동적으로 [이번달, 지난달, 지지난달] 형식 생성
    target_months = ["202401", "202312", "202311"]
    base_df = load_base_data(molit_key, "41463", target_months)

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
        
        # 분석 모드 선택 UI (가치 평가 / 실거래가 분석)
        st.markdown("<br>", unsafe_allow_html=True)
        analysis_mode = st.radio(
            "📊 분석 모드 선택", 
            ["단순 실거래가 분석 (최근 3개월 평균)", "AI 가치 평가 (Gemini 심층 분석)"], 
            horizontal=True
        )
        
        analyze_btn = st.button("🔍 분석 시작", type="primary", use_container_width=True)

        if analyze_btn:
            # AI 분석 모드일 때만 Gemini API 키 체크
            if analysis_mode == "AI 가치 평가 (Gemini 심층 분석)" and not gemini_key:
                st.error("⚠️ AI 가치 평가를 위해 Streamlit Secrets에 `GEMINI_API_KEY`를 먼저 설정해주세요.")
            else:
                try:
                    mode_text = "단순 실거래가 분석" if "단순" in analysis_mode else "AI 심층 분석"
                    st.write(f"### 🔎 {selected_apt} ({selected_size}평형) {mode_text} 중...")
                    
                    with st.status("정보 수집 중...", expanded=True) as status:
                        st.write(f"- '{selected_apt}' {selected_size}평형 최근 3개월 실거래 기록 필터링 중...")
                        # 이미 필터링된 데이터에서 선택된 평형만 추출
                        filtered_df = apt_df[apt_df['size_py'] == selected_size].copy()
                        
                        area_news = "AI 분석 외 모드"
                        if "AI" in analysis_mode:
                            st.write("- 지역 호재 및 뉴스 검색 중...")
                            area_news = get_area_news(selected_apt)
                        
                        status.update(label="데이터 처리 완료!", state="complete", expanded=False)

                    if not filtered_df.empty:
                        # dealAmount 전처리 (문자열 내의 콤마 제거 후 숫자로 변환)
                        filtered_df['dealAmount_num'] = filtered_df['dealAmount'].astype(str).str.replace(',', '').str.strip().astype(int)
                        
                        # 3-1. 단순 실거래가 분석 모드 (Gemini API 미사용)
                        if "단순" in analysis_mode:
                            st.write("---")
                            st.subheader("📊 최근 3개월 실거래가 분석 리포트")
                            
                            avg_price = filtered_df['dealAmount_num'].mean()
                            max_price = filtered_df['dealAmount_num'].max()
                            min_price = filtered_df['dealAmount_num'].min()
                            
                            st.info(f"**{selected_apt} ({selected_size}평형)**의 최근 3개월 간 총 **{len(filtered_df)}건**의 실거래 내역이 확인되었습니다.")
                            
                            col1, col2, col3 = st.columns(3)
                            col1.metric("평균 실거래가", f"{avg_price:,.0f} 만원")
                            col2.metric("최고가", f"{max_price:,.0f} 만원")
                            col3.metric("최저가", f"{min_price:,.0f} 만원")
                            
                            st.write("▼ 상세 거래 내역")
                            display_df = filtered_df[['dealYear', 'dealMonth', 'dealDay', 'floor', 'dealAmount']].copy()
                            display_df.columns = ['거래연도', '거래월', '거래일', '층수', '거래금액(만원)']
                            st.dataframe(display_df, use_container_width=True)
                        
                        # 3-2. AI 가치 평가 모드 (Gemini API 사용)
                        else:
                            st.write("---")
                            st.subheader("🤖 AI 가치 평가 리포트")
                            
                            avg_price = filtered_df['dealAmount_num'].mean()
                            
                            # Gemini 프롬프트 구성
                            prompt = f"""
                            당신은 아파트 가치 분석 전문가입니다. 아래 데이터를 바탕으로 '{selected_apt} {selected_size}평형'의 적정가격을 분석해 주세요.

                            [데이터 원본 (단위: 만원)]
                            최근 3개월 실거래 평균가: {avg_price:.0f} 만원
                            - 최근 인근 실거래 내역:
                            {filtered_df[['dealYear', 'dealMonth', 'dealDay', 'floor', 'dealAmount']].to_string()}
                            
                            [지역 개발 호재 및 뉴스]
                            {area_news}

                            [요청 사항]
                            1. 최근 실거래가 추이 요약 (최근 3개월 평균가 대비 분석)
                            2. 지역 호재(교통, 개발 등)와 규제가 가격에 미칠 영향
                            3. 추천 매수 가격 (단기 투자용 / 실거주용 구분)
                            4. 추천 매도 가격 (예상 거래 추이 기반)
                            5. 종합 의견
                            """
                            
                            client = genai.Client(api_key=gemini_key)
                            response = client.models.generate_content(
                                model='gemini-2.0-flash',
                                contents=prompt
                            )
                            
                            st.markdown(response.text)
                    else:
                        st.warning("최근 3개월 내의 해당 평형 실거래 데이터가 없습니다.")

                except Exception as e:
                    st.error(f"분석 중 오류 발생: {e}")
else:
    if molit_key:
        st.warning("데이터를 불러오지 못했습니다. 국토부 API 설정이나 조회 기간을 확인해 주세요.")
    else:
        st.info("좌측에 🔐 API 키가 설정되면 자동으로 지역 데이터를 불러옵니다.")
