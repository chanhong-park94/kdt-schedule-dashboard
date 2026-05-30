/**
 * Discord 강의질의응답 채널 메시지 프록시 (Google Apps Script 웹앱)
 * ─────────────────────────────────────────────────────────────
 * KDT 대시보드(문의응대 → 디스코드 sub-tab)가 호출하는 읽기 전용 프록시.
 * 봇 토큰을 클라이언트(정적 사이트)에 두지 않고 GAS Script Properties에 보관하며,
 * 디스코드 REST API를 서버사이드(UrlFetchApp)로 호출해 CORS 제약도 우회한다.
 *
 * ════════════════════ 배포 가이드 (운영자 1회) ════════════════════
 * 1) Discord Developer Portal (https://discord.com/developers/applications)
 *    → New Application → 좌측 Bot → Reset Token으로 토큰 복사
 *    → Bot 화면에서 "MESSAGE CONTENT INTENT" 토글 ON (필수)
 * 2) 좌측 OAuth2 → URL Generator
 *    → SCOPES: bot
 *    → BOT PERMISSIONS: View Channels, Read Message History
 *    → 생성된 URL로 봇을 디스코드 서버에 초대
 * 3) 디스코드 설정 → 고급 → 개발자 모드 ON
 *    → 각 강의질의응답 채널 우클릭 → "채널 ID 복사"
 * 4) 이 코드를 GAS 새 프로젝트(script.google.com)에 붙여넣기
 *    → 프로젝트 설정(⚙️) → 스크립트 속성 → 속성 추가:
 *        이름: DISCORD_BOT_TOKEN   값: (1에서 복사한 봇 토큰)
 *    → 배포 → 새 배포 → 유형: 웹 앱
 *        실행: 나      / 액세스 권한: 모든 사용자
 *    → 배포 후 "웹 앱 URL" 복사
 * 5) 대시보드 설정 탭 → API 연동 → 디스코드:
 *        GAS URL = (4의 웹 앱 URL)
 *        채널↔기수 매핑 = 채널 ID + 기수 라벨
 *        운영자 ID = 운영자 본인의 디스코드 사용자 ID
 *
 * ════════════════════ 호출 규격 ════════════════════
 *  GET {webappUrl}?channels=ID1,ID2&limit=100[&after=messageId]
 *  반환: { ok: true, messages: [{channelId,id,authorId,authorName,authorBot,content,timestamp}, ...] }
 *        실패 시 { ok: false, error: "..." }
 */

function doGet(e) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty('DISCORD_BOT_TOKEN');
    if (!token) {
      return jsonOut({ ok: false, error: 'DISCORD_BOT_TOKEN 스크립트 속성이 설정되지 않았습니다.' });
    }

    var params = (e && e.parameter) || {};
    var channels = String(params.channels || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (channels.length === 0) {
      return jsonOut({ ok: false, error: 'channels 파라미터가 비어 있습니다.' });
    }
    var limit = Math.min(Number(params.limit) || 100, 100); // 디스코드 최대 100
    var after = params.after ? String(params.after) : '';

    var messages = [];
    var errors = [];

    channels.forEach(function (channelId) {
      var url = 'https://discord.com/api/v10/channels/' + encodeURIComponent(channelId)
        + '/messages?limit=' + limit
        + (after ? '&after=' + encodeURIComponent(after) : '');
      var res = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { Authorization: 'Bot ' + token },
        muteHttpExceptions: true,
      });
      var code = res.getResponseCode();
      if (code === 200) {
        var arr = JSON.parse(res.getContentText());
        arr.forEach(function (m) {
          messages.push({
            channelId: channelId,
            id: m.id,
            authorId: m.author && m.author.id ? m.author.id : '',
            authorName: m.author ? (m.author.global_name || m.author.username || '') : '',
            authorBot: !!(m.author && m.author.bot),
            content: m.content || '',
            timestamp: m.timestamp || '',
          });
        });
      } else {
        // 429(rate limit) / 403(권한) / 404(채널 없음) 등 — 채널별로 기록하고 계속
        errors.push(channelId + ': HTTP ' + code);
      }
    });

    return jsonOut({
      ok: true,
      messages: messages,
      fetchedAt: new Date().toISOString(),
      channelErrors: errors,
    });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
