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

def get_area_news(region_name):
    """
    Google News RSS에서 해당 지역의 부동산 관련 뉴스를 수집합니다.
    (네이버는 서버 환경에서 봇 차단으로 인해 사용 불가)
    """
    try:
        # 1차: 지역명 + 부동산 호재
        url = f"https://news.google.com/rss/search?q={region_name}+부동산+호재&hl=ko&gl=KR&ceid=KR:ko"
        res = requests.get(url, timeout=10)
        soup = BeautifulSoup(res.text, "xml")
        items = soup.select("item")
        
        news = []
        for item in items[:3]:
            title = item.find("title")
            if title:
                news.append(title.text.strip())
        
        # 2차: 지역명 + 부동산 규제
        url2 = f"https://news.google.com/rss/search?q={region_name}+부동산+규제&hl=ko&gl=KR&ceid=KR:ko"
        res2 = requests.get(url2, timeout=10)
        soup2 = BeautifulSoup(res2.text, "xml")
        items2 = soup2.select("item")
        
        for item in items2[:2]:
            title = item.find("title")
            if title:
                news.append(title.text.strip())
        
        return "\n".join([f"- {n}" for n in news]) if news else "검색된 지역 뉴스가 없습니다."
    except Exception as e:
        return f"뉴스 검색 중 오류: {e}"
