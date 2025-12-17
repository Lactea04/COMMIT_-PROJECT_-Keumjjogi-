/*
=================================================
BUILD NOTE – Stage Outro Replay Behavior Update
UPDATED: 2025-12-17-20:40

[CHANGE SUMMARY]
- Stage Outro(스테이지 아웃트로)를
  "한 번만 보기"가 아닌,
  "진행 상황 초기화 전까지 반복 시청 가능"하도록 동작 수정.

[PREVIOUS BEHAVIOR]
- 로드맵에서 아웃트로 버튼 클릭 시
  pendingStageOutro를 즉시 null로 초기화하여
  아웃트로를 한 번 본 이후 버튼이 사라졌음.

[UPDATED BEHAVIOR]
- 로드맵의 '아웃트로 보기' 버튼 클릭 시
  pendingStageOutro를 유지하도록 변경.
- 아웃트로 시청 후 로드맵으로 돌아와도
  버튼이 계속 표시되어 재시청 가능.

[INTENTIONAL RESET CONDITIONS]
- 아래 상황에서는 pendingStageOutro를 정상적으로 초기화함:
  1) 새로운 스테이지 시작 시
  2) 진행 상황 초기화(resetStage / resetStageSilently) 시
  3) DEV 모드 정리 흐름에서 상태 리셋 시

[DESIGN INTENT]
- 아웃트로는 스테이지 클리어에 대한 "보상/정리 콘텐츠"로 간주
- 사용자가 원할 경우 반복해서 확인할 수 있도록 UX 개선
- 단, 진행 상태가 초기화되면 자연스럽게 다시 숨겨짐

[RESULT]
- 스테이지 진행 맥락을 해치지 않으면서
  아웃트로 접근성과 회독성을 향상시킴
=================================================
*/


// main.js
let currentState = null;
let lastResult = null;
let lastSelectedIndex = null;   // 마지막에 내가 고른 보기 인덱스
let isRetryMode = false;        // 🔹 오답 후 재시도 모드인지 여부
let pendingState = null;        // 정답 제출 후 "다음 문제 상태" 임시 보관
let frozenQuestionState = null; // 정답 제출 직후 화면에 남겨둘 "현재 문제 상태"
let postClearTransition = null; // ✅ 마지막 정답 후 "요약 보기"로 넘길 전환 정보
let reviewReturnEventKey = null;  // ✅ 복습(완료 이벤트) 진입 시, 돌아갈 '원래 진행 이벤트' 키 저장
let pendingStageOutro = null; // { payload, ui } // ✅ 스테이지 클리어 후, 로드맵에서 '아웃트로 보기'로 트리거하기 위한 대기값
let userAvatar = null;
let partnerAvatar = null;



// ========================
// 로드맵: 사건(10개) 정의
// ========================
const EVENTS = [
    { key: "1_the_great_depression_1929", title: "1929 대공황" },
    { key: "2_bretton_woods_1944", title: "1944 브레튼우즈 체제" },
    { key: "3_nixon_shock_1971", title: "1971 닉슨 쇼크" },
    { key: "4_japan_bubble_burst", title: "일본 버블 붕괴" },
    { key: "5_black_monday_1987", title: "1987 블랙 먼데이" },
    { key: "6_asian_financial_crisis_1997", title: "1997 아시아 외환위기" },
    { key: "7_dotcom_bubble_2000", title: "2000 닷컴 버블" },
    { key: "8_global_financial_crisis_2008", title: "2008 글로벌 금융위기" },
    { key: "9_eurozone_debt_crisis_2010_2012", title: "유럽 재정위기" },
    { key: "r10_covid_liquidity_rally_2020", title: "2020 코로나 유동성 랠리" },
];

const DEV_TOUCHED_KEY = "devTouched";

function isCleared(clearedMap, key) {
    if (!key || !clearedMap) return false;
    if (clearedMap instanceof Map) return clearedMap.get(key) === true;
    return !!clearedMap[key]; // object fallback
}

function getEventStatus(index, state, clearedMap) {
    const key = EVENTS[index]?.key;
    if (!key) return "locked";

    const stageCleared = !!(state?.stageCleared || state?.stage_cleared);

    // 다음으로 풀어야 할 이벤트
    const nextIdx = EVENTS.findIndex(ev => !isCleared(clearedMap, ev.key));

    // 다 클리어된 경우
    // 다 클리어된 경우
    if (nextIdx === -1) {
        // 이벤트가 전부 cleared라면 stageCleared 플래그가 없어도 복습 가능하게
        return "completed";
    }


    if (index < nextIdx) return "completed";
    if (index === nextIdx) return "active";
    return "locked";
}

function getEventProgress(eventIdx, state, clearedMap) {
    const evKey = EVENTS[eventIdx]?.key;

    if (evKey) {
        // 이미 클리어면 5/5
        if (isCleared(clearedMap, evKey)) return 5;

        // 현재 진행 중 이벤트면 eventIndex + 1
        const curKey =
            state?.currentEvent?.eventKey ||
            state?.event?.eventKey ||
            state?.currentEventKey ||
            null;

        if (curKey && curKey === evKey) {
            const idx = Number(
                state?.currentEvent?.eventIndex ??
                state?.event?.eventIndex ??
                0
            );
            return Math.max(1, Math.min(5, idx + 1));
        }

        // 나머지는 0/5
        return 0;
    }

    // fallback
    const currentIndex = Number(state?.currentIndex ?? 0);
    const start = eventIdx * 5;
    const inEvent = currentIndex - start;
    return Math.max(0, Math.min(5, inEvent + 1));
}

function renderEventRoadmap() {
    const container = document.getElementById("event-roadmap");
    if (!container) return;

    // 아직 state를 못 받아온 첫 로딩 타이밍이면, 안내만
    if (!currentState) {
        container.innerHTML = `<div class="event-card locked">
      <div class="event-title">로드맵 로딩 중…</div>
      <div class="event-meta"><span class="event-pill">잠시만!</span></div>
    </div>`;
        return;
    }

    const clearedMap = getClearedMapFromState(currentState);

    container.innerHTML = "";
    EVENTS.forEach((ev, i) => {
        const status = getEventStatus(i, currentState, clearedMap);
        const prog = getEventProgress(i, currentState, clearedMap);

        const card = document.createElement("div");
        card.className = `event-card ${status}`;

        const statusLabel =
            status === "locked"
                ? "잠김"
                : status === "active"
                    ? "계속하기"
                    : "복습하기";


        const rightIcon =
            status === "locked"
                ? `<svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3"></path><rect x="6" y="11" width="12" height="10" rx="2"></rect></svg>`
                : `<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"></path></svg>`;

        card.innerHTML = `
  <div class="event-row">
    <div class="event-left">
      <div class="event-title">${ev.title}</div>
      <div class="event-meta">
        <span class="event-pill">${statusLabel}</span>
        <span class="event-pill">${prog} / 5</span>
      </div>
    </div>

    <div class="event-right" aria-hidden="true">
      ${rightIcon}
    </div>
  </div>
`;


        // ✅ 클릭 정책:
        // - 완료/진행중은 이벤트 시작 가능
        // - 잠김은 클릭 막기
        if (status !== "locked") {
            card.addEventListener("click", async () => {

                // 🟡 1. 진행 중 사건 → 계속하기
                if (status === "active") {
                    // ✅ 진행 중 사건은 서버 start_event를 다시 호출하면 진행도가 초기화될 수 있으니 호출 금지
                    // 대신 "현재 상태에 들어있는 event intro"만 먼저 보여준다.
                    const eventTitle =
                        currentState?.currentEvent?.title ||
                        currentState?.event?.eventTitle ||
                        ev.title ||
                        "사건";

                    const introPayload =
                        currentState?.currentEvent?.intro ||
                        currentState?.eventIntro ||
                        null;

                    if (introPayload) {
                        startStory(
                            "eventIntro",
                            "event-intro",
                            "event-intro",
                            introPayload,
                            { title: eventTitle, subtitle: "사건 배경" }
                        );
                    } else {
                        // 인트로가 없으면 기존처럼 바로 퀴즈
                        showScreen("quiz");
                        renderAll();
                    }
                    return;
                }


                // 🟢 2. 완료된 사건 → 복습하기
                if (status === "completed") {
                    // ✅ 복습 들어가기 전, 원래 진행해야 할 다음 이벤트 키 저장
                    reviewReturnEventKey = getNextUnclearedEventKey(currentState);

                    await startEvent(ev.key);
                    return;
                }
            });
        }



        container.appendChild(card);
    });
    updateStageOutroButton();
}

function updateStageOutroButton() {
    const btn = document.getElementById("roadmap-stage-outro-btn");
    if (!btn) return;

    // pendingStageOutro가 있으면 보여주고, 없으면 숨김
    btn.style.display = pendingStageOutro ? "inline-flex" : "none";
}

// ------------------------
//  화면 전환
// ------------------------
function showScreen(name) {
    document.querySelectorAll(".screen").forEach((el) => {
        el.classList.remove("active");
    });
    const target = document.getElementById(`${name}-screen`);
    if (target) target.classList.add("active");

    // ✅ 로드맵 화면으로 들어갈 때 사건 카드 갱신
    if (name === "roadmap") {
        renderEventRoadmap();
    }
}

// ========================
//  스토리(인트로/아웃트로) 슬라이드 엔진
// ========================

// 현재 재생 중인 스토리 상태
let story = {
    type: null,          // "stageIntro" | "eventIntro" | "eventOutro" | "stageOutro"
    slides: [],
    idx: 0,
};

// intro/outro 데이터가 어떤 형태로 와도 slides 배열로 정규화
function normalizeSlides(payload) {
    if (!payload) return [];

    // 1) 이미 배열이면 그대로
    if (Array.isArray(payload)) {
        return payload.map((s) => ({
            text: s.text ?? s.content ?? "",
            imageUrl: s.imageUrl ?? s.img ?? s.image ?? "",
            title: s.title ?? "",
        }));
    }

    // 2) { slides: [...] } 형태
    if (payload.slides && Array.isArray(payload.slides)) {
        return payload.slides.map((s) => ({
            text: s.text ?? s.content ?? "",
            imageUrl: s.imageUrl ?? s.img ?? s.image ?? "",
            title: s.title ?? "",
        }));
    }

    // 3) 문자열 하나면 텍스트로 취급
    if (typeof payload === "string") {
        return [{ text: payload, imageUrl: "" }];
    }

    // 4) { text, imageUrl } 단일 객체
    if (typeof payload === "object") {
        return [{
            text: payload.text ?? payload.content ?? "",
            imageUrl: payload.imageUrl ?? payload.img ?? payload.image ?? "",
            title: payload.title ?? "",
        }];
    }
}

// 특정 스토리 화면 렌더
function renderStoryScreen(prefix, slides, idx) {
    const titleEl = document.getElementById(`${prefix}-title`);
    const subEl   = document.getElementById(`${prefix}-summary`) || document.getElementById(`${prefix}-subtitle`);
    const textEl  = document.getElementById(`${prefix}-text`);
    const imgEl   = document.getElementById(`${prefix}-image`);

    const slide = slides[idx] || { text: "", imageUrl: "", title: "" };

    // 타이틀/서브타이틀은 상황별로 main.js에서 세팅할 거라 여기선 안전 처리만
    if (textEl) textEl.textContent = slide.text ?? "";

    if (imgEl) {
        if (slide.imageUrl) {
            imgEl.src = slide.imageUrl;
            imgEl.style.display = "block";
        } else {
            imgEl.removeAttribute("src");
            imgEl.style.display = "none";
        }
    }

    // 진행감(선택): subtitle이 있으면 "n / total" 정도 보이게
    if (subEl) {
        const n = idx + 1;
        const total = slides.length || 1;
        // 기존 텍스트가 있으면 뒤에 진행도만 덧붙이는 느낌
        const base = subEl.dataset.baseText ?? subEl.textContent ?? "";
        subEl.dataset.baseText = base;
        subEl.textContent = base ? `${base}  ·  ${n}/${total}` : `${n}/${total}`;
    }
}

// 스토리 시작
function startStory(type, screenName, prefix, payload, { title = "", subtitle = "" } = {}) {
    const slides = normalizeSlides(payload);
    story = { type, slides: slides.length ? slides : [{ text: "", imageUrl: "" }], idx: 0 };

    // 타이틀/서브타이틀 세팅
    const titleEl = document.getElementById(`${prefix}-title`);
    const subEl   = document.getElementById(`${prefix}-summary`) || document.getElementById(`${prefix}-subtitle`);
    if (titleEl) titleEl.textContent = title || titleEl.textContent;
    if (subEl) {
        subEl.textContent = subtitle || "";
        subEl.dataset.baseText = subtitle || "";
    }

    renderStoryScreen(prefix, story.slides, story.idx);
    updateStoryNextButton(prefix);
    showScreen(screenName);
}

// 다음 슬라이드
function nextStory(prefix) {
    if (!story.slides.length) return true;
    story.idx += 1;

    if (story.idx >= story.slides.length) {
        return true; // 끝
    }
    renderStoryScreen(prefix, story.slides, story.idx);
    updateStoryNextButton(prefix);
    return false;
}

function updateStoryNextButton(prefix) {
    const total = story?.slides?.length ?? 1;
    const isLast = (story?.idx ?? 0) >= total - 1;

    // ✅ 이벤트 인트로: 마지막 장만 "퀴즈 시작", 그 전은 무조건 "다음"
    if (prefix === "event-intro") {
        const btn = document.getElementById("event-intro-next-btn");
        if (btn) setButtonLabel(btn, isLast ? "퀴즈 시작" : "다음");
    }
}


function getClearedMapFromState(state) {
    const map = new Map();

    if (Array.isArray(state?.events)) {
        for (const ev of state.events) {
            if (ev?.key) map.set(ev.key, !!ev.cleared);
        }
        return map;
    }

    const arr =
        (Array.isArray(state?.clearedEvents) && state.clearedEvents) ||
        (Array.isArray(state?.completedEvents) && state.completedEvents) ||
        (Array.isArray(state?.stage?.clearedEvents) && state.stage.clearedEvents) ||
        [];

    for (const k of arr) map.set(k, true);
    return map;
}



function getNextUnclearedEventKey(state) {
    const list = state?.events;
    if (!Array.isArray(list)) return null;

    const next = list.find(ev => ev && ev.key && ev.cleared === false);
    return next ? next.key : null;
}

// 서버 state 키 이름이 섞여 와도 프론트가 안 깨지게 정규화
function normalizeState(raw) {
    if (!raw) return null;
    if (raw.status === "NOT_STARTED") return null;

    const summary = raw.summary ?? raw.stageSummary ?? "";
    const q = raw.question ? { ...raw.question, text: raw.question.text ?? raw.question.question ?? "" } : null;

    const currentEvent = raw.currentEvent ?? null;
    const event = currentEvent
        ? { eventKey: currentEvent.eventKey, eventTitle: currentEvent.title, eventIndex: currentEvent.eventIndex, eventTotal: currentEvent.eventTotal }
        : (raw.event ?? null);

    return { ...raw, summary, question: q, currentEvent, event, score: raw.score ?? 0,
        totalQuestions: raw.totalQuestions ?? raw.total_questions ?? 0 };
}


// ------------------------
//  API helpers
// ------------------------
// =========================
// DEV MODE (only when ?dev=1)
// =========================
function isDevMode() {
    return new URLSearchParams(window.location.search).get("dev") === "1";
}

function devLog(msg) {
    const el = document.getElementById("dev-log");
    if (!el) return;
    el.textContent = String(msg);
}

async function devSubmit(payload) {
    const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await res.json();

    // ✅ stageCleared가 뜨면 stageOutro 버튼 테스트를 위해 저장해둠
    if (data.stageCleared && data.stageOutro) {
        pendingStageOutro = {
            payload: data.stageOutro,
            ui: { title: currentState?.stageTitle || "스테이지", subtitle: "교훈/정리" },
        };
    }

    return data;
}

// 현재 문제를 "정답 나올 때까지" 자동으로 뚫는다 (MCQ는 최대 5번 시도)
async function autoSolveOne() {
    if (!currentState) await fetchState();
    if (!currentState || !currentState.question) return;

    const q = currentState.question;

    // 객관식: 0..N-1 brute force
    if (q.type === "mcq") {
        const n = Array.isArray(q.options) ? q.options.length : 0;
        for (let i = 0; i < n; i++) {
            const data = await devSubmit({ choiceIndex: i });

            devLog(
                `try=${i}\ncorrect=${!!data.correct}\neventCleared=${!!data.eventCleared}\nstageCleared=${!!data.stageCleared}`
            );

            if (data.correct || data.eventCleared || data.stageCleared) break;
        }

        // 서버 state로 동기화
        await fetchState();
        localStorage.setItem(DEV_TOUCHED_KEY, "1");
        showScreen("quiz");
        renderAll();
        return;
    }

    // 주관식: 자동화가 어려워서 안내만 (원하면 input 추가해서 devAnswer로 보내는 방식도 가능)
    devLog("주관식은 자동해결 불가(현재는). 필요하면 DEV 입력칸 추가해줄게.");
}

async function autoSolveEvent() {
    // 안전: 무한 루프 방지
    for (let k = 0; k < 40; k++) {
        await autoSolveOne();

        // event cleared면 stop
        if (lastResult?.eventCleared || pendingStageOutro) break;

        // 서버 기준으로 현재 이벤트가 바뀌었거나(다음 사건) 질문이 없으면 stop
        if (!currentState || !currentState.question) break;
    }
    devLog("autoSolveEvent done");
}

async function autoSolveStage() {
    for (let k = 0; k < 120; k++) {
        await autoSolveOne();

        if (pendingStageOutro) break;       // stageCleared 수신 시 저장됨
        if (!currentState || !currentState.question) break;
    }
    devLog("autoSolveStage done (stageOutro pending이면 로드맵 버튼 확인 ㄱㄱ)");
}

async function goRoadmapDev() {
    showScreen("roadmap");
    await fetchState();
    renderEventRoadmap();
    // 로드맵에 pendingStageOutro 버튼 표시 갱신도 같이
    if (typeof updateStageOutroButton === "function") updateStageOutroButton();
    devLog("roadmap");
}


async function fetchState() {
    const res = await fetch("/api/state");
    const raw = await res.json();

    currentState = normalizeState(raw);
    lastResult = null;

    // state가 없으면 홈 화면 유지 + 로드맵 렌더도 안전 처리
    if (!currentState) {
        renderEventRoadmap();
        return;
    }

    renderAll();
    renderEventRoadmap();
}

async function submitAnswer() {
    if (!currentState) return;

    const submitBtn = document.getElementById("submit-btn");

    // ✅ (NEW) 이벤트/스테이지 클리어 직후: "요약 보기" 버튼 역할
    if (postClearTransition) {
        const t = postClearTransition;
        postClearTransition = null;

        // 다음 상태로 확정 적용
        if (pendingState) {
            currentState = pendingState;
        }
        pendingState = null;
        frozenQuestionState = null;

        // 화면 이동(기존 자동 이동을 '여기'로 옮김)
        if (t.kind === "eventOutro" && t.payload) {
            startStory("eventOutro", "event-outro", "event-outro", t.payload, t.ui || {});
            return;
        }

        if (t.kind === "stageOutro" && t.payload) {
            startStory("stageOutro", "stage-outro", "stage-outro", t.payload, t.ui || {});
            return;
        }

        // 만약 payload가 없거나 예외면 안전하게 로드맵으로
        showScreen("roadmap");
        await fetchState();
        return;
    }


    // 🔁 재시도 모드인 경우: 서버에 다시 보내지 않고 화면만 초기화
    if (isRetryMode) {
        resetAvatar();
        lastResult = null;
        lastSelectedIndex = null;
        isRetryMode = false;

        if (submitBtn) setButtonLabel(submitBtn, "정답 제출")

        const fb = document.getElementById("feedback");
        if (fb) {
            fb.textContent = "";
            fb.className = "feedback";
        }

        // 같은 문제를 “처음 상태”로 다시 그림
        renderAll();
        return;
    }

    const q = currentState.question;
    let payload = {};

    if (q.type === "mcq") {
        const selected = document.querySelector("#options-container button.selected");
        if (!selected) {
            alert("보기를 하나 선택해 주세요.");
            return;
        }
        const idx = Number(selected.dataset.index);
        payload.choiceIndex = idx;
        lastSelectedIndex = idx; // 🔹 내가 고른 보기 기억
    } else {
        const input = document.getElementById("short-answer");
        const value = input.value.trim();
        if (!value) {
            alert("정답을 입력해 주세요.");
            return;
        }
        payload.answer = value;
    }

    const res = await fetch("/api/submit", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
    });

    const data = await res.json();
    lastResult = data;

    // 서버가 준 최신 상태는 "pending"으로만 보관
    pendingState = normalizeState(data.publicState);

    // 제출 직전(현재 문제) 상태를 얼려둘 용도(필요하면 쓰기)
    frozenQuestionState = JSON.parse(JSON.stringify(currentState));

    // 1) 이벤트/스테이지 클리어면: pending을 즉시 적용하고 스토리로 이동
    // 1) 이벤트/스테이지 클리어면: ❌즉시 이동하지 말고 "요약 보기"로 대기
// 1) 이벤트/스테이지 클리어면: ❌즉시 이동하지 말고 "요약 보기"로 대기
    if (data.eventCleared || data.stageCleared) {
        setAvatarCorrect();

        // ✅ (NEW) stageCleared가 같이 뜨는 케이스(마지막 사건) 대비:
        // eventOutro를 우선 보여주더라도 stageOutro는 로드맵용으로 저장해둔다.
        if (data.stageCleared && data.stageOutro) {
            pendingStageOutro = {
                payload: data.stageOutro,
                ui: { title: currentState?.stageTitle || "스테이지", subtitle: "교훈/정리" }
            };
        }

        // 점수는 반영(다음 상태에 이미 반영되어 있음)
        currentState.score = pendingState?.score ?? currentState.score;

        // 현재 문제 화면을 유지한 채(해설 읽기), 전환 정보만 저장
        postClearTransition = null;

        if (data.eventCleared && data.eventOutro) {
            const eventTitle =
                currentState?.currentEvent?.title ||
                currentState?.event?.eventTitle ||
                "사건";

            postClearTransition = {
                kind: "eventOutro",
                payload: data.eventOutro,
                ui: { title: "사건 요약", subtitle: eventTitle }
            };
        } else if (data.stageCleared && data.stageOutro) {
            postClearTransition = {
                kind: "stageOutro",
                payload: data.stageOutro,
                ui: { title: currentState?.stageTitle || "스테이지", subtitle: "교훈/정리" }
            };
        } else {
            // payload가 없으면 로드맵으로 보내는 안전장치
            postClearTransition = { kind: "roadmap", payload: null };
        }

        // 피드백(해설 포함) 보여주고, 버튼을 "요약 보기"로 바꾼 상태로 머무름
        renderAll();
        renderFeedback(data);

        // 다음 문제 버튼은 의미 없으니 잠가두기
        const nextBtn = document.getElementById("next-btn");
        if (nextBtn) nextBtn.disabled = true;

        return;
    }


    // 2) 정답이면: 화면은 그대로 두고(현재 문제 유지), 다음 문제는 pending으로만 보관
    if (data.correct) {
        currentState.score = pendingState?.score ?? currentState.score;
        setAvatarCorrect();
        renderAll();
        renderFeedback(data);

        const nextBtn = document.getElementById("next-btn");
        if (nextBtn) nextBtn.disabled = false;

        return;
    }

    // 3) 오답이면: 재시도 모드 유지(기존 로직대로)
    setAvatarWrong();
    renderAll();
    renderFeedback(data);

}

// 🔹 특정 스테이지를 선택해서 시작
async function startStage(stageId) {
    pendingStageOutro = null;
    try {
        const res = await fetch("/api/start_stage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stageId }),
        });

        if (!res.ok) {
            console.error("start_stage 실패:", res.status);
            alert("스테이지를 시작하는 중 오류가 발생했어요. (서버)");
            return;
        }

        await fetchState();

// stage intro 표시(가능하면)
        const introPayload =
            currentState?.stageIntro ||
            currentState?.intro ||       // 혹시 이런 키로 올 수도 있으니
            null;

        if (introPayload) {
            startStory(
                "stageIntro",
                "stage-intro",
                "stage-intro",
                introPayload,
                { title: currentState.stageTitle || "스테이지", subtitle: currentState.summary || "" }
            );
        } else {
            // 인트로가 없으면 바로 로드맵으로
            showScreen("roadmap");
            renderEventRoadmap();
        }

    } catch (err) {
        console.error("startStage 에러:", err);
        alert("스테이지를 시작하는 중 오류가 발생했어요. (클라이언트)");
    }
}

// 🔹 특정 이벤트(사건)부터 시작: 서버에 점프 요청
async function startEvent(eventKey) {
    resetAvatar();
    try {
        const res = await fetch("/api/start_event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventKey }),
        });

        if (!res.ok) {
            console.error("start_event 실패:", res.status);
            alert("사건을 시작하는 중 오류가 발생했어요. (서버)");
            return;
        }

        const raw = await res.json();
        currentState = normalizeState(raw);
        // 🔋 이벤트 시작 시 배터리 초기화
        updateBatteryHUD(currentState);
        lastResult = null;
        lastSelectedIndex = null;
        isRetryMode = false;

        // 🔸 이벤트 인트로 표시(가능하면)
        // 백엔드 publicState에 currentEvent/outro/intro가 있다면 그걸 쓰고,
        // 없다면 일단 "바로 퀴즈"로 보낸다.
        const eventTitle = currentState?.event?.eventTitle || "사건";
        const introPayload =
            currentState?.currentEvent?.intro ||
            currentState?.eventIntro ||           // (혹시 이런 키로 줄 수도 있으니)
            null;

        if (introPayload) {
            startStory(
                "eventIntro",
                "event-intro",
                "event-intro",
                introPayload,
                { title: eventTitle, subtitle: "사건 배경" }
            );
        } else {
            showScreen("quiz");
            renderAll();
        }
    } catch (err) {
        console.error("startEvent 에러:", err);
        alert("사건을 시작하는 중 오류가 발생했어요. (클라이언트)");
    }
}

async function restoreProgressEventSilently(eventKey) {
    if (!eventKey) return;

    const res = await fetch("/api/start_event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventKey }),
    });

    if (!res.ok) return;

    const raw = await res.json();
    currentState = normalizeState(raw);

    // UX 잔여 상태 정리
    lastResult = null;
    lastSelectedIndex = null;
    isRetryMode = false;
    pendingState = null;
    frozenQuestionState = null;
    postClearTransition = null;

    // HUD 갱신
    updateBatteryHUD(currentState);
}

async function goRoadmapSafe() {
    // 1) 화면부터 먼저 로드맵으로 전환 (체감상 ‘안 먹힘’ 방지)
    showScreen("roadmap");

    // 2) 아바타 상태 초기화
    resetAvatar();

    // 3) 상태 최신화 (없으면 로드맵에 "로딩 중"이라도 뜸)
    await fetchState();

    // 4) 혹시라도 안전하게 한 번 더 렌더
    renderEventRoadmap();
}


async function goNext() {
    resetAvatar();
    // ✅ pendingState가 있으면 그걸 적용해서 다음 문제로 이동
    if (pendingState) {
        currentState = pendingState;
        pendingState = null;
        frozenQuestionState = null;

        lastResult = null;
        lastSelectedIndex = null;
        isRetryMode = false;

        renderAll();
        return;
    }

    // 혹시 pending이 없는 케이스(예: 새로고침/예외)면 기존처럼 서버에서 로드
    await fetchState();

    lastResult = null;
    lastSelectedIndex = null;
    isRetryMode = false;

    renderAll();
}


// 🔹 조용히 스테이지만 리셋 (confirm 없음)
async function resetStageSilently() {
    pendingStageOutro = null;
    await fetch("/api/reset", { method: "POST" });
    currentState = null;
    lastResult = null;
    lastSelectedIndex = null;
    isRetryMode = false;
    await fetchState();
}

function setAvatarCorrect() {
    const user = document.getElementById("user-avatar");
    const partner = document.getElementById("partner-avatar");

    const userBox = user?.closest(".status-item");
    const partnerBox = partner?.closest(".status-item");

    if (user) user.src = "/static/images/Status/human_correct.png";
    if (partner) partner.src = "/static/images/Status/robot_correct.png";

    // 유저 즉시 반응
    triggerAvatarReaction(userBox, "correct");

    // 로봇은 0.25초 늦게 반응
    setTimeout(() => {
        triggerAvatarReaction(partnerBox, "correct");
    }, 250);
}


function setAvatarWrong() {
    const user = document.getElementById("user-avatar");
    const partner = document.getElementById("partner-avatar");

    const userBox = user?.closest(".status-item");
    const partnerBox = partner?.closest(".status-item");

    if (user) user.src = "/static/images/Status/human_incorrect.png";
    if (partner) partner.src = "/static/images/Status/robot_incorrect.png";

    // 유저 즉시 반응
    triggerAvatarReaction(userBox, "wrong");

    // 로봇은 반 박자 늦게
    setTimeout(() => {
        triggerAvatarReaction(partnerBox, "wrong");
    }, 250);
}


function resetAvatar() {
    const user = document.getElementById("user-avatar");
    const partner = document.getElementById("partner-avatar");

    const userBox = user?.closest(".status-item");
    const partnerBox = partner?.closest(".status-item");

    if (user) user.src = "/static/images/Status/human_normal.png";
    if (partner) partner.src = "/static/images/Status/robot_normal.png";

    userBox?.classList.remove("react", "correct", "wrong");
    partnerBox?.classList.remove("react", "correct", "wrong");
}

function triggerAvatarReaction(targetEl, resultClass) {
    if (!targetEl) return;

    targetEl.classList.remove("react", "correct", "wrong");
    void targetEl.offsetWidth; // reflow (애니메이션 재실행용)

    targetEl.classList.add("react", resultClass);
}


function setButtonLabel(btn, text) {
    if (!btn) return;
    const label = btn.querySelector(".btn-label");
    if (label) {
        label.textContent = text;
    } else {
        // 혹시 라벨 구조가 없는 버튼이면 fallback
        btn.textContent = text;
    }
}


// ------------------------
//  퀴즈 화면 렌더링
// ------------------------
function renderAll() {
    if (!currentState) return;

    // 공통 DOM 참조
    const scoreEl = document.getElementById("score");
    const stageTitleEl = document.getElementById("stage-title");
    const stageSummaryEl = document.getElementById("stage-summary");
    const phaseLabelEl = document.getElementById("phase-label");
    const progressLabelEl = document.getElementById("progress-label");
    const questionTextEl = document.getElementById("question-text");
    const optionsContainer = document.getElementById("options-container");
    const shortInput = document.getElementById("short-answer");
    const nextBtn = document.getElementById("next-btn");
    const imgEl = document.getElementById("quiz-image");

    // 상태 값
    const s = currentState;
    const q = s.question;
    const answeredCorrect = !!(lastResult && lastResult.correct);

    // 점수
    if (scoreEl) scoreEl.textContent = String(s.score ?? 0);

    // 상단 정보
    if (stageTitleEl) stageTitleEl.textContent = s.stageTitle || "스테이지 제목";
    if (stageSummaryEl) stageSummaryEl.textContent = s.summary || "";

    // ✅ 사건(금융사/사건) 라벨 표시 (eventTitle + 사건 내 진행도)
    if (phaseLabelEl) {
        const ce = s.currentEvent;
        if (ce && ce.title) {
            const idx = (ce.eventIndex ?? 0) + 1;
            const total = ce.eventTotal ?? 0;
            phaseLabelEl.textContent = `${ce.title} · ${idx}/${total}`;
        } else {
            phaseLabelEl.textContent = "문제";
        }
    }


    // 전체 진행도 (1/50 같은)
    if (progressLabelEl) {
        progressLabelEl.textContent = ""; // 전체 진도는 로드맵에서만
    }


    // 문제 이미지
    if (imgEl) {
        if (q && q.imageUrl) {
            imgEl.src = q.imageUrl;
            imgEl.style.display = "block";
        } else {
            // 이미지 없으면 아예 숨김(빈 박스 방지)
            imgEl.removeAttribute("src");
            imgEl.style.display = "none";
        }
    }

    // 문제 텍스트
    if (questionTextEl) questionTextEl.textContent = (q && q.text) ? q.text : "";

    // 입력/보기 초기화
    optionsContainer.innerHTML = "";
    shortInput.value = "";
    shortInput.disabled = false;

    // 객관식/주관식 분기
    if (q.type === "mcq") {
        shortInput.style.display = "none";

        if (Array.isArray(q.options)) {
            q.options.forEach((opt, i) => {
                const btn = document.createElement("button");
                btn.textContent = opt;
                btn.dataset.index = String(i);

                btn.addEventListener("click", () => {
                    optionsContainer
                        .querySelectorAll("button")
                        .forEach((b) => b.classList.remove("selected"));
                    btn.classList.add("selected");
                });

                optionsContainer.appendChild(btn);
            });
        }

        // 정답/오답에 따라 버튼 색칠
        if (lastResult && typeof lastSelectedIndex === "number") {
            const correctIdx = lastResult.correctChoiceIndex;
            const buttons = optionsContainer.querySelectorAll("button");

            buttons.forEach((b) => {
                const idx = Number(b.dataset.index);
                b.classList.remove("selected", "option-correct", "option-wrong");

                // ✅ 정답을 맞춘 경우에만 정답 보기 강조 (초록색)
                if (
                    lastResult.correct === true &&
                    typeof correctIdx === "number" &&
                    idx === correctIdx
                ) {
                    b.classList.add("option-correct");
                }

                // ✅ 오답인 경우, 내가 고른 보기만 빨간색
                if (lastResult.correct === false && idx === lastSelectedIndex) {
                    b.classList.add("option-wrong");
                }
            });
        }

        // ✅ 오답이면 재시도 모드 ON, 그 외 OFF
        isRetryMode = !!(lastResult && lastResult.correct === false);


        // 정답 맞춘 뒤에는 보기 비활성화
        optionsContainer.querySelectorAll("button").forEach((b) => {
            b.disabled = answeredCorrect;
        });

    } else {
        // 주관식
        optionsContainer.innerHTML = "";
        shortInput.style.display = "block";
        shortInput.disabled = answeredCorrect;
    }

    // 제출 버튼은 정답 맞췄으면 비활성화
    const submitBtn = document.getElementById("submit-btn");
    if (submitBtn) {
        const isClearWaiting = !!postClearTransition && !!(lastResult && lastResult.correct);

        // ✅ 일반 정답이면 제출 버튼 비활성화지만,
        // ✅ 클리어 직후에는 "요약 보기" 버튼으로 써야 하니 활성화
        submitBtn.disabled = answeredCorrect && !isClearWaiting;

        if (isClearWaiting) {
            submitBtn.classList.remove("is-retry");
            setButtonLabel(submitBtn, "요약 보기");
        } else if (lastResult && lastResult.correct === false) {
            submitBtn.classList.add("is-retry");
            setButtonLabel(submitBtn, "재시도");
        } else {
            submitBtn.classList.remove("is-retry");
            setButtonLabel(submitBtn, "정답 제출");
        }
        // 🔋 배터리 HUD 진행도 갱신
        updateBatteryHUD(currentState);

    }



    // 다음 문제 버튼 활성화 여부
    if (nextBtn) {
        if (lastResult && lastResult.correct && !lastResult.stageCleared) {
            nextBtn.disabled = false;
        } else {
            nextBtn.disabled = true;
        }
    }

    // 새 문제로 넘어온 경우 피드백 초기화
    if (!lastResult) {
        const fb = document.getElementById("feedback");
        if (fb) {
            fb.textContent = "";
            fb.className = "feedback";
        }
    }
}

function renderFeedback(result) {
    const fb = document.getElementById("feedback");
    if (!fb) return;

    const msg = result.feedback ?? (result.correct ? "정답!" : "오답! 다시 시도해봐 🫠");
    let out = msg;

    // ✅ 정답일 때만 해설 표시(재시도 UX 스포 방지)
    const exp = currentState?.question?.explanation;
    if (result.correct === true && exp) {
        out += `\n\n해설) ${exp}`;
    }

    fb.textContent = out;

    fb.className = "feedback";
    if (result.correct) fb.classList.add("correct");
    else if (result.correct === false) fb.classList.add("wrong");
}



// ------------------------
//  요약 화면 렌더링 (단서 기능 제거 버전)
// ------------------------
function renderSummary(publicState) {
    const titleEl = document.getElementById("summary-stage-title");
    const textEl = document.getElementById("summary-text");
    const scoreEl = document.getElementById("final-score");

    if (titleEl) titleEl.textContent = publicState.stageTitle || "스테이지 요약";
    if (textEl) textEl.textContent = publicState.summary || "";
    if (scoreEl) scoreEl.textContent = publicState.score ?? 0;
}

// ------------------------
//  힌트 버튼
// ------------------------
function showHint() {
    if (!currentState) return;
    const q = currentState.question;
    if (!q.hasHint || !q.hint) {
        alert("이 문제에는 별도의 힌트가 없습니다.");
        return;
    }
    alert("힌트: " + q.hint);
}

// ========================
//  Battery HUD helper
// ========================
function updateBatteryHUD(state) {
    const hud = document.getElementById("battery-hud");
    if (!hud || !state) return;

    const ce = state.currentEvent;
    if (!ce) {
        // 이벤트가 없으면 숨기거나 초기화
        hud.dataset.level = "0";
        return;
    }

    // 1문제 = 1칸 (1~5)
    const level = Math.min(5, (ce.eventIndex ?? 0) + 1);

    hud.dataset.level = String(level);

    const label = hud.querySelector(".battery-sub");
    if (label) {
        label.textContent = `${level} / ${ce.eventTotal ?? 5}`;
    }
}


// ------------------------
//  안전하게 이벤트 바인딩하는 헬퍼
// ------------------------
function bindClick(id, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", handler);
}

// ------------------------
//  로드맵 스테이지 핫스팟 클릭 처리
// ------------------------
function bindRoadmapHotspots() {
    document.querySelectorAll(".stage-hotspot").forEach((hs) => {
        hs.addEventListener("click", async () => {
            const stageId = hs.dataset.stage;

            // 지금은 stage1만 활성화
            if (stageId !== "stage1") {
                alert("이 스테이지는 아직 준비 중입니다!");
                return;
            }

            await startStage(stageId);
        });
    });
}

// ------------------------
//  초기 바인딩
// ------------------------
document.addEventListener("DOMContentLoaded", () => {
    userAvatar = document.getElementById("user-avatar");
    partnerAvatar = document.getElementById("partner-avatar");
});

window.addEventListener("DOMContentLoaded", async () => {
    // ========================
// 스토리 화면 버튼 바인딩
// ========================
    bindClick("to-theme-btn", () => showScreen("theme"));
    bindClick("stage-intro-next-btn", () => {
        const done = nextStory("stage-intro");
        if (done) showScreen("roadmap");
    });
    bindClick("stage-intro-skip-btn", () => showScreen("roadmap"));
    bindClick("event-intro-next-btn", () => {
        const done = nextStory("event-intro");
        if (done) {
            showScreen("quiz");
            resetAvatar();
            renderAll();
        }
    });
    bindClick("event-intro-back-btn", async () => {
        if (reviewReturnEventKey) {
            await restoreProgressEventSilently(reviewReturnEventKey);
            reviewReturnEventKey = null;
        }
        await fetchState();
        showScreen("roadmap");
    });
    const userAvatar = document.getElementById("user-avatar");
    const partnerAvatar = document.getElementById("partner-avatar");


    bindClick("event-outro-next-btn", goRoadmapSafe);
    bindClick("stage-outro-next-btn", goRoadmapSafe);
    bindClick("roadmap-stage-outro-btn", () => {
        if (!pendingStageOutro) return;

        const t = pendingStageOutro;


        startStory(
            "stageOutro",
            "stage-outro",
            "stage-outro",
            t.payload,
            t.ui || { title: currentState?.stageTitle || "스테이지", subtitle: "교훈/정리" }
        );
    });


    bindClick("back-home-from-theme", () => showScreen("home"));

    async function resumeOrStartStage(stageId = "stage1") {
        // 1) 서버에 진행 중 STATE가 있는지 먼저 확인
        const res = await fetch("/api/state");
        const raw = await res.json();
        const st = normalizeState(raw);

        // 2) 이미 진행 중이고, 같은 스테이지라면: 리셋 금지 → 로드맵으로 복귀
        if (st && st.stageTitle && stageId === "stage1") {
            currentState = st;

            // ✅ 항상 stage-intro를 먼저 보여주고, 끝나면 roadmap으로
            const payload =
                currentState?.stageIntro ||
                currentState?.intro ||
                cachedStageIntroPayload ||   // (있으면)
                null;

            if (payload) {
                startStory(
                    "stageIntro",
                    "stage-intro",
                    "stage-intro",
                    payload,
                    { title: currentState.stageTitle || "스테이지", subtitle: currentState.summary || "" }
                );
                return;
            }

            // payload가 없으면 fallback
            showScreen("roadmap");
            renderEventRoadmap();
            updateStageOutroButton();
            return;
        }


        // 3) 진행 중이 없으면: 정상 시작
        await startStage(stageId);
    }

    bindClick("theme-global-btn", async () => {
        await resumeOrStartStage("stage1");
    });

    bindClick("back-theme-btn", () => showScreen("theme"));


    const startStageBtn = document.getElementById("start-stage-btn");
    if (startStageBtn) {
        startStageBtn.addEventListener("click", async (e) => {
            const stageId = e.currentTarget.dataset.stageId || "stage1";
            await startStage(stageId);
        });
    }


    bindClick("back-roadmap-from-quiz", goRoadmapSafe);


    // 요약 화면 버튼들
    bindClick("summary-to-roadmap-btn", goRoadmapSafe);
    bindClick("summary-restart-btn", async () => {
        await resetStageSilently();     // (위에서 분리한 경우)
        await startStage("stage1");     // 다시 stage intro → roadmap
    });


    // 퀴즈용 버튼
    bindClick("submit-btn", submitAnswer);
    bindClick("next-btn", goNext);
    bindClick("hint-btn", showHint);

    // 로드맵 핫스팟 바인딩
    bindRoadmapHotspots();

    // 처음엔 홈 화면 + 서버 상태 로딩
    showScreen("home");
    if (!isDevMode() && localStorage.getItem(DEV_TOUCHED_KEY) === "1") {
        await resetStageSilently();
        localStorage.removeItem(DEV_TOUCHED_KEY);
    }

    // 이제 정상 상태를 불러옴
    await fetchState();

    // DEV 패널 바인딩 (?dev=1일 때만)
    if (isDevMode()) {
        const panel = document.getElementById("dev-panel");
        if (panel) panel.style.display = "block";

        const toggle = () => {
            const p = document.getElementById("dev-panel");
            if (!p) return;
            p.style.display = (p.style.display === "none") ? "block" : "none";
        };

        bindClick("dev-toggle", toggle);
        bindClick("dev-fetch", async () => { await fetchState(); devLog("state refreshed"); });
        bindClick("dev-go-roadmap", goRoadmapDev);
        bindClick("dev-solve-one", autoSolveOne);
        bindClick("dev-solve-event", autoSolveEvent);
        bindClick("dev-solve-stage", autoSolveStage);
        bindClick("dev-reset-stage", async () => {
            await resetStageSilently();
            devLog("stage reset done");
        });


        // 핫키: Shift + D 로 토글
        window.addEventListener("keydown", (e) => {
            if (e.shiftKey && (e.key === "D" || e.key === "d")) toggle();
        });

        devLog("DEV MODE ON\n(Shift+D 토글)");
    }

});
