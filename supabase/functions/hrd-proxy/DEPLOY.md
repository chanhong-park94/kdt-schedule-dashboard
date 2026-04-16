# hrd-proxy Edge Function 배포 가이드

HRD-Net `authKey`를 클라이언트에서 완전히 숨기는 Edge Function입니다.

## 🎯 배포 전 준비

- Supabase 프로젝트: `ltywspfpyjhrmkgiarti`
- 현재 HRD-Net authKey: `gL1rEteJnyrvfy3KmafcvPfrhT2E7rgz` (⚠️ 노출된 키 — 재발급 권장)

## 방법 A: Supabase Dashboard (GUI, 권장)

### 1. Edge Function 생성
1. https://supabase.com/dashboard/project/ltywspfpyjhrmkgiarti/functions 접속
2. "Create a new function" → 이름: `hrd-proxy`
3. `supabase/functions/hrd-proxy/index.ts`의 내용을 그대로 복사/붙여넣기
4. "Deploy function" 클릭

### 2. Secret 등록
1. 좌측 "Manage secrets" 또는 https://supabase.com/dashboard/project/ltywspfpyjhrmkgiarti/settings/functions 접속
2. "Add new secret" →
   - Name: `HRD_AUTH_KEY`
   - Value: (현재 또는 재발급받은 HRD-Net authKey)
3. Save

### 3. 동작 확인
브라우저 콘솔에서 테스트:
```javascript
fetch("https://ltywspfpyjhrmkgiarti.supabase.co/functions/v1/hrd-proxy", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey": "sb_publishable_ypJHAzSg6qgjpxraugeAqA_AlwcOTXI",
    "Authorization": "Bearer sb_publishable_ypJHAzSg6qgjpxraugeAqA_AlwcOTXI"
  },
  body: JSON.stringify({
    type: "roster",
    trainPrId: "AIG20240000498389",
    degr: "1"
  })
}).then(r => r.json()).then(console.log);
```

성공 시 `{ ok: true, data: { returnJSON: "..." } }` 형태로 응답.

---

## 방법 B: Supabase CLI (자동화)

### 1. CLI 설치 + 로그인
```bash
npm install -g supabase
supabase login
# → 브라우저 열림 → 로그인 → 터미널로 복귀
```

### 2. 프로젝트 연결
```bash
cd "C:\Users\Admin\Desktop\학사일정관리\.claude\worktrees\serene-mcnulty"
supabase link --project-ref ltywspfpyjhrmkgiarti
```

### 3. Secret 등록
```bash
supabase secrets set HRD_AUTH_KEY=<authKey>
```

### 4. 배포
```bash
supabase functions deploy hrd-proxy
```

성공 시:
```
Deploying Function: hrd-proxy
Deployed Function hrd-proxy
```

---

## 📋 배포 후 체크리스트

- [ ] Edge Function 배포됨 (`hrd-proxy` 활성 상태)
- [ ] `HRD_AUTH_KEY` Secret 등록됨
- [ ] GitHub Pages 배포(https://chanhong-park94.github.io/kdt-schedule-dashboard/) 접속
- [ ] 출결현황 탭에서 "📊 출결 조회" 클릭 → 정상 조회되는지 확인
- [ ] 브라우저 DevTools Network 탭에서 `hrd-proxy` 요청 확인 (authKey 없어야 함)
- [ ] HRD-Net authKey 재발급 후 Secret 업데이트

## 🔒 보안 효과 확인

배포 후 브라우저 DevTools → Sources → `kdt-schedule-dashboard/assets/*.js` 검색 → `authKey=` 검색 시:
- ✅ `authKey=` 문자열이 번들에 없어야 함 (이미 제거됨)
- ✅ `gL1rEteJnyrvfy3KmafcvPfrhT2E7rgz` 문자열이 없어야 함

## 🔄 롤백 방법

문제 발생 시 `git revert <commit-sha>` 후 Edge Function 비활성화:
```bash
supabase functions delete hrd-proxy
```
Dashboard에서도 삭제 가능.
