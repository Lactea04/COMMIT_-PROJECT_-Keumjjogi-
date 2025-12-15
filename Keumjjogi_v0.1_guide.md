# 금쪽이 (Keumjjogi) v0.1 - 코드 설명 가이드

## 📋 목차
1. [프로그램 개요](#프로그램-개요)
2. [HTML 구조](#html-구조)
3. [CSS 스타일](#css-스타일)
4. [JavaScript 로직](#javascript-로직)
5. [주요 함수 설명](#주요-함수-설명)

---

## 프로그램 개요

**금쪽이**는 금융 지식을 퀴즈와 단서 수집 방식으로 학습하는 웹 기반 교육 게임입니다.

### 핵심 게임 메커니즘
1. **일반 문제**: 객관식/주관식 퀴즈를 풀면서 단서(글자) 획득
2. **단서 수집**: 각 문제를 맞추면 글자 하나씩 모음 (예: A, P, P, L, E)
3. **테마 문제**: 모은 단서를 조합해서 최종 단어 맞추기 (예: APPLE)

### 점수 시스템
- 객관식 정답: **+20점**
- 주관식 정답: **+30점**
- 오답: **-2점** (최소 0점)

---

## HTML 구조

### 화면 구성 (5개의 메인 화면)

```
홈 화면 (home)
  ↓
스테이지 로드맵 (roadmap)
  ↓
퀴즈 화면 (quiz) ⇄ 단서 보기 (clues)
  ↓
스테이지 요약 (summary)
```

#### 1. **홈 화면** (`screen-home`)
- 게임 소개
- "금융사 로드맵으로 이동" 버튼

#### 2. **스테이지 로드맵** (`screen-roadmap`)
- 현재는 베타 스테이지(과일 테마)만 제공
- 향후 리먼 브라더스, 대공황 등 금융사 사건 추가 예정

#### 3. **퀴즈 화면** (`screen-quiz`)
- 진행 상황 표시 (스테이지 제목, 문제 번호)
- 문제 텍스트
- 보기 또는 입력란 (JavaScript로 동적 생성)
- 버튼: 정답 제출, 다음 문제, 힌트 보기, 단서 보기

#### 4. **단서 보기 화면** (`screen-clues`)
- 지금까지 수집한 단서를 큰 글씨로 표시
- 예: `A P P L E`

#### 5. **스테이지 요약 화면** (`screen-summary`)
- 스테이지 완료 메시지
- 테마 설명
- 최종 점수

---

## CSS 스타일

### 레이아웃 시스템

#### 화면 전환 메커니즘
```css
.screen {
  display: none;  /* 기본적으로 모든 화면 숨김 */
}

.screen.active {
  display: block;  /* 활성화된 화면만 표시 */
}
```

JavaScript에서 `showScreen()` 함수가 이 클래스를 토글하여 화면 전환

#### 버튼 스타일 시스템
- `.primary`: 파란색 (#2d6cdf) - 주요 액션
- `.secondary`: 회색 (#e0e0e0) - 보조 액션
- `.danger`: 빨간색 (#e57373) - 돌아가기, 리셋 등

### 피드백 UI

#### 정답/오답 표시
```css
.feedback-correct {
  color: #2e7d32;  /* 초록색 */
}

.feedback-wrong {
  color: #c62828;  /* 빨간색 */
}
```

#### 특수 박스
- `.clue-box`: 노란색 배경 (#fff3cd) - 단서 획득 알림
- `.hint-box`: 파란색 배경 (#e3f2fd) - 힌트 표시

---

## JavaScript 로직

### 1. 데이터 구조

#### 스테이지 객체
```javascript
const stage1 = {
  stageId: "stage1",
  title: "과일 스테이지",
  summary: "스테이지 완료 후 표시될 요약 텍스트",
  questions: [
    {
      id: "q1",
      type: "mcq",  // "mcq" (객관식) 또는 "short" (주관식)
      question: "문제 텍스트",
      options: ["보기1", "보기2", "보기3"],  // 객관식만
      answer: 1,  // 객관식: 인덱스, 주관식: 문자열
      hint: "힌트 텍스트",
      clue: "A",  // 정답 시 지급할 단서
      explanation: "해설 텍스트"
    }
  ]
}
```

#### 상태 변수
```javascript
let currentStage = null;          // 현재 스테이지 데이터
let currentQuestionIndex = 0;     // 현재 문제 번호 (0부터 시작)
let score = 0;                    // 누적 점수
let clues = [];                   // 수집한 단서 ["A", "P", "P", "L", "E"]
let hasClearedCurrent = false;    // 현재 문제 정답 처리 여부
```

### 2. 핵심 워크플로우

#### 스테이지 시작
```javascript
function enterStage1() {
  currentStage = stage1;     // 스테이지 데이터 로드
  resetStageState();         // 점수, 단서, 문제 번호 초기화
  renderQuestion();          // 첫 번째 문제 렌더링
  showScreen("quiz");        // 퀴즈 화면으로 전환
}
```

#### 문제 렌더링 과정
1. **문제 유형 판별**: 마지막 문제인지 확인 (테마 문제)
2. **UI 초기화**: 피드백 영역 초기화, 다음 버튼 비활성화
3. **보기 생성**:
   - 객관식: 버튼 형태 (`option-btn`)
   - 주관식: 텍스트 입력란 (`input[type="text"]`)

#### 정답 제출 처리
```javascript
function handleSubmit() {
  // 1. 사용자 답변 가져오기
  // 2. 정답 비교
  // 3. 정답일 경우:
  //    - 점수 추가 (객관식 +20, 주관식 +30)
  //    - 단서 지급 (테마 문제는 제외)
  //    - 다음 문제 버튼 활성화
  // 4. 오답일 경우:
  //    - 점수 감점 (-2점)
  //    - 힌트 안내 표시
}
```

---

## 주요 함수 설명

### 화면 관리

#### `showScreen(name)`
특정 화면을 활성화하고 나머지는 숨깁니다.

```javascript
function showScreen(name) {
  screens.forEach((s) => {
    const el = document.getElementById(`screen-${s}`);
    if (s === name) el.classList.add("active");
    else el.classList.remove("active");
  });
  updateScoreDisplay();
}
```

**사용 예시:**
- `showScreen("home")` → 홈 화면 표시
- `showScreen("quiz")` → 퀴즈 화면 표시

---

### 문제 관리

#### `renderQuestion()`
현재 문제를 화면에 렌더링합니다.

**주요 작업:**
1. 테마 문제 여부 판별
2. 진행 상황 업데이트 (예: "문제 1/5")
3. 문제 텍스트 표시
4. 보기 또는 입력란 동적 생성

**객관식 보기 생성 예시:**
```javascript
q.options.forEach((opt, idx) => {
  const btn = document.createElement("button");
  btn.textContent = opt;
  btn.className = "option-btn secondary";
  btn.addEventListener("click", () => {
    // 선택 표시 (파란색 테두리)
    all.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
  optionsContainer.appendChild(btn);
});
```

---

#### `handleSubmit()`
정답 제출을 처리합니다.

**처리 흐름:**
```
1. 중복 제출 방지 체크
   ↓
2. 사용자 답변 가져오기
   - 객관식: 선택된 보기의 인덱스
   - 주관식: 입력란의 텍스트 (trim 처리)
   ↓
3. 정답 비교
   ↓
4. 정답인 경우:
   - 점수 추가
   - hasClearedCurrent = true
   - 힌트 버튼 비활성화
   - 단서 지급 (일반 문제만)
   - 다음 문제 버튼 활성화
   ↓
5. 오답인 경우:
   - 점수 감점 (-2점, 최소 0점)
   - 힌트 안내 메시지 표시
```

---

#### `handleNextQuestion()`
다음 문제로 이동하거나 스테이지를 완료합니다.

```javascript
function handleNextQuestion() {
  if (!hasClearedCurrent) {
    alert("정답을 맞춘 후에만 다음 문제로 이동할 수 있습니다.");
    return;
  }

  if (!isTheme) {
    // 다음 일반 문제 or 테마 문제 진입
    currentQuestionIndex++;
    renderQuestion();
  } else {
    // 테마 문제까지 완료 → 스테이지 요약 화면
    showStageSummary();
  }
}
```

---

### 힌트 & 단서

#### `handleShowHint()`
현재 문제의 힌트를 표시합니다.

**특징:**
- 이미 힌트가 표시되어 있으면 중복 추가하지 않음
- 힌트가 없는 문제는 알림 표시

#### `handleShowCluesScreen()`
지금까지 수집한 단서를 큰 글씨로 표시합니다.

**표시 형식:**
```javascript
clues.join(" ")  // "A P P L E"
```

---

## 이벤트 바인딩

모든 버튼 클릭 이벤트는 페이지 로드 시 한 번만 연결됩니다:

```javascript
// 홈 화면
document.getElementById("btnGoToMap").addEventListener("click", () => {
  showScreen("roadmap");
});

// 퀴즈 화면
document.getElementById("btnSubmit").addEventListener("click", handleSubmit);
document.getElementById("btnNext").addEventListener("click", handleNextQuestion);
document.getElementById("btnShowHint").addEventListener("click", handleShowHint);
document.getElementById("btnShowClues").addEventListener("click", handleShowCluesScreen);
```

---

## 확장 가능성

### 새로운 스테이지 추가하기

1. **스테이지 데이터 정의**
```javascript
const stage2 = {
  stageId: "stage2",
  title: "리먼 브라더스 스테이지",
  summary: "2008년 금융위기에 대한 설명...",
  questions: [ /* 문제 배열 */ ]
};
```

2. **로드맵에 버튼 추가**
```html
<button class="primary" id="btnEnterStage2">스테이지 2 진입</button>
```

3. **이벤트 리스너 추가**
```javascript
document.getElementById("btnEnterStage2").addEventListener("click", () => {
  currentStage = stage2;
  resetStageState();
  renderQuestion();
  showScreen("quiz");
});
```

---

## 코드 개선 아이디어

### 현재 구현의 한계
1. **로컬스토리지 미사용**: 새로고침 시 진행 상황 사라짐
2. **반응형 디자인 미흡**: 모바일 최적화 부족
3. **하드코딩된 스테이지**: stage1만 존재

### 개선 방향
1. **상태 저장**: `localStorage`로 점수와 진행 상황 저장
2. **API 연동**: 서버에서 스테이지 데이터 로드
3. **애니메이션**: 화면 전환 시 부드러운 효과
4. **접근성**: ARIA 속성 추가

---

## 마무리

이 코드는 **교육용 게임의 베타 버전**으로, 핵심 메커니즘을 검증하기 위한 프로토타입입니다. 

- ✅ **장점**: 단일 HTML 파일로 간단하고 이해하기 쉬움
- ⚠️ **단점**: 확장성과 유지보수성이 낮음

향후 실제 금융사 사건(리먼 브라더스, 대공황 등)을 다루는 스테이지가 추가될 예정입니다! 🎯💰
