import streamlit as st
import pandas as pd
from google import genai
from utils import fetch_apt_trades, filter_trades, get_area_news

st.set_page_config(page_title="아파트 적정가 분석 AI", layout="wide")

st.title("🏙️ 아파트 AI 적정가 분석 시스템")
st.markdown("국토부 실거래가 데이터와 지역 정보를 바탕으로 AI가 적정 매수/매도 가격을 분석합니다.")

with st.sidebar:
    st.header("🔑 설정")
    st.info("API 키는 Streamlit Cloud의 Secrets 메뉴(Advanced Settings)에서 안전하게 관리됩니다.")
    
    # st.secrets에서 키 불러오기
    # 로컬 테스트 시에는 .streamlit/secrets.toml 파일을 생성하여 사용합니다.
    molit_key = st.secrets.get("MOLIT_API_KEY", "")
    gemini_key = st.secrets.get("GEMINI_API_KEY", "")


# 입력 폼
with st.container():
    col1, col2 = st.columns([3, 1])
    with col1:
        query = st.text_input("분석할 아파트명과 평형을 입력하세요", placeholder="예: 기흥더샵프라임뷰, 33평")
    with col2:
        analyze_btn = st.button("🔍 가치 분석 시작", type="primary", use_container_width=True)

if analyze_btn:
    if not molit_key or not gemini_key:
        st.error("⚠️ Streamlit Secrets에 `MOLIT_API_KEY`와 `GEMINI_API_KEY`를 먼저 설정해주세요.")

    elif query:
        try:
            # 1. 입력 파싱 (단순 예시 로직)
            parts = query.replace(",", " ").split()
            apt_name = parts[0]
            size_py = int(parts[1].replace("평", "")) if len(parts) > 1 else 33
            
            st.write(f"### 🔎 {apt_name} ({size_py}평형) 분석 중...")
            
            # 2. 데이터 수집 (프로토타입용으로 용인기흥 고정 코드 사용)
            # 실제로는 지번 주소 검색을 통해 코드를 동적으로 가져와야 함
            lawd_cd = "41463" # 용인기흥
            deal_ymd = "202603" # 현재 날짜 기준
            
            with st.status("데이터를 수집하고 있습니다...", expanded=True) as status:
                st.write("- 국토부 실거래가 데이터를 가져오는 중...")
                trades_df = fetch_apt_trades(lawd_cd, deal_ymd, molit_key)
                
                if not trades_df.empty:
                    st.write(f"- '{apt_name}' {size_py}평형 데이터 필터링 중...")
                    filtered_df = filter_trades(trades_df, apt_name, size_py)
                else:
                    filtered_df = pd.DataFrame()
                
                st.write("- 지역 호재 및 뉴스 검색 중...")
                area_news = get_area_news(apt_name)
                
                status.update(label="데이터 수집 완료!", state="complete", expanded=False)

            # 3. AI 분석 요청
            if not filtered_df.empty:
                st.write("---")
                st.subheader("🤖 AI 가치 평가 리포트")
                
                # Gemini 프롬프트 구성
                prompt = f"""
                당신은 아파트 가치 분석 전문가입니다. 아래 데이터를 바탕으로 '{apt_name} {size_py}평형'의 적정가격을 분석해 주세요.

                [데이터 원신]
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
                    model='gemini-2.0-flash',
                    contents=prompt
                )
                
                st.markdown(response.text)
            else:
                st.warning("최근 실거래 데이터를 찾을 수 없습니다. (지역 코드 또는 날짜 확인 필요)")

        except Exception as e:
            st.error(f"분석 중 오류 발생: {e}")
    else:
        st.warning("아파트명을 입력해 주세요.")
