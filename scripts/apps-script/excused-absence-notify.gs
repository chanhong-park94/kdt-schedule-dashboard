/**
 * 공가 신청/증빙자료 제출 시 Slack 알림 발송 + Supabase 저장
 *
 * ■ 설정 방법:
 * 1. Google Forms의 응답 시트 → [확장 프로그램] → [Apps Script] 클릭
 * 2. 이 코드를 복사하여 Code.gs에 붙여넣기
 * 3. 아래 setupTrigger() 함수를 1회 실행 (트리거 등록)
 * 4. 스크립트 속성 설정: [프로젝트 설정] → [스크립트 속성] 에서 아래 키 추가
 *
 * ■ 스크립트 속성 (Script Properties):
 *   SLACK_WEBHOOK_URL     — 공결신청 전용 채널의 Incoming Webhook URL
 *   SUPABASE_URL          — Supabase 프로젝트 URL (예: https://xxx.supabase.co)
 *   SUPABASE_ANON_KEY     — Supabase anon key
 *   FORM_TYPE             — "application" (공가 신청서) 또는 "evidence" (증빙자료)
 *   COURSE_MANAGERS       — JSON 문자열: {"재직자 LLM":"U12345,U67890","AI 활용 서비스":"U11111"}
 *   FOOTER_TEXT           — 푸터 텍스트 (기본: "📍 모두의연구소 HRD 운영팀")
 */

// ═══════════════════════════════════════════════════════════════
// 설정 헬퍼
// ═══════════════════════════════════════════════════════════════

function getProps() {
  return PropertiesService.getScriptProperties();
}

function getProp(key, fallback) {
  return getProps().getProperty(key) || fallback || "";
}

function getCourseManagers() {
  try {
    return JSON.parse(getProp("COURSE_MANAGERS", "{}"));
  } catch (e) {
    Logger.log("COURSE_MANAGERS 파싱 실패: " + e.message);
    return {};
  }
}

// ═══════════════════════════════════════════════════════════════
// 트리거 등록 (최초 1회 실행)
// ═══════════════════════════════════════════════════════════════

function setupTrigger() {
  // 기존 트리거 제거
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onFormSubmit") {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 새 트리거 등록
  ScriptApp.newTrigger("onFormSubmit")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onFormSubmit()
    .create();

  Logger.log("✅ onFormSubmit 트리거가 등록되었습니다.");
}

// ═══════════════════════════════════════════════════════════════
// 메인: 폼 제출 시 실행
// ═══════════════════════════════════════════════════════════════

function onFormSubmit(e) {
  try {
    var formType = getProp("FORM_TYPE", "application");
    var data = parseFormResponse(e, formType);

    if (!data) {
      Logger.log("폼 데이터 파싱 실패");
      return;
    }

    // 1. Supabase에 저장
    saveToSupabase(data);

    // 2. Slack 알림 발송
    sendSlackNotification(data, formType);

    Logger.log("✅ 처리 완료: " + data.trainee_name + " (" + formType + ")");
  } catch (err) {
    Logger.log("❌ onFormSubmit 에러: " + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 폼 응답 파싱
// ═══════════════════════════════════════════════════════════════

function parseFormResponse(e, formType) {
  if (!e || !e.values) return null;
  var v = e.values;

  if (formType === "application") {
    // 공가 신청서: 타임스탬프 | 동의 | 과정명 | 이름 | 생년월일 | 사유 | 신청날짜
    return {
      source: "application",
      submitted_at: v[0] || new Date().toISOString(),
      course_name: (v[2] || "").trim(),
      trainee_name: (v[3] || "").trim(),
      birth_date: (v[4] || "").trim(),
      reason: (v[5] || "").trim(),
      request_date: (v[6] || "").trim(),
      file_link: "",
      status: "pending"
    };
  } else {
    // 증빙자료 제출: 타임스탬프 | 동의 | 과정명 | 이름 | 증빙자료(파일URL)
    return {
      source: "evidence",
      submitted_at: v[0] || new Date().toISOString(),
      course_name: (v[2] || "").trim(),
      trainee_name: (v[3] || "").trim(),
      birth_date: "",
      reason: "",
      request_date: "",
      file_link: (v[4] || "").trim(),
      status: "pending"
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Supabase 저장
// ═══════════════════════════════════════════════════════════════

function saveToSupabase(data) {
  var url = getProp("SUPABASE_URL");
  var key = getProp("SUPABASE_ANON_KEY");

  if (!url || !key) {
    Logger.log("Supabase 설정 누락 — 저장 건너뜀");
    return;
  }

  var endpoint = url + "/rest/v1/excused_absence_requests";

  var payload = {
    source: data.source,
    course_name: data.course_name,
    trainee_name: data.trainee_name,
    birth_date: data.birth_date || null,
    reason: data.reason || null,
    request_date: data.request_date || null,
    file_link: data.file_link || null,
    submitted_at: new Date().toISOString(),
    status: "pending"
  };

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "apikey": key,
      "Authorization": "Bearer " + key,
      "Prefer": "return=minimal"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var res = UrlFetchApp.fetch(endpoint, options);
  var code = res.getResponseCode();

  if (code >= 200 && code < 300) {
    Logger.log("✅ Supabase 저장 성공");
  } else {
    Logger.log("⚠️ Supabase 저장 실패 (" + code + "): " + res.getContentText());
  }
}

// ═══════════════════════════════════════════════════════════════
// Slack 알림 발송
// ═══════════════════════════════════════════════════════════════

function sendSlackNotification(data, formType) {
  var webhookUrl = getProp("SLACK_WEBHOOK_URL");
  if (!webhookUrl) {
    Logger.log("SLACK_WEBHOOK_URL 미설정 — 알림 건너뜀");
    return;
  }

  var footer = getProp("FOOTER_TEXT", "📍 모두의연구소 HRD 운영팀");
  var managerMention = getManagerMention(data.course_name);
  var message = "";

  if (formType === "application") {
    message = buildApplicationMessage(data, managerMention, footer);
  } else {
    message = buildEvidenceMessage(data, managerMention, footer);
  }

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ text: message }),
    muteHttpExceptions: true
  };

  var res = UrlFetchApp.fetch(webhookUrl, options);
  var code = res.getResponseCode();

  if (code === 200) {
    Logger.log("✅ Slack 알림 발송 성공");
  } else {
    Logger.log("⚠️ Slack 알림 발송 실패 (" + code + "): " + res.getContentText());
  }
}

// ═══════════════════════════════════════════════════════════════
// 매니저 매핑 조회
// ═══════════════════════════════════════════════════════════════

function getManagerMention(courseName) {
  var managers = getCourseManagers();

  // 과정명에 포함된 키워드로 매칭 (부분 매칭 지원)
  for (var key in managers) {
    if (courseName.indexOf(key) !== -1 || key.indexOf(courseName) !== -1) {
      var ids = managers[key].split(",").map(function(id) { return id.trim(); });
      return ids.map(function(id) { return "<@" + id + ">"; }).join(" ");
    }
  }

  return "_(담당 매니저 미지정)_";
}

// ═══════════════════════════════════════════════════════════════
// 메시지 빌드
// ═══════════════════════════════════════════════════════════════

function buildApplicationMessage(data, managerMention, footer) {
  var lines = [
    "📋 *[공가 신청 알림]*",
    "━━━━━━━━━━━━━━━━━",
    "👤 *신청자:* " + data.trainee_name,
    "🎓 *과정:* " + data.course_name,
    "📅 *신청일:* " + data.request_date,
    "📌 *사유:* " + data.reason,
    "👤 *담당:* " + managerMention,
    "",
    "⚠️ 증빙자료 제출을 확인해주세요.",
    "━━━━━━━━━━━━━━━━━",
    footer
  ];
  return lines.join("\n");
}

function buildEvidenceMessage(data, managerMention, footer) {
  var fileInfo = data.file_link ? "제출 완료 ✅" : "파일 없음";

  var lines = [
    "📎 *[공가 증빙자료 제출 알림]*",
    "━━━━━━━━━━━━━━━━━",
    "👤 *제출자:* " + data.trainee_name,
    "🎓 *과정:* " + data.course_name,
    "📄 *증빙자료:* " + fileInfo,
    "👤 *담당:* " + managerMention,
    "",
    "✅ 증빙자료가 확인되었습니다. 공결 처리를 진행해주세요.",
    "━━━━━━━━━━━━━━━━━",
    footer
  ];
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// 유틸: 매니저 매핑 설정 (대시보드에서 호출 가능한 Web App 엔드포인트)
// ═══════════════════════════════════════════════════════════════

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "";

  if (action === "getManagers") {
    return ContentService.createTextOutput(
      JSON.stringify({ managers: getCourseManagers() })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "setManagers") {
    var json = e.parameter.data || "{}";
    getProps().setProperty("COURSE_MANAGERS", json);
    return ContentService.createTextOutput(
      JSON.stringify({ success: true })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // 기본: 상태 확인
  return ContentService.createTextOutput(
    JSON.stringify({
      status: "ok",
      formType: getProp("FORM_TYPE", "unknown"),
      hasWebhook: !!getProp("SLACK_WEBHOOK_URL"),
      hasSupabase: !!getProp("SUPABASE_URL"),
      courseCount: Object.keys(getCourseManagers()).length
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════
// 테스트: 수동 실행으로 확인
// ═══════════════════════════════════════════════════════════════

function testSlackMessage() {
  var testData = {
    source: "application",
    trainee_name: "테스트훈련생",
    course_name: "재직자 LLM 6기",
    request_date: "2026-03-24",
    reason: "병원 진료",
    file_link: "",
    birth_date: "1990-01-01",
    status: "pending"
  };

  sendSlackNotification(testData, "application");
  Logger.log("테스트 메시지 발송 완료");
}

function testEvidenceMessage() {
  var testData = {
    source: "evidence",
    trainee_name: "테스트훈련생",
    course_name: "재직자 LLM 6기",
    request_date: "",
    reason: "",
    file_link: "https://drive.google.com/file/d/test",
    birth_date: "",
    status: "pending"
  };

  sendSlackNotification(testData, "evidence");
  Logger.log("증빙자료 테스트 메시지 발송 완료");
}
