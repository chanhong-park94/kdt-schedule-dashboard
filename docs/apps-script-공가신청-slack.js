// ============================================================
// [공가 신청서] Google Form → Slack 알림 + Supabase 저장
//
// 설치 방법:
// 1. 공가 신청서 스프레드시트 > 확장 프로그램 > Apps Script
// 2. Code.gs에 이 코드를 전체 붙여넣기
// 3. Ctrl+S 저장
// 4. 왼쪽 시계 아이콘(트리거) > + 트리거 추가
//    - 실행할 함수: onFormSubmit
//    - 배포: Head
//    - 이벤트 소스: 스프레드시트에서
//    - 이벤트 유형: 양식 제출 시
//    - 저장 (Google 계정 권한 승인)
// ============================================================

var SLACK_WEBHOOK_URL = "YOUR_SLACK_WEBHOOK_URL_HERE";
var SUPABASE_URL = "https://ltywspfpyjhrmkgiarti.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_ypJHAzSg6qgjpxraugeAqA_AlwcOTXI";

function onFormSubmit(e) {
  var values = e.values;
  // 컬럼: 타임스탬프(0), 개인정보동의(1), 과정명(2), 이름(3), 생년월일(4), 사유(5), 날짜(6)
  var timestamp = values[0] || "";
  var courseName = values[2] || "";
  var name = values[3] || "";
  var birthDate = values[4] || "";
  var reason = values[5] || "";
  var requestDate = values[6] || "";

  // 1) Slack 알림
  try {
    var text = ":clipboard: *[공가 신청 알림]*\n"
      + "━━━━━━━━━━━━━━━━━━━\n"
      + ":school: *과정:* " + courseName + "\n"
      + ":bust_in_silhouette: *이름:* " + name + "\n"
      + ":birthday: *생년월일:* " + birthDate + "\n"
      + ":memo: *신청 사유:* " + reason + "\n"
      + ":calendar: *신청 날짜:* " + requestDate + "\n"
      + "\n"
      + ":clock3: 접수 시각: " + timestamp + "\n"
      + "\n"
      + "_확인 후 :white_check_mark: 이모지를 남겨주세요._";

    UrlFetchApp.fetch(SLACK_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ text: text })
    });
  } catch (err) {
    Logger.log("Slack 알림 실패: " + err.message);
  }

  // 2) Supabase DB 저장
  try {
    UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/excused_absence_requests", {
      method: "post",
      contentType: "application/json",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + SUPABASE_ANON_KEY,
        "Prefer": "return=minimal"
      },
      payload: JSON.stringify({
        source: "application",
        course_name: courseName,
        trainee_name: name,
        birth_date: birthDate,
        reason: reason,
        request_date: requestDate,
        submitted_at: new Date().toISOString()
      })
    });
  } catch (err) {
    Logger.log("Supabase 저장 실패: " + err.message);
  }
}
