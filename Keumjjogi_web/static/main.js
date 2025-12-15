// main.js
let currentState = null;
let lastResult = null;
let lastSelectedIndex = null;   // 마지막에 내가 고른 보기 인덱스
let isRetryMode = false;        // 🔹 오답 후 재시도 모드인지 여부

// ========================
// 로드맵: 사건(10개) 정의
// ========================
const EVENTS = [
    { key: "the_great_depression_1929", title: "1929 대공황" },
    { key: "bretton_woods_1944", title: "1944 브레튼우즈 체제" },
    { key: "nixon_shock_1971", title: "1971 닉슨 쇼크" },
    { key: "japan_bubble_burst", title: "일본 버블 붕괴" },
    { key: "black_monday_1987", title: "1987 블랙 먼데이" },
    { key: "asian_financial_crisis_1997", title: "1997 아시아 외환위기" },
    { key: "dotcom_bubble_2000", title: "2000 닷컴 버블" },
    { key: "global_financial_crisis_2008", title: "2008 글로벌 금융위기" },
    { key: "eurozone_debt_crisis_2010_2012", title: "유럽 재정위기" },
    { key: "covid_liquidity_rally_2020", title: "2020 코로나 유동성 랠리" },
];

function getEventStatus(eventIdx, currentIndex) {
    const start = eventIdx * 5;
    const end = start + 5;

    if (currentIndex >= end) return "completed";
    if (currentIndex >= start) return "active";
    return "locked";
}

function getEventProgress(eventIdx, currentIndex) {
    const start = eventIdx * 5;
    const inEvent = currentIndex - start; // 0~4면 해당 사건 진행중
    return Math.max(0, Math.min(5, inEvent + 1)); // 표시용 1~5 느낌
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

    const idx = Number(currentState.currentIndex ?? 0);

    container.innerHTML = "";
    EVENTS.forEach((ev, i) => {
        const status = getEventStatus(i, idx);

        // 진행도 표시(사건당 5문제)
        const prog = status === "locked" ? 0 : Math.min(5, Math.max(0, idx - i * 5) + 1);

        const card = document.createElement("div");
        card.className = `event-card ${status}`;

        const statusLabel =
            status === "locked" ? "잠김" : status === "active" ? "진행중" : "완료";

        card.innerHTML = `
      <div class="event-title">${ev.title}</div>
      <div class="event-meta">
        <span class="event-pill">${statusLabel}</span>
        <span class="event-pill">${prog} / 5</span>
      </div>
    `;

        // ✅ 지금 단계에서는 "잠김"이 아닌 카드 클릭 시 안내만
        // (원하면 다음 단계에서 "해당 사건부터 시작" 기능으로 확장)
        if (status !== "locked") {
            card.addEventListener("click", () => {
                alert(`${ev.title} 구간이야!\n(다음 단계에서: 이 사건부터 시작 기능도 붙일 수 있어)`);
            });
        }

        container.appendChild(card);
    });
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


// ------------------------
//  API helpers
// ------------------------
async function fetchState() {
    const res = await fetch("/api/state");
    currentState = await res.json();
    lastResult = null;
    renderAll();
    renderEventRoadmap(); // ✅ state가 바뀌면 로드맵도 최신화

}

async function submitAnswer() {
    if (!currentState) return;

    const submitBtn = document.getElementById("submit-btn");

    // 🔁 재시도 모드인 경우: 서버에 다시 보내지 않고 화면만 초기화
    if (isRetryMode) {
        lastResult = null;
        lastSelectedIndex = null;
        isRetryMode = false;

        if (submitBtn) submitBtn.textContent = "정답 제출";

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    const data = await res.json();
    lastResult = data;
    currentState = data.publicState;

    // ✅ 정답/오답 여부에 따라 재시도 모드 설정
    if (data.correct === false) {
        isRetryMode = true;  // 틀렸으면 다음 클릭은 '재시도'
    } else {
        isRetryMode = false; // 맞추면 원래 모드로
    }

    renderAll();
    renderFeedback(data);

    // 마지막 문제까지 맞춰서 스테이지 클리어 시 → 요약 화면
    if (data.stageCleared) {
        renderSummary(data.publicState);
        showScreen("summary");
    }
}

// 🔹 특정 스테이지를 선택해서 시작
async function startStage(stageId) {
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
        showScreen("quiz");
    } catch (err) {
        console.error("startStage 에러:", err);
        alert("스테이지를 시작하는 중 오류가 발생했어요. (클라이언트)");
    }
}

async function goNext() {
    const res = await fetch("/api/next", { method: "POST" });
    const data = await res.json();

    if (data.error === "not_cleared") {
        alert(data.message);
        return;
    }

    currentState = data.publicState;
    lastResult = null;
    lastSelectedIndex = null;
    isRetryMode = false;
    renderAll();
}

// 🔹 조용히 스테이지만 리셋 (confirm 없음)
async function resetStageCore() {
    const res = await fetch("/api/reset", { method: "POST" });
    currentState = await res.json();
    lastResult = null;
    lastSelectedIndex = null;
    isRetryMode = false;
    renderAll();
}

// 🔹 퀴즈 화면에서 “스테이지 리셋” 버튼 눌렀을 때 (confirm 있음)
async function resetStageWithConfirm() {
    const ok = confirm("스테이지를 처음부터 다시 시작할까요?");
    if (!ok) return;
    await resetStageCore();
    showScreen("quiz");
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
        if (s.event && s.event.eventTitle) {
            const idx = (s.event.eventIndex ?? 0) + 1;
            const total = s.event.eventTotal ?? 0;
            phaseLabelEl.textContent = `${s.event.eventTitle} (${idx}/${total})`;
        } else {
            phaseLabelEl.textContent = "문제";
        }
    }

    // 전체 진행도 (1/50 같은)
    if (progressLabelEl) {
        progressLabelEl.textContent = `문제 ${(s.currentIndex ?? 0) + 1} / ${s.totalQuestions ?? 0}`;
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
    if (questionTextEl) questionTextEl.textContent = q.text || "";

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
        submitBtn.disabled = answeredCorrect;

        // 🔁 오답 상태이면 라벨을 '재시도'로, 그 외에는 '정답 제출'로
        if (lastResult && lastResult.correct === false) {
            submitBtn.textContent = "재시도";
        } else {
            submitBtn.textContent = "정답 제출";
        }
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

    fb.textContent = result.feedback || "";
    fb.className = "feedback";
    if (result.correct) {
        fb.classList.add("correct");
    } else if (result.correct === false) {
        fb.classList.add("wrong");
    }
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
window.addEventListener("DOMContentLoaded", () => {
    // 화면 전환 버튼
    bindClick("to-theme-btn", () => showScreen("theme"));
    bindClick("back-home-from-theme", () => showScreen("home"));
    bindClick("theme-global-btn", () => showScreen("roadmap"));
    bindClick("back-theme-btn", () => showScreen("theme"));

    // (혹시 남아 있을 수 있는 시작 버튼 대응)
    const startStageBtn = document.getElementById("start-stage-btn");
    if (startStageBtn) {
        startStageBtn.addEventListener("click", async (e) => {
            const stageId = e.currentTarget.dataset.stageId || "stage1";
            await startStage(stageId);
        });
    }

    // 🔹 퀴즈에서 로드맵으로 나갈 때: 여기에서만 “처음부터 다시 시작” 경고
    bindClick("back-roadmap-from-quiz", async () => {
        const ok = confirm("로드맵으로 돌아갈까요? 돌아갈 시 스테이지 진행내역은 초기화되니 주의해주세요");
        if (!ok) return;
        await resetStageCore();
        showScreen("roadmap");
    });

    // 요약 화면 버튼들
    bindClick("summary-to-roadmap-btn", () => showScreen("roadmap"));
    bindClick("summary-restart-btn", async () => {
        await resetStageCore();
        showScreen("quiz");
    });

    // 퀴즈용 버튼
    bindClick("submit-btn", submitAnswer);
    bindClick("next-btn", goNext);
    bindClick("hint-btn", showHint);
    bindClick("reset-btn", resetStageWithConfirm);

    // 로드맵 핫스팟 바인딩
    bindRoadmapHotspots();

    // 처음엔 홈 화면 + 서버 상태 로딩
    showScreen("home");
    fetchState();
});
