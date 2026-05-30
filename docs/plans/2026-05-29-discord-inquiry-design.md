# 디스코드 문의 수집·분석 설계서

작성일: 2026-05-29
대상: 문의응대 페이지 — 디스코드 강의질의응답 채널 수집·분류·분석

## 1. 배경

교육과정 소통을 디스코드(기수별 강의질의응답 채널)로 운영 중. 봇 없이 운영자가 수기 응대. 학생 문의를 대시보드로 자동 수집하고, 어떤 문의가 많은지 분류·분석해 답변·가이드 제공 우선순위를 도출하려 함.

## 2. 의사결정 요약

| 항목 | 선택 |
|---|---|
| 아키텍처 | **Apps Script 프록시** (봇 토큰을 GAS Script Properties에 보관) |
| 표시 | 문의응대 페이지 **디스코드 전용 sub-tab** |
| 수집 단위 | **전체 메시지** 수집 후 분류·분석 |
| 분류 방식 | **키워드 규칙 기반** (무료, 클라이언트, 기존 INQUIRY_CATEGORIES 재사용) |
| 쓰기 | 없음 (읽기 전용) |

## 3. 핵심 제약 & 보안

- 대시보드는 GitHub Pages 정적 SPA → 디스코드 봇 토큰을 클라이언트에 둘 수 없음(공개 노출)
- 디스코드 REST API는 브라우저 CORS 차단 → 직접 호출 불가
- 해결: **Google Apps Script 웹앱**이 토큰을 Script Properties에 보관하고 서버사이드(UrlFetchApp)로 디스코드 호출 → 대시보드는 GAS URL만 fetch (achievement·satisfaction과 동일 패턴, 이미 검증된 구조)

## 4. 데이터 흐름

```
디스코드 서버 (기수별 강의질의응답 채널)
  │ 읽기전용 봇 (Message Content Intent, View Channels + Read Message History)
  ▼
GAS 웹앱 discord-proxy.gs
  doGet(?channels=ID1,ID2&limit=100[&after=msgId])
  → UrlFetchApp: GET discord.com/api/v10/channels/{id}/messages
     header Authorization: Bot <SCRIPT_PROPERTY token>
  → JSON 배열 반환
  │ 대시보드 fetch (GAS URL)
  ▼
대시보드 디스코드 sub-tab
  ① localStorage 24h 캐시
  ② 키워드 분류 (INQUIRY_CATEGORIES)
  ③ 질문/응답 휴리스틱
  ④ 빈도 분석 + 미응답 + 운영지침 연결
```

## 5. 파일 구조

```
src/hrd/
├── hrdDiscordTypes.ts    # DiscordMessage·Config·Stats 타입
├── hrdDiscordClassify.ts # 키워드 분류 + 질문/응답 휴리스틱
├── hrdDiscord.ts         # GAS API 클라이언트 + 캐시 + 설정 CRUD
└── hrdDiscordView.ts     # sub-tab UI + 분석 렌더 + lazy init
docs/apps-script/
└── discord-proxy.gs      # 운영자 배포용 GAS 코드 + 배포 가이드 주석
```

## 6. 데이터 모델

```ts
interface DiscordRawMessage {  // GAS가 반환하는 원본
  channelId: string;
  id: string;          // message id
  authorId: string;
  authorName: string;
  authorBot: boolean;
  content: string;
  timestamp: string;   // ISO
}

interface DiscordMessage extends DiscordRawMessage {
  cohortLabel: string;  // 채널↔기수 매핑
  isStaff: boolean;     // 운영자 author ID 목록 대조
  category: string;     // 키워드 분류 (출결/…/기타)
  isQuestion: boolean;  // 학생 + 물음표/의문사
  answered: boolean;    // 이후 같은 채널 운영자 답변 존재
}

interface DiscordConfig {
  gasUrl: string;                              // GAS 웹앱 URL
  channels: { id: string; label: string }[];   // 채널↔기수
  staffAuthorIds: string[];                     // 운영자 디스코드 ID
}
```

localStorage 키:
- `kdt_discord_config_v1` — 설정
- `kdt_discord_cache_v1` — 메시지 캐시 + fetchedAt

## 7. 키워드 분류 (기존 자산 재사용)

`hrdInquiryTypes.ts`의 `INQUIRY_CATEGORIES`를 그대로 사용 (출결/수강신청/중도포기/내배카/수료/취업/훈련장려금/수업문의). 매칭 없으면 "기타". 다중 매칭 시 키워드 최다 카테고리.

### 질문/응답 휴리스틱
- `isStaff`: `config.staffAuthorIds`에 author 포함 → 답변
- `isQuestion`: 비스태프 + (`?`/`？` 포함 OR 의문사 정규식 `/(어떻게|언제|어디|되나요|인가요|있나요|문의|가능한가요|해야|하나요)/`)
- `answered`: 같은 채널에서 그 질문 timestamp 이후 가장 가까운 스태프 메시지가 존재하면 true

## 8. 운영지침 연결

카테고리 → 운영지침 매뉴얼 항목 ID 매핑:
```ts
const CATEGORY_TO_GUIDELINE: Record<string, string> = {
  출결: "attendance",
  수강신청: "trainee",
  중도포기: "attendance",      // 제적 등
  내배카: "regulationNbc",
  수료: "reporting",
  취업: "reporting",
  훈련장려금: "payment",
  수업문의: "execution",
};
```
"관련 가이드 보기" → 운영지침 sub-tab(혹은 Alt+G 모달) 해당 카테고리로 점프.

## 9. UI (디스코드 sub-tab)

- 헤더: 제목 + [🔄 메시지 동기화] + 마지막 동기화/채널수/메시지수
- 필터: 기수 / 카테고리 / 미응답만
- 통계 카드 4: 총 문의 · 미응답 · 평균 응답시간 · 최다 카테고리
- 카테고리 분포 막대 (클릭 → 운영지침 점프)
- FAQ 도출: 카테고리+키워드 클러스터 Top N
- 메시지 테이블: 시각·기수·작성자·내용·카테고리·질문?·응답?

## 10. GAS 프록시 핵심

```js
function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('DISCORD_BOT_TOKEN');
  const channels = (e.parameter.channels || '').split(',').filter(Boolean);
  const limit = Math.min(Number(e.parameter.limit) || 100, 100);
  const out = [];
  channels.forEach(id => {
    const url = `https://discord.com/api/v10/channels/${id}/messages?limit=${limit}`;
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bot ' + token },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 200) {
      JSON.parse(res.getContentText()).forEach(m => out.push({
        channelId: id, id: m.id, authorId: m.author.id,
        authorName: m.author.global_name || m.author.username,
        authorBot: !!m.author.bot, content: m.content, timestamp: m.timestamp,
      }));
    }
  });
  return ContentService.createTextOutput(JSON.stringify({ ok: true, messages: out }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 11. 운영자 1회 준비 (배포 가이드)

1. Discord Developer Portal → New Application → Bot → **MESSAGE CONTENT INTENT 켜기** → 토큰 복사
2. OAuth2 URL Generator → scope `bot`, 권한 `View Channels` + `Read Message History` → 서버 초대
3. 각 강의질의응답 채널 ID 복사 (개발자 모드 → 채널 우클릭 → ID 복사)
4. GAS 새 프로젝트 → `discord-proxy.gs` 붙여넣기 → Script Properties에 `DISCORD_BOT_TOKEN` 추가 → 웹앱 배포(누구나 액세스)
5. 대시보드 설정 탭 → API 연동 → 디스코드: GAS URL + 채널↔기수 + 운영자 ID 등록

## 12. YAGNI

- 대시보드→디스코드 답장 전송
- AI(LLM) 분류
- 실시간 webhook (수동 동기화 + 24h 캐시로 충분)
- 스레드 단위 파싱 (전체 메시지 + 휴리스틱으로 시작)

## 13. 검증 계획

| 항목 | 방법 |
|---|---|
| 빌드 | `npm run build` |
| 분류 | hrdDiscordClassify 단위 테스트 (vitest) |
| UI | 프리뷰 + 모의 메시지 데이터 주입 |
| 동기화 | GAS 미설정 시 안내 / 설정 시 fetch |

## 14. 패치노트 v3.11.0

- 문의응대 디스코드 sub-tab 신설 (강의질의응답 채널 수집·분류·분석)
- Apps Script 프록시 (봇 토큰 서버 보관)
- 키워드 분류 + 미응답 추적 + 운영지침 연결
