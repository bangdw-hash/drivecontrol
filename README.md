# Drive Control

휴대폰에서 공유받은 파일을 OneDrive의 원하는 경로·파일명으로 저장하고,
PC의 AHK가 쓰는 txt(최근 폴더·파일명 규칙·최근 작업 파일)를 같이 읽고 갱신하는 개인용 PWA입니다.

- 저장: OneDrive (Microsoft Graph, 서버 없이 브라우저에서 PKCE 로그인)
- F2+N: `filename_rules.txt` 조회·저장·편집
- F2+F: `recent_work_files.txt` / `pinned_work_files.txt` 조회, OneDrive 파일은 열기·링크, 그 외(G:, W:, C:)는 경로 복사
- 공유 시트에 "Drive Control"이 나타남 (Android Chrome에서 설치한 PWA)

## 설정
1. Azure(Entra) 앱 등록 → 플랫폼 **SPA**, 리디렉션 URI = 배포 주소(`https://bangdw-hash.github.io/drivecontrol/`)
2. 앱 [설정]에 Client ID 입력 (또는 `config.js`)
3. 폰 Chrome에서 주소 열기 → 메뉴 → 앱 설치(홈 화면에 추가)

## 주의
- 개인 txt/AHK 파일은 이 저장소에 올리지 마세요 (`.gitignore` 참고). 앱은 OneDrive에서 직접 읽습니다.
- Client Secret은 사용하지 않습니다.
