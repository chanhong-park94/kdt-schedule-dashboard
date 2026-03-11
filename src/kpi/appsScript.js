/**
 * Google Apps Script — KDT 자율성과지표 마스터시트 데이터 API
 *
 * ※ 이 파일은 Google Sheets의 Apps Script 편집기에 붙여넣을 코드입니다.
 *    Vite 빌드에는 포함되지 않습니다.
 *
 * 사용법:
 * 1. Google Sheets에서 [확장 프로그램] → [Apps Script] 열기
 * 2. 이 코드를 Code.gs에 붙여넣기
 * 3. [배포] → [새 배포] → 유형: "웹 앱"
 *    - 실행 주체: "나"
 *    - 액세스 권한: "모든 사용자"
 * 4. 배포 후 생성된 URL을 대시보드 설정에 입력
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "all";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = {};

  if (action === "all" || action === "settings") {
    data.settings = getSheetData(ss, "설정");
  }
  if (action === "all" || action === "achievement") {
    data.achievement = getSheetData(ss, "성취평가");
  }
  if (action === "all" || action === "formative") {
    data.formative = getSheetData(ss, "형성평가");
  }
  if (action === "all" || action === "fieldApplication") {
    data.fieldApplication = getSheetData(ss, "현업적용평가");
  }
  if (action === "all" || action === "summary") {
    data.summary = getSheetData(ss, "과정별_집계");
  }

  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function getSheetData(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  return sheet.getDataRange().getValues();
}
