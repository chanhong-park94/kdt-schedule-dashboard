/**
 * 재직자 유닛리포트 통합DB Apps Script
 *
 * 구글시트 "재직자 유닛리포트 통합DB"에 배포하여 사용합니다.
 * 배포: 확장 프로그램 → Apps Script → doGet 함수 배포
 *
 * 기능:
 *   1) API에서 데이터 가져와 시트에 저장 (주간 자동 + 수동)
 *   2) 대시보드에서 doGet()으로 데이터 조회
 *
 * 지원 action:
 *   ?action=schema_employed  → 재직자 유닛리포트 전체 데이터
 *   ?action=sheets           → 시트 목록
 *   ?action=sync             → API에서 데이터 동기화 (수동 트리거)
 *
 * ⚠️ API_KEY는 절대 외부 노출 금지
 */

// ── 설정 ────────────────────────────────────────────────────
var API_URL = "https://kdt-admission.modulabs.co.kr/api/ecourse/score";
var API_KEY = "modu-kdt-2026-secure-key";
var DATA_SHEET_NAME = "데이터";

// ── 기수 코드 → 과정명 매핑 ─────────────────────────────────
var COURSE_MAP = { 0: "재직자LLM", 1: "재직자데이터", 2: "재직자기획/개발" };

function parseCohortCode(gen) {
  var num = parseInt(gen, 10);
  if (isNaN(num) || num === 99) return { 과정명: "테스트", 기수: "99" };
  var prefix = Math.floor(num / 10);
  var cohort = num % 10;
  var courseName = COURSE_MAP[prefix] || ("재직자" + prefix);
  return { 과정명: courseName, 기수: cohort + "기" };
}

// ── 대시보드용 시트 헤더 (hrdEmployedApi.ts 호환) ────────────
var HEADERS = [
  "과정명", "기수", "성명", "레벨", "경험치", "작성일",
  "유닛1_강사진단", "유닛2_강사진단", "유닛3_강사진단", "유닛4_강사진단",
  "유닛5_강사진단", "유닛6_강사진단", "유닛7_강사진단", "유닛8_강사진단",
  "유닛9_강사진단", "유닛10_강사진단", "유닛11_강사진단", "유닛12_강사진단",
  "유닛1_운영진단", "유닛2_운영진단", "유닛3_운영진단", "유닛4_운영진단",
  "유닛5_운영진단", "유닛6_운영진단", "유닛7_운영진단", "유닛8_운영진단",
  "유닛9_운영진단", "유닛10_운영진단", "유닛11_운영진단", "유닛12_운영진단"
];

// ── doGet: 대시보드에서 호출 ────────────────────────────────
function doGet(e) {
  var action = (e.parameter.action || "schema_employed").toString();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === "sheets") {
    var names = ss.getSheets().map(function(s) { return s.getName(); });
    return jsonResponse({ sheets: names });
  }

  if (action === "schema_employed") {
    var sheet = ss.getSheetByName(DATA_SHEET_NAME);
    if (!sheet) return jsonResponse({ error: "데이터 시트 없음" });
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ error: "데이터가 비어있습니다. 먼저 동기화를 실행하세요." });
    return jsonResponse({ headers: data[0], rows: data.slice(1) });
  }

  if (action === "sync") {
    var result = syncFromApi();
    return jsonResponse(result);
  }

  return jsonResponse({ error: "Unknown action: " + action });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── API → 시트 동기화 ───────────────────────────────────────
function syncFromApi() {
  try {
    var response = UrlFetchApp.fetch(API_URL, {
      method: "get",
      headers: { "X-Api-Key": API_KEY },
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      return { ok: false, error: "API HTTP " + code + ": " + response.getContentText().substring(0, 200) };
    }

    var data = JSON.parse(response.getContentText());
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, error: "API 응답이 비어있거나 형식이 올바르지 않습니다." };
    }

    // 테스트 데이터 (generation=99) 제외
    var filtered = data.filter(function(r) { return r.generation !== 99; });

    // API 데이터 → 시트 행 변환
    var rows = filtered.map(function(r) {
      var parsed = parseCohortCode(r.generation);
      return [
        parsed.과정명,
        parsed.기수,
        r.title || "",
        r.level || 0,
        r.experience || 0,
        r.updated_at ? Utilities.formatDate(new Date(r.updated_at), "Asia/Seoul", "yyyy-MM-dd") : "",
        r.unit1_instructor, r.unit2_instructor, r.unit3_instructor, r.unit4_instructor,
        r.unit5_instructor, r.unit6_instructor, r.unit7_instructor, r.unit8_instructor,
        r.unit9_instructor, r.unit10_instructor, r.unit11_instructor, r.unit12_instructor,
        r.unit1_operation, r.unit2_operation, r.unit3_operation, r.unit4_operation,
        r.unit5_operation, r.unit6_operation, r.unit7_operation, r.unit8_operation,
        r.unit9_operation, r.unit10_operation, r.unit11_operation, r.unit12_operation
      ];
    });

    // 시트에 쓰기
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(DATA_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(DATA_SHEET_NAME);
    }

    // 기존 데이터 지우고 새로 쓰기
    sheet.clearContents();

    // 헤더 쓰기
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");

    // 데이터 쓰기
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
    }

    // 동기화 로그 시트 업데이트
    updateSyncLog(ss, filtered.length);

    return { ok: true, message: filtered.length + "명 동기화 완료 (" + new Date().toLocaleString("ko-KR") + ")" };
  } catch (e) {
    return { ok: false, error: "동기화 실패: " + e.message };
  }
}

// ── 동기화 로그 ─────────────────────────────────────────────
function updateSyncLog(ss, count) {
  var logSheet = ss.getSheetByName("동기화로그");
  if (!logSheet) {
    logSheet = ss.insertSheet("동기화로그");
    logSheet.getRange(1, 1, 1, 3).setValues([["일시", "건수", "상태"]]);
    logSheet.getRange(1, 1, 1, 3).setFontWeight("bold");
  }
  logSheet.appendRow([
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
    count,
    "성공"
  ]);
}

// ── 커스텀 메뉴 (수동 동기화) ───────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔄 유닛리포트")
    .addItem("API에서 데이터 동기화", "manualSync")
    .addItem("주간 자동 동기화 설정", "setupWeeklyTrigger")
    .addItem("자동 동기화 해제", "removeTriggers")
    .addToUi();
}

function manualSync() {
  var ui = SpreadsheetApp.getUi();
  ui.alert("동기화 시작", "API에서 데이터를 가져오는 중...", ui.ButtonSet.OK);
  var result = syncFromApi();
  if (result.ok) {
    ui.alert("동기화 완료", result.message, ui.ButtonSet.OK);
  } else {
    ui.alert("동기화 실패", result.error, ui.ButtonSet.OK);
  }
}

// ── 주간 트리거 설정 ────────────────────────────────────────
function setupWeeklyTrigger() {
  // 기존 트리거 제거
  removeTriggers();

  // 매주 월요일 오전 9시 실행
  ScriptApp.newTrigger("syncFromApi")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();

  SpreadsheetApp.getUi().alert(
    "주간 자동 동기화 설정 완료",
    "매주 월요일 오전 9시에 자동 동기화됩니다.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function removeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "syncFromApi") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
