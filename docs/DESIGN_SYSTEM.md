# STAR 디자인 시스템과 자산 보존

## 브랜드 방향

- 앱 이름: `STAR`
- 기본 무드: 패션 에디토리얼, 블랙 중심, 화이트·아이보리 보조
- 불필요한 설명과 장식은 줄이고 강한 볼드 타이포그래피를 사용
- 검은 별 로고의 모양은 변경하지 않음
- 채팅 기능과 데이터 구조는 디자인 변경과 분리해 유지

## 컬러

브랜드키트 기준 핵심 팔레트입니다.

| 이름 | 값 | 용도 |
|---|---|---|
| Black | `#080808` | 랜딩 배경, 콜라주 간격, 핵심 텍스트 |
| Charcoal | `#333333` | 보조 표면과 텍스트 |
| Gray | `#D6D6D6` | 경계와 비활성 상태 |
| Ivory | `#F7F5ED` | 채팅·CTA 배경 |
| White | `#FFFFFF` | 검은 배경 위 텍스트와 로고 |

현재 구현의 세부 색상은 `apps/web/app/globals.css`를 단일 소스로 봅니다.

## 타이포그래피

- Display: Helvetica 계열의 매우 굵은 산세리프 인상
- UI: Inter 계열
- `STAR`, `LOOKBOOK`, `ASK STAR`는 큰 볼드 디스플레이
- 설명 문구는 최소화하고 탐색과 행동 문구를 짧게 유지

시스템 폰트 fallback을 유지해 별도 상용 폰트 파일이 없어도 레이아웃이 무너지지 않게 합니다.

## 로고

- `apps/web/public/star-mark-black.png`: 아이보리·화이트 배경용 검은 별
- 브랜드키트의 별 형태를 임의로 둥글게 하거나 다른 별 아이콘으로 교체하지 않음
- 검은 배경에서는 흰색 STAR 조합을 사용
- 기존 Brown-Chat 갈색 별은 과거 UI 기록과 채팅 내부 호환 자산으로 보존

## 랜딩 콜라주

- 원본 인물·디테일 사진의 색과 내용을 임의로 생성·변형하지 않음
- 크기가 다른 사각형을 엄격한 격자에 맞춰 배치
- 사진끼리 겹치거나 과한 회전·그림자를 사용하지 않음
- 검은 배경은 사진 사이의 일정한 선형 여백으로 보이게 함
- hover에서는 카드 전체를 이동시키지 않고 이미지에만 미세 확대 적용
- 모바일도 같은 순서와 규칙을 유지하되 6열 격자로 재배치

실제 배치는 `apps/web/app/page.tsx`와 `apps/web/app/globals.css`의 `.star-lookbook`, `.star-look-*` 규칙에 있습니다.

## 채팅 UI에서 유지해야 할 기능

- 프로젝트와 무제한 하위 프로젝트
- 프로젝트별 대화 저장
- 프로젝트·대화 고정과 고정 해제
- 항목별 점 세 개 메뉴
- 접힘·임시 표시·고정이 가능한 별 사이드바 핸들
- 이미지 붙여넣기와 현재 화면 내 확대
- Markdown 답변
- SSE 스트리밍
- 음성 모드, Whisper 전사, 브라우저 TTS
- 전사 질문과 답변의 일반 대화 DB 저장

리브랜딩 작업에서 위 기능과 API 계약을 삭제하거나 데모 데이터로 교체하지 않습니다.

## 현재 STAR 원본

- `STAR_brandkit.png`: 브랜드키트 합본 원본
- `star-hero.jpg`: 히어로용 편집 이미지
- `star-mark-black.png`: 검은 별 로고
- `star-arrow-icon-v2.png`: 원형 화살표 UI 자산
- `Justin Bieber.jpg`
- `Travis Scott.jpg`
- `Ye 3.jpg`
- `Skate.jpg`
- `다운로드.jpg`, `다운로드 (1).jpg` ~ `다운로드 (6).jpg`

이 파일명은 코드에서 직접 참조되므로 이름을 바꿀 때는 `page.tsx` 참조도 함께 변경합니다.

## 과거 Brown-Chat 자산

다음 파일은 디자인 변천과 롤백을 위해 삭제하지 않습니다.

- `brown-chat-designkit.png`, `_2`, `_3`
- `brown-chat-hero.png`, `-v2`, `-v3`
- `brown-chat-mark.png`, `-v2`, `-v3`
- `brown-chat-auth-v2.png`
- `wallpaper.jpg`

## QA 자료

`apps/web/design-qa*.png`와 `apps/web/design-qa.md`는 디자인 변경 과정을 보존합니다. 가장 최근 모자이크 검증 자료는 다음입니다.

- `design-qa-mosaic-top.png`
- `design-qa-mosaic-lower.png`
- `design-qa-mosaic-comparison.png`

## 변경 체크리스트

1. 기존 사진을 그대로 사용했는가
2. 로고 형태를 바꾸지 않았는가
3. 검정·흰색·아이보리 중심 팔레트인가
4. 모바일에서 사진이 지나치게 잘리지 않는가
5. 콜라주가 겹치지 않고 검은 간격으로 정렬되는가
6. 채팅·프로젝트·첨부·음성 기능이 유지되는가
7. `npm run lint`와 `npm run build`를 통과하는가
8. 구현 화면과 레퍼런스 비교 캡처를 남겼는가
