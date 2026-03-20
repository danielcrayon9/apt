import requests
import json
import datetime
import xmltodict
import pandas as pd
from bs4 import BeautifulSoup

# 국토교통부_아파트 매매 실거래가 상세 자료 (서비스 유형: REST)
MOLIT_API_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"

def get_region_code(query):
    """
    아파트명에서 시군구 5자리 코드를 추출하는 함수.
    실무에서는 카카오/네이버 지도로 주소를 먼저 찾고, 그 주소에 해당하는 법정동 코드를 매칭합니다.
    프로토타입을 위해 검색 엔진을 활용해 추출하거나 미리 정의된 맵을 사용합니다.
    """
    # 임시: 자주 검색되는 주요 지역 코드 (실제 운영 시에는 행정표준코드 API 연동 필요)
    region_map = {
        "용인기흥": "41463",
        "용인수지": "41465",
        "성남분당": "41135",
        "강남구": "11680",
        "서초구": "11650",
        "송파구": "11710",
        "영통구": "41117"
    }
    
    # query에서 시군구 이름을 유추하는 로직 (검색 결과 활용 가능)
    # 여기서는 검색을 통해 주소를 먼저 파악하는 것을 권장
    return region_map.get("용인기흥") # 예시용 고정값

def fetch_apt_trades(lawd_cd, deal_ymd, service_key):
    """
    국토부 API로부터 특정 지역/월의 실거래 데이터를 가져옵니다.
    """
    # requests.get 파라미터 사용 시 인증키가 다시 인코딩되어 오류가 발생하는 것을 방지하기 위해 URL 직접 조립
    query_str = f"?serviceKey={service_key}&LAWD_CD={lawd_cd}&DEAL_YMD={deal_ymd}&numOfRows=100&pageNo=1"
    full_url = MOLIT_API_URL + query_str
    
    try:
        response = requests.get(full_url, verify=False, timeout=15)
        response.encoding = 'utf-8'
        data_dict = xmltodict.parse(response.text)
        items = data_dict.get('response', {}).get('body', {}).get('items', {}).get('item', [])
        if not items: return pd.DataFrame()
        if isinstance(items, dict): items = [items]
        return pd.DataFrame(items)
    except Exception as e:
        print(f"API 호출 오류: {e}")
        return pd.DataFrame()

def filter_trades(df, apt_name, size_py):
    """
    가져온 데이터 중 특정 아파트와 평형(평 -> m2)에 맞는 데이터를 필터링합니다.
    """
    if df.empty: return df
    
    # 평형을 m2로 변환 (예: 33평 -> 84.x m2)
    target_m2_min = (size_py - 2) * 2.58 # 대략적인 범위
    target_m2_max = (size_py + 2) * 2.58
    
    # 아파트명 포함 여부 확인
    # API 응답의 단지명 컬럼은 'aptNm'입니다.
    df_filtered = df[df['aptNm'].str.contains(apt_name.split()[0], na=False)]
    
    # 전용면적 필터링
    # API 응답의 전용면적 컬럼은 'excluUseAr'입니다.
    df_filtered['excluUseAr'] = df_filtered['excluUseAr'].astype(float)
    df_filtered = df_filtered[
        (df_filtered['excluUseAr'] >= target_m2_min) & 
        (df_filtered['excluUseAr'] <= target_m2_max)
    ]
    
    return df_filtered

def get_area_news(region_name):
    """
    네이버 뉴스에서 해당 지역의 부동산 호재/규제 정보를 수집합니다.
    """
    url = f"https://search.naver.com/search.naver?where=news&query={region_name}+부동산+호재+규제"
    headers = {"User-Agent": "Mozilla/5.0"}
    res = requests.get(url, headers=headers)
    soup = BeautifulSoup(res.text, "html.parser")
    
    news = []
    for item in soup.select(".news_tit"):
        news.append(item.text.strip())
        if len(news) >= 5: break
        
    return "\n".join([f"- {n}" for n in news]) if news else "검색된 지역 뉴스가 없습니다."
