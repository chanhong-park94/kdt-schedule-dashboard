/**
 * 학업성취도 데이터 조회 Apps Script Web App
 *
 * 구글시트 "대시보드용 DB"에 배포하여 사용합니다.
 * 배포: 확장 프로그램 → Apps Script → doGet 함수 배포
 *
 * 지원 action:
 *   ?action=sheets   → 전체 시트 목록
 *   ?action=unified  → 노드퀘스트DB (통합) 시트 전체
 *   ?action=node&sheet=7기코어  → 노드(7기코어) 시트
 *   ?action=quest&sheet=7기코어 → 퀘스트(7기코어) 시트
 */

function doGet(e) {
  var action = (e.parameter.action || "sheets").toString();
  var sheetName = (e.parameter.sheet || "").toString();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === "sheets") {
    var names = ss.getSheets().map(function (s) {
      return s.getName();
    });
    return jsonResponse({ sheets: names });
  }

  if (action === "unified") {
    var sheet = ss.getSheetByName("\ub178\ub4dc\ud018\uc2a4\ud2b8DB (\ud1b5\ud569)");
    if (!sheet) return jsonResponse({ error: "\ud1b5\ud569 \uc2dc\ud2b8 \uc5c6\uc74c" });
    var data = sheet.getDataRange().getValues();
    return jsonResponse({ headers: data[0], rows: data.slice(1) });
  }

  if (action === "node" || action === "quest") {
    var prefix = action === "node" ? "\ub178\ub4dc" : "\ud018\uc2a4\ud2b8";
    var fullName = prefix + "(" + sheetName + ")";
    var targetSheet = ss.getSheetByName(fullName);
    if (!targetSheet) return jsonResponse({ error: "\uc2dc\ud2b8 \uc5c6\uc74c: " + fullName });
    var sheetData = targetSheet.getDataRange().getValues();
    return jsonResponse({ sheetName: fullName, headers: sheetData[0], rows: sheetData.slice(1) });
  }

  return jsonResponse({ error: "Unknown action: " + action });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
