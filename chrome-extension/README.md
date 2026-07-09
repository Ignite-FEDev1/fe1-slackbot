# FEHG 티켓 생성기 (Chrome Extension)

웹 페이지에서 텍스트를 선택하고 우클릭하여 FEHG Jira 티켓을 생성하는 확장 프로그램.

## LLM 요약 구조

```
popup (요약 요청)
 ├─ 1순위: 사내망 h-chat (internal-apigw-kr.hmg-corp.io) 직접 호출
 │    └─ API 키는 git에 없음. Lambda GET /api/hchat-credentials 를 통해
 │       Supabase settings 테이블(key='hchat_api_key')에서 받아온다.
 └─ 폴백: Lambda POST /api/summarize (Anthropic, Lambda 환경변수 ANTHROPIC_API_KEY 사용)
      — 외부망이거나 h-chat 장애 시 자동 전환. 단 401/403(키 문제)은 폴백하지 않고 에러 노출.
```

- h-chat 키는 popup 메모리에만 캐시된다. popup을 닫으면 캐시가 사라지므로
  키를 교체해도 익스텐션 리로드/재배포가 필요 없다.

## h-chat 키 교체 방법 (키 만료·문제 발생 시)

새 h-chat Personal API Key를 발급받은 뒤, Supabase에서 값만 바꾸면 끝.

1. Supabase 대시보드: https://supabase.com/dashboard/project/dkdmfyhhdfcmhciwetfj
2. **SQL Editor**에서:
   ```sql
   update settings set value = '<새 h-chat 키>' where key = 'hchat_api_key';
   ```
   또는 **Table Editor → settings 테이블 → key='hchat_api_key' row의 value 수정**.
3. 끝. 재배포·익스텐션 리로드 불필요 (popup을 새로 열면 즉시 새 키 사용).

증상 참고: 요약 시 "h-chat 인증 실패 (401/403)" 에러가 뜨면 키 문제다.
"자격증명이 settings 테이블에 없음"이 뜨면 row 자체가 삭제된 것이니 insert:

```sql
insert into settings (key, value) values ('hchat_api_key', '<h-chat 키>');
```

## 설치

1. `chrome://extensions` → 개발자 모드 ON → "압축해제된 확장 프로그램을 로드"
2. 이 폴더(`chrome-extension/`) 선택
3. `config.js`의 `API_URL`/`API_KEY`는 커밋된 값 그대로 사용 (별도 설정 불필요)
