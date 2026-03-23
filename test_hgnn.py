import requests
import json

def test_search():
    url = "https://hogangnono.com/api/search?q=은마"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    
    try:
        response = requests.get(url, headers=headers)
        print("Status Code:", response.status_code)
        if response.status_code == 200:
            data = response.json()
            print(json.dumps(data, indent=2, ensure_ascii=False)[:1000])
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    test_search()
