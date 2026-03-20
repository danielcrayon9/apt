import requests
import xmltodict
import pandas as pd
from bs4 import BeautifulSoup
import urllib3

# SSL 경고 비활성화 (국토부 API 인증서 문제 우회)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 국토교통부_아파트 매매 실거래가 상세 자료 (서비스 유형: REST)
MOLIT_API_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"

def fetch_apt_trades(lawd_cd, deal_ymd, service_key):
    """
    국토부 API로부터 특정 지역/월의 실거래 데이터를 가져옵니다.
    """
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

def _fetch_google_news(query, max_items=3):
    """Google News RSS에서 뉴스 제목을 가져옵니다."""
    try:
        url = f"https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko"
        res = requests.get(url, timeout=10)
        soup = BeautifulSoup(res.text, "xml")
        items = soup.select("item")
        
        news = []
        for item in items[:max_items]:
            title = item.find("title")
            if title:
                news.append(title.text.strip())
        return news
    except Exception:
        return []

def get_area_news(region_name):
    """
    Google News RSS에서 해당 지역의 부동산 관련 뉴스를 종합 수집합니다.
    - 지역 개발 호재
    - 부동산 규제 정보
    - 대출/토지거래허가 규제
    """
    all_sections = []
    
    # 1. 지역 개발 및 호재
    dev_news = _fetch_google_news(f"{region_name} 부동산 개발 호재", 3)
    if dev_news:
        all_sections.append("[지역 개발 및 호재]")
        all_sections.extend([f"- {n}" for n in dev_news])
    
    # 2. 부동산 규제 정보
    reg_news = _fetch_google_news(f"{region_name} 부동산 규제 조정지역", 3)
    if reg_news:
        all_sections.append("\n[부동산 규제 정보]")
        all_sections.extend([f"- {n}" for n in reg_news])
    
    # 3. 대출 규제 / 토지거래허가 정보
    loan_news = _fetch_google_news(f"{region_name} 토지거래허가 대출규제 DSR LTV", 3)
    if loan_news:
        all_sections.append("\n[대출 및 토지거래 규제]")
        all_sections.extend([f"- {n}" for n in loan_news])
    
    # 4. 아파트 시세 동향
    market_news = _fetch_google_news(f"{region_name} 아파트 시세 전망", 2)
    if market_news:
        all_sections.append("\n[시세 동향 및 전망]")
        all_sections.extend([f"- {n}" for n in market_news])
    
    if all_sections:
        return "\n".join(all_sections)
    else:
        return "검색된 지역 뉴스가 없습니다."
