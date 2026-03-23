// Google Apps Script Backend (Code.gs)
function doGet(e) { return ContentService.createTextOutput("GAS DB is running."); }

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    var result = {};
    
    if (action === "getMolitData") {
      result.data = getMolitData(params.lawd_cd, params.months_back, params.service_key);
    } else if (action === "getNewsAndReviews") {
      result.news = getAreaNews(params.region_name);
      result.reviews = getHogangnonoReviews(params.apt_name);
    } else if (action === "getHistory") {
      result.history = getHistory();
    } else if (action === "saveHistory") {
      saveHistory(params.history);
      result.status = "ok";
    } else if (action === "getAnalysis") {
      result.report = getAnalysis(params.sido, params.sigungu, params.apt, params.size);
    } else if (action === "saveAnalysis") {
      saveAnalysis(params.sido, params.sigungu, params.apt, params.size, params.report);
      result.status = "ok";
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ----------------- DB Functions -----------------
function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(name);
  if(!s) {
    s = ss.insertSheet(name);
    if(name === "History") s.appendRow(["sido", "sigungu", "apt", "size"]);
    if(name === "Analysis") s.appendRow(["sido", "sigungu", "apt", "size", "report"]);
  }
  return s;
}

function getHistory() {
  var s = getSheet("History");
  var data = s.getDataRange().getValues();
  if(data.length <= 1) return [];
  var result = [];
  for(var i=1; i<data.length; i++) {
    result.push({sido: data[i][0], sigungu: data[i][1], apt: data[i][2], size: data[i][3]});
  }
  return result;
}

function saveHistory(historyArr) {
  var s = getSheet("History");
  s.clear();
  s.appendRow(["sido", "sigungu", "apt", "size"]);
  for(var i=0; i<historyArr.length; i++) {
    var h = historyArr[i];
    s.appendRow([h.sido, h.sigungu, h.apt, h.size]);
  }
}

function getAnalysis(sido, sigungu, apt, size) {
  var s = getSheet("Analysis");
  var data = s.getDataRange().getValues();
  for(var i=1; i<data.length; i++) {
    if(data[i][0] == sido && data[i][1] == sigungu && data[i][2] == apt && data[i][3] == size) {
      return data[i][4];
    }
  }
  return null;
}

function saveAnalysis(sido, sigungu, apt, size, report) {
  var s = getSheet("Analysis");
  var data = s.getDataRange().getValues();
  var rowToUpdate = -1;
  for(var i=1; i<data.length; i++) {
    if(data[i][0] == sido && data[i][1] == sigungu && data[i][2] == apt && data[i][3] == size) {
      rowToUpdate = i + 1; // 1-indexed
      break;
    }
  }
  
  if(rowToUpdate > 0) {
    s.getRange(rowToUpdate, 5).setValue(report);
  } else {
    s.appendRow([sido, sigungu, apt, size, report]);
  }
}

// ----------------- Proxy Functions -----------------
function getMolitData(lawd_cd, months_back, service_key) {
  var allData = [];
  var now = new Date();
  
  for(var i=0; i<months_back; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var yyyy = d.getFullYear();
    var mm = ("0" + (d.getMonth() + 1)).slice(-2);
    var deal_ymd = yyyy + mm;
    
    var url = "http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=" + encodeURIComponent(service_key) + "&LAWD_CD=" + lawd_cd + "&DEAL_YMD=" + deal_ymd + "&numOfRows=100&pageNo=1";
    
    try {
      var res = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
      var xml = res.getContentText();
      var document = XmlService.parse(xml);
      var root = document.getRootElement();
      var body = root.getChild("body");
      if(!body) continue;
      var items = body.getChild("items");
      if(!items) continue;
      var itemList = items.getChildren("item");
      
      for(var j=0; j<itemList.length; j++) {
        var item = itemList[j];
        var obj = {};
        var children = item.getChildren();
        for(var k=0; k<children.length; k++) {
          obj[children[k].getName()] = children[k].getText();
        }
        allData.push(obj);
      }
    } catch(e) {}
  }
  return allData;
}

function _fetchGoogleNews(query, max_items) {
  var url = "https://news.google.com/rss/search?q=" + encodeURIComponent(query) + "&hl=ko&gl=KR&ceid=KR:ko";
  try {
    var xml = UrlFetchApp.fetch(url, {muteHttpExceptions: true}).getContentText();
    var doc = XmlService.parse(xml);
    var items = doc.getRootElement().getChild("channel").getChildren("item");
    var news = [];
    for(var i=0; i<Math.min(items.length, max_items); i++) {
      news.push(items[i].getChild("title").getText());
    }
    return news;
  } catch(e) { return []; }
}

function getAreaNews(region_name) {
  var all_sections = [];
  
  var dev_news = _fetchGoogleNews(region_name + " 부동산 개발 호재", 3);
  if(dev_news.length) { all_sections.push("[지역 개발 및 호재]"); all_sections = all_sections.concat(dev_news.map(function(n){return "- "+n;})); }
  
  var reg_news = _fetchGoogleNews(region_name + " 부동산 규제 조정지역", 2);
  if(reg_news.length) { all_sections.push("\n[부동산 규제 정보]"); all_sections = all_sections.concat(reg_news.map(function(n){return "- "+n;})); }
  
  if(all_sections.length) return all_sections.join("\n");
  return "검색된 지역 뉴스가 없습니다.";
}

function getHogangnonoReviews(apt_name) {
  try {
    var query = 'site:hogangnono.com "' + apt_name + '" 리뷰';
    var url = "https://www.google.com/search?q=" + encodeURIComponent(query);
    var options = {
      "headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      "muteHttpExceptions": true
    };
    var html = UrlFetchApp.fetch(url, options).getContentText();
    
    var reviews = [];
    var searchStr = 'class="VwiC3b';
    var idx = html.indexOf(searchStr);
    while(idx !== -1) {
      var endIdx = html.indexOf('</div>', idx);
      if(endIdx !== -1) {
        var chunk = html.substring(idx, endIdx);
        var textMatch = chunk.match(/>(.*)/);
        if(textMatch) {
          var cleanText = textMatch[1].replace(/<[^>]+>/g, '');
          if(cleanText.length > 10 && reviews.indexOf(cleanText) === -1) reviews.push(cleanText);
        }
      }
      idx = html.indexOf(searchStr, idx + 1);
    }
    
    if(reviews.length > 0) return reviews.slice(0, 5).join("\n");
    
    // Naver Fallback
    var nQuery = "호갱노노 " + apt_name + " 리뷰";
    var nUrl = "https://search.naver.com/search.naver?query=" + encodeURIComponent(nQuery);
    var nHtml = UrlFetchApp.fetch(nUrl, options).getContentText();
    var nSearchStr = 'dsc_txt';
    var nIdx = nHtml.indexOf(nSearchStr);
    var nReviews = [];
    while(nIdx !== -1) {
      var startTagEnd = nHtml.indexOf('>', nIdx);
      var endTag = nHtml.indexOf('</div>', startTagEnd);
      if(endTag === -1) endTag = nHtml.indexOf('</a>', startTagEnd);
      if(startTagEnd !== -1 && endTag !== -1) {
        var chunk = nHtml.substring(startTagEnd + 1, endTag);
        var cleanText = chunk.replace(/<[^>]+>/g, '').trim();
        if(cleanText.length > 10 && nReviews.indexOf(cleanText) === -1) nReviews.push(cleanText);
      }
      nIdx = nHtml.indexOf(nSearchStr, nIdx + 1);
    }
    
    if(nReviews.length > 0) return nReviews.slice(0, 5).join("\n");

    return "수집된 호갱노노 리뷰 스니펫이 없습니다.";
  } catch(e) {
    return "리뷰 수집 중 오류: " + e.toString();
  }
}
