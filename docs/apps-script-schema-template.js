/**
 * Google Apps Script — ADP22 데이터스키마 기반 구글시트 템플릿 생성 + 동기화
 *
 * ※ 이 파일은 "새로 만든 구글시트"의 Apps Script 편집기에 붙여넣을 코드입니다.
 *
 * 사용법:
 * 1. 새 구글시트를 생성합니다.
 * 2. [확장 프로그램] → [Apps Script] 열기
 * 3. 이 코드를 Code.gs에 붙여넣기
 * 4. setupTemplate() 함수를 실행하여 시트 구조 생성
 * 5. SOURCE_SPREADSHEET_ID에 기존 "대시보드용 DB" 시트 ID 입력
 * 6. syncAll() 함수를 실행하여 데이터 동기화
 * 7. (선택) [배포] → 웹 앱으로 배포하여 대시보드에서 직접 조회 가능
 *
 * 트리거 설정 (자동 동기화):
 * - [트리거] → [트리거 추가] → syncAll / 시간 기반 / 매일 1회
 */

// ═══ 설정 ═══════════════════════════════════════════════════
// 기존 "대시보드용 DB" 구글시트 ID (URL에서 /d/XXXX/edit 부분)
var SOURCE_SPREADSHEET_ID = "1jwFQ6M-ZHCBoYkGSoT7u8GhNM2ssBZwjfYXvt_FvGGw";

// ═══ 스키마 정의 (ADP22 데이터스키마 초안 기반) ═════════════
var SCHEMA = {
  "학업성취도(실업자)": {
    headers: [
      "과정명", "기수", "이름", "생년월일", "구분",
      "모듈/프로젝트명", "평가유형",
      "퀘스트점수", "노드학습률(%)", "스터디개설", "커뮤니티활동",
      "프로젝트평가점수/등급", "담당강사/멘토",
      "신호등", "종합점수", "동기화일시", "비고"
    ],
    headerColors: {
      "과정명": "#4285f4", "기수": "#4285f4", "이름": "#4285f4",
      "생년월일": "#4285f4", "구분": "#4285f4",
      "퀘스트점수": "#34a853", "노드학습률(%)": "#34a853",
      "신호등": "#ea4335", "종합점수": "#ea4335"
    }
  },

  "학업성취도(재직자)": {
    headers: [
      "과정명", "기수", "이름", "생년월일", "구분",
      "모듈/프로젝트명", "평가유형",
      "유닛리포트등급", "유닛리포트점수", "결과요약",
      "프로젝트평가점수/등급", "담당강사/멘토", "비고"
    ],
    headerColors: {
      "유닛리포트등급": "#34a853", "유닛리포트점수": "#34a853"
    }
  },

  "출결": {
    headers: [
      "과정명", "기수", "이름", "생년월일", "성별",
      "훈련일정", "총훈련일수", "총훈련시간", "훈련상태",
      "출석률(일)", "출석일수", "결석일수",
      "지각(회)", "조퇴(회)", "외출(회)", "공결승인일수", "비고"
    ],
    headerColors: {
      "출석률(일)": "#34a853", "결석일수": "#ea4335"
    }
  },

  "만족도": {
    headers: [
      "과정명", "기수", "이름", "생년월일", "구분",
      "모듈/프로젝트명",
      "NPS점수(-100~100)", "강사만족도(5점)",
      "고용24중간만족도(5점)", "고용24최종만족도(5점)", "비고"
    ],
    headerColors: {
      "NPS점수(-100~100)": "#fbbc04"
    }
  },

  "문의응대": {
    headers: [
      "과정명", "기수", "이름", "문의일자", "문의채널",
      "문의유형", "질문요약", "문의내용",
      "처리담당자", "응답내용", "상담진행날짜",
      "처리상태", "에스컬레이션여부", "에스컬레이션대상", "비고"
    ],
    headerColors: {
      "처리상태": "#34a853"
    }
  },

  "범례 및 안내": {
    headers: ["항목", "설명"],
    headerColors: {}
  }
};

// ═══ 1. 템플릿 생성 ═════════════════════════════════════════
/**
 * 새 구글시트에 ADP22 스키마 시트를 생성합니다.
 * 메뉴에서 실행하거나 최초 1회 수동 실행합니다.
 */
function setupTemplate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  for (var sheetName in SCHEMA) {
    var config = SCHEMA[sheetName];
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    } else {
      sheet.clear();
    }

    // 헤더 설정
    var headers = config.headers;
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#f3f4f6");
    headerRange.setHorizontalAlignment("center");

    // 개별 헤더 색상
    for (var i = 0; i < headers.length; i++) {
      var color = config.headerColors[headers[i]];
      if (color) {
        sheet.getRange(1, i + 1).setFontColor(color);
      }
    }

    // 열 너비 자동조정
    for (var j = 1; j <= headers.length; j++) {
      sheet.autoResizeColumn(j);
    }

    // 헤더 행 고정
    sheet.setFrozenRows(1);
  }

  // 기본 Sheet1 삭제
  var defaultSheet = ss.getSheetByName("Sheet1") || ss.getSheetByName("시트1");
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  // 범례 시트 내용 채우기
  fillGuideSheet(ss);

  SpreadsheetApp.getUi().alert(
    "템플릿 생성 완료!\n\n" +
    Object.keys(SCHEMA).length + "개 시트가 생성되었습니다.\n" +
    "SOURCE_SPREADSHEET_ID를 설정한 후 syncAll()을 실행하세요."
  );
}

function fillGuideSheet(ss) {
  var sheet = ss.getSheetByName("범례 및 안내");
  if (!sheet) return;

  var guide = [
    ["항목", "설명"],
    ["", ""],
    ["📌 ADP22 데이터스키마 기반 통합 대시보드 DB", ""],
    ["", ""],
    ["신호등 기준", ""],
    ["🟢 (Green)", "종합 스코어 70% 이상 — 정상"],
    ["🟡 (Yellow)", "종합 스코어 40~70% — 주의"],
    ["🔴 (Red)", "종합 스코어 40% 미만 — 위험"],
    ["", ""],
    ["종합 스코어 산출", "노드제출률 × 0.4 + 퀘스트패스률 × 0.6"],
    ["", ""],
    ["구분", ""],
    ["실업자", "코어, 리서치, 데싸, 프데분, 엔지니어 과정"],
    ["재직자", "재직자기획/개발, 재직자LLM, 재직자데이터 과정"],
    ["", ""],
    ["동기화", "syncAll() 실행 시 대시보드용 DB에서 자동 변환"],
    ["원본 데이터", "대시보드용 DB 구글시트 (노드퀘스트DB 통합 시트)"],
    ["", ""],
    ["시트별 설명", ""],
    ["학업성취도(실업자)", "퀘스트/노드 기반 학업 평가 (코어~엔지니어 과정)"],
    ["학업성취도(재직자)", "유닛리포트 기반 학업 평가 (재직자 과정)"],
    ["출결", "HRD-Net 출결 데이터 (별도 API 연동)"],
    ["만족도", "NPS + 강사/고용24 만족도 (수기 취합 필요)"],
    ["문의응대", "학사운영 문의 처리 이력 (에어테이블에서 별도 담당자 취합중)"]
  ];

  sheet.getRange(1, 1, guide.length, 2).setValues(guide);
  sheet.getRange(1, 1, 1, 2).setFontWeight("bold");
  sheet.getRange(3, 1).setFontWeight("bold").setFontSize(12);
  sheet.autoResizeColumn(1);
  sheet.autoResizeColumn(2);
}

// ═══ 2. 데이터 동기화 ═══════════════════════════════════════
/**
 * 기존 "대시보드용 DB"에서 데이터를 읽어 스키마 시트에 채웁니다.
 */
function syncAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source;

  try {
    source = SpreadsheetApp.openById(SOURCE_SPREADSHEET_ID);
  } catch (e) {
    SpreadsheetApp.getUi().alert(
      "원본 시트 열기 실패!\n\n" +
      "SOURCE_SPREADSHEET_ID를 확인하세요.\n" +
      "에러: " + e.message
    );
    return;
  }

  var timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

  // 학업성취도(실업자) 동기화
  syncAchievementUnemployed(ss, source, timestamp);

  // 학업성취도(재직자) — 재직자 과정 데이터 동기화
  syncAchievementEmployed(ss, source, timestamp);

  SpreadsheetApp.getUi().alert(
    "동기화 완료!\n\n" +
    "동기화 시각: " + timestamp + "\n\n" +
    "※ 출결/만족도/문의응대는 별도 데이터 소스에서 입력합니다."
  );
}

// ─── 실업자 학업성취도 동기화 ────────────────────────────────
function syncAchievementUnemployed(ss, source, timestamp) {
  var unified = source.getSheetByName("노드퀘스트DB (통합)");
  if (!unified) {
    Logger.log("통합 시트를 찾을 수 없습니다.");
    return;
  }

  var data = unified.getDataRange().getValues();
  var headers = data[0];
  var rows = data.slice(1);

  // 컬럼 인덱스 매핑
  var col = {};
  for (var i = 0; i < headers.length; i++) {
    col[String(headers[i]).trim()] = i;
  }

  // 재직자 과정 목록
  var employedCourses = ["재직자기획/개발", "재직자LLM", "재직자데이터"];

  // 훈련생별 그룹핑 (실업자만)
  var traineeMap = {};
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var course = String(row[col["과정"]] || "").trim();

    // 재직자 과정 제외
    var isEmployed = false;
    for (var e = 0; e < employedCourses.length; e++) {
      if (course.indexOf(employedCourses[e]) >= 0) { isEmployed = true; break; }
    }
    if (isEmployed) continue;

    var name = String(row[col["이름"]] || "").trim();
    var cohort = String(row[col["기수"]] || "").trim();
    var key = name + "|" + course + "|" + cohort;

    if (!traineeMap[key]) {
      traineeMap[key] = {
        name: name,
        course: course,
        cohort: cohort,
        category: String(row[col["구분"]] || "").trim(),
        guild: String(row[col["길드"]] || "").trim(),
        status: String(row[col["훈련상태"]] || "").trim(),
        nodes: [],
        quests: []
      };
    }

    var nodeName = String(row[col["노드명"]] || "").trim();
    var questName = String(row[col["퀘스트명"]] || "").trim();
    var nodeExec = row[col["노드 실행 여부"]] === true || row[col["노드 실행 여부"]] === "true";
    var questStatus = String(row[col["퀘스트 상태"]] || "").trim();

    if (nodeName) {
      traineeMap[key].nodes.push({
        module: String(row[col["모듈명"]] || "").trim(),
        name: nodeName,
        score: Number(row[col["별점"]]) || 0,
        executed: nodeExec
      });
    }
    if (questName) {
      traineeMap[key].quests.push({
        name: questName,
        status: questStatus === "P" ? "P" : questStatus === "F" ? "F" : "",
        executed: row[col["퀘스트 실행 여부"]] === true || row[col["퀘스트 실행 여부"]] === "true"
      });
    }
  }

  // 스키마 시트에 쓰기
  var target = ss.getSheetByName("학업성취도(실업자)");
  if (!target) return;

  // 기존 데이터 클리어 (헤더 유지)
  if (target.getLastRow() > 1) {
    target.getRange(2, 1, target.getLastRow() - 1, target.getLastColumn()).clear();
  }

  var outputRows = [];
  for (var tKey in traineeMap) {
    var t = traineeMap[tKey];
    var submitted = t.nodes.filter(function(n) { return n.executed; });
    var passed = t.quests.filter(function(q) { return q.status === "P"; });
    var avgStar = submitted.length > 0
      ? submitted.reduce(function(s, n) { return s + n.score; }, 0) / submitted.length
      : 0;
    var nodeRate = t.nodes.length > 0 ? (submitted.length / t.nodes.length * 100) : 0;
    var questScore = t.quests.length > 0 ? (passed.length / t.quests.length * 100) : 0;
    var composite = nodeRate * 0.4 + questScore * 0.6;
    var signal = composite >= 70 ? "🟢" : composite >= 40 ? "🟡" : "🔴";

    // 모듈 목록 (유니크)
    var modules = [];
    var moduleSet = {};
    for (var n = 0; n < t.nodes.length; n++) {
      var mod = t.nodes[n].module;
      if (mod && !moduleSet[mod]) { modules.push(mod); moduleSet[mod] = true; }
    }

    outputRows.push([
      t.course,                              // 과정명
      t.cohort,                              // 기수
      t.name,                                // 이름
      "",                                    // 생년월일 (통합시트에 없음)
      "실업자",                               // 구분
      modules.join(", "),                     // 모듈/프로젝트명
      "퀘스트+노드",                          // 평가유형
      Math.round(questScore * 10) / 10,      // 퀘스트점수
      Math.round(nodeRate * 10) / 10,        // 노드학습률(%)
      "",                                    // 스터디개설
      "",                                    // 커뮤니티활동
      "",                                    // 프로젝트평가점수/등급
      "",                                    // 담당강사/멘토
      signal,                                // 신호등
      Math.round(composite * 10) / 10,       // 종합점수
      timestamp,                             // 동기화일시
      t.status                               // 비고 (훈련상태)
    ]);
  }

  if (outputRows.length > 0) {
    target.getRange(2, 1, outputRows.length, outputRows[0].length).setValues(outputRows);
  }

  Logger.log("학업성취도(실업자) 동기화: " + outputRows.length + "건");
}

// ─── 재직자 학업성취도 동기화 ────────────────────────────────
function syncAchievementEmployed(ss, source, timestamp) {
  var unified = source.getSheetByName("노드퀘스트DB (통합)");
  if (!unified) return;

  var data = unified.getDataRange().getValues();
  var headers = data[0];
  var rows = data.slice(1);

  var col = {};
  for (var i = 0; i < headers.length; i++) {
    col[String(headers[i]).trim()] = i;
  }

  var employedCourses = ["재직자기획/개발", "재직자LLM", "재직자데이터"];

  // 재직자만 필터
  var traineeMap = {};
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var course = String(row[col["과정"]] || "").trim();

    var isEmployed = false;
    for (var e = 0; e < employedCourses.length; e++) {
      if (course.indexOf(employedCourses[e]) >= 0) { isEmployed = true; break; }
    }
    if (!isEmployed) continue;

    var name = String(row[col["이름"]] || "").trim();
    var cohort = String(row[col["기수"]] || "").trim();
    var key = name + "|" + course + "|" + cohort;

    if (!traineeMap[key]) {
      traineeMap[key] = {
        name: name,
        course: course,
        cohort: cohort,
        status: String(row[col["훈련상태"]] || "").trim(),
        nodes: [],
        quests: []
      };
    }

    var nodeName = String(row[col["노드명"]] || "").trim();
    if (nodeName) {
      traineeMap[key].nodes.push({
        module: String(row[col["모듈명"]] || "").trim(),
        score: Number(row[col["별점"]]) || 0,
        executed: row[col["노드 실행 여부"]] === true || row[col["노드 실행 여부"]] === "true"
      });
    }
  }

  var target = ss.getSheetByName("학업성취도(재직자)");
  if (!target) return;

  if (target.getLastRow() > 1) {
    target.getRange(2, 1, target.getLastRow() - 1, target.getLastColumn()).clear();
  }

  var outputRows = [];
  for (var tKey in traineeMap) {
    var t = traineeMap[tKey];
    var submitted = t.nodes.filter(function(n) { return n.executed; });
    var avgScore = submitted.length > 0
      ? submitted.reduce(function(s, n) { return s + n.score; }, 0) / submitted.length
      : 0;
    var grade = avgScore >= 4 ? "A" : avgScore >= 3 ? "B" : avgScore >= 2 ? "C" : "D";

    var modules = [];
    var moduleSet = {};
    for (var n = 0; n < t.nodes.length; n++) {
      var mod = t.nodes[n].module;
      if (mod && !moduleSet[mod]) { modules.push(mod); moduleSet[mod] = true; }
    }

    outputRows.push([
      t.course,                              // 과정명
      t.cohort,                              // 기수
      t.name,                                // 이름
      "",                                    // 생년월일
      "재직자",                               // 구분
      modules.join(", "),                     // 모듈/프로젝트명
      "유닛리포트",                            // 평가유형
      grade,                                 // 유닛리포트등급
      Math.round(avgScore * 10) / 10,        // 유닛리포트점수
      submitted.length + "/" + t.nodes.length + " 제출", // 결과요약
      "",                                    // 프로젝트평가점수/등급
      "",                                    // 담당강사/멘토
      t.status                               // 비고
    ]);
  }

  if (outputRows.length > 0) {
    target.getRange(2, 1, outputRows.length, outputRows[0].length).setValues(outputRows);
  }

  Logger.log("학업성취도(재직자) 동기화: " + outputRows.length + "건");
}

// ═══ 3. 웹 앱 API (대시보드 연동용) ═════════════════════════
/**
 * 대시보드에서 직접 조회할 수 있도록 웹 앱 엔드포인트 제공
 *
 * ?action=schema_unemployed  → 학업성취도(실업자) 데이터
 * ?action=schema_employed    → 학업성취도(재직자) 데이터
 * ?action=schema_attendance  → 출결 데이터
 * ?action=schema_satisfaction → 만족도 데이터
 * ?action=schema_inquiry     → 문의응대 데이터
 * ?action=schema_all         → 전체 시트 데이터
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "schema_all";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = {};

  var sheetMap = {
    "schema_unemployed": "학업성취도(실업자)",
    "schema_employed": "학업성취도(재직자)",
    "schema_attendance": "출결",
    "schema_satisfaction": "만족도",
    "schema_inquiry": "문의응대"
  };

  if (action === "schema_all") {
    for (var key in sheetMap) {
      result[key] = getSheetData(ss, sheetMap[key]);
    }
  } else if (sheetMap[action]) {
    result = getSheetData(ss, sheetMap[action]);
  } else {
    result = { error: "Unknown action: " + action };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheetData(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 1) {
    return { headers: [], rows: [] };
  }
  var data = sheet.getDataRange().getValues();
  return {
    sheetName: sheetName,
    headers: data[0],
    rows: data.slice(1),
    rowCount: data.length - 1
  };
}

// ═══ 4. 커스텀 메뉴 ═════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi().createMenu("📊 ADP22 대시보드")
    .addItem("🔧 템플릿 생성 (최초 1회)", "setupTemplate")
    .addSeparator()
    .addItem("🔄 데이터 동기화", "syncAll")
    .addSeparator()
    .addItem("ℹ️ 정보", "showInfo")
    .addToUi();
}

function showInfo() {
  SpreadsheetApp.getUi().alert(
    "ADP22 데이터스키마 대시보드 DB\n\n" +
    "원본: 대시보드용 DB (" + SOURCE_SPREADSHEET_ID + ")\n\n" +
    "시트 구조:\n" +
    "- 학업성취도(실업자): 퀘스트/노드 기반\n" +
    "- 학업성취도(재직자): 유닛리포트 기반\n" +
    "- 출결: HRD-Net API 연동\n" +
    "- 만족도: NPS + 강사/고용24\n" +
    "- 문의응대: 학사운영 문의 이력\n\n" +
    "syncAll() 실행 시 학업성취도 자동 변환됩니다."
  );
}
