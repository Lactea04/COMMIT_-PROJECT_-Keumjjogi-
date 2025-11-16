let currentState = null;   // 서버에서 내려주는 publicState
let lastResult = null;     // 마지막 submit 결과

// ------------------------
//  화면 전환
// ------------------------
function showScreen(name) {
    document.querySelectorAll(".screen").forEach((el) => {
        el.classList.remove("active");
    });
    const target = document.getElementById(`${name}-screen`);
    if (target) target.classList.add("active");
}

// ------------------------
//  API helpers
// ------------------------
async function fetchState() {
    const res = await fetch("/api/state");
    currentState = await res.json();
    lastResult = null;
    renderAll();
}

async function submitAnswer() {
    if (!currentState) return;
    const q = currentState.question;

    let payload = {};
    if (q.type === "mcq") {
        const selected = document.querySelector("#options-container button.selected");
        if (!selected) {
            alert("보기를 하나 선택해 주세요.");
            return;
        }
        payload.choiceIndex = Number(selected.dataset.index);
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
    renderAll();
    renderFeedback(data);

    // 테마 문제까지 맞춰서 스테이지 클리어 시 → 요약 화면
    if (data.stageCleared) {
        renderSummary(data.publicState);
        showScreen("summary");
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
    renderAll();
}

// 🔹 조용히 스테이지만 리셋 (confirm 없음)
async function resetStageCore() {
    const res = await fetch("/api/reset", { method: "POST" });
    currentState = await res.json();
    lastResult = null;
    renderAll();
}

// 🔹 퀴즈 화면에서 “스테이지 리셋” 버튼 눌렀을 때 쓰는 리셋 (confirm 있음)
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

    // 상단 점수
    document.getElementById("score").textContent = currentState.score;

    // 스테이지 정보
    document.getElementById("stage-title").textContent = currentState.stageTitle;
    document.getElementById("stage-summary").textContent = currentState.summary;

    const phaseLabel = document.getElementById("phase-label");
    const progressLabel = document.getElementById("progress-label");
    const total = currentState.totalQuestions;
    const idx = currentState.currentIndex;
    const isTheme = currentState.isTheme;

    if (isTheme) {
        phaseLabel.textContent = "테마 문제";
        progressLabel.textContent = `테마 (총 ${total - 1}문제 + 테마 1개 중 마지막)`;
    } else {
        phaseLabel.textContent = "일반 문제";
        progressLabel.textContent = `문제 ${idx + 1} / ${total - 1}`;
    }

    // 문제
    const q = currentState.question;
    document.getElementById("question-text").textContent = q.text;

    const optionsContainer = document.getElementById("options-container");
    const shortInput = document.getElementById("short-answer");
    optionsContainer.innerHTML = "";
    shortInput.value = "";

    if (q.type === "mcq") {
        shortInput.style.display = "none";
        if (Array.isArray(q.options)) {
            q.options.forEach((opt, i) => {
                const btn = document.createElement("button");
                btn.textContent = opt;
                btn.dataset.index = String(i);
                btn.addEventListener("click", () => {
                    document
                        .querySelectorAll("#options-container button")
                        .forEach((b) => b.classList.remove("selected"));
                    btn.classList.add("selected");
                });
                optionsContainer.appendChild(btn);
            });
        }
    } else {
        optionsContainer.innerHTML = "";
        shortInput.style.display = "block";
    }

    // 단서
    const clueText = document.getElementById("clue-text");
    if (currentState.clues && currentState.clues.length > 0) {
        clueText.textContent = currentState.clues.join(" ");
    } else {
        clueText.textContent = "아직 획득한 단서가 없습니다.";
    }

    // 버튼 상태
    const nextBtn = document.getElementById("next-btn");
    if (lastResult && lastResult.correct && !lastResult.stageCleared) {
        nextBtn.disabled = false;
    } else {
        nextBtn.disabled = true;
    }

    // 피드백 초기화(새 문제로 넘어온 경우 등)
    if (!lastResult) {
        const fb = document.getElementById("feedback");
        fb.textContent = "";
        fb.className = "feedback";
    }
}

function renderFeedback(result) {
    const fb = document.getElementById("feedback");
    fb.textContent = result.feedback || "";
    fb.className = "feedback";
    if (result.correct) {
        fb.classList.add("correct");
    } else if (result.correct === false) {
        fb.classList.add("wrong");
    }
}

// ------------------------
//  요약 화면 렌더링
// ------------------------
function renderSummary(publicState) {
    document.getElementById("summary-stage-title").textContent =
        publicState.stageTitle || "스테이지 요약";
    document.getElementById("summary-text").textContent =
        publicState.summary || "";

    document.getElementById("final-score").textContent = publicState.score ?? 0;

    const clues = publicState.clues || [];
    const summaryClues = document.getElementById("summary-clues");
    if (clues.length > 0) {
        summaryClues.textContent = clues.join(" ");
    } else {
        summaryClues.textContent = "획득한 단서가 없습니다.";
    }
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
//  초기 바인딩
// ------------------------
window.addEventListener("DOMContentLoaded", () => {
    // 화면 전환 버튼
    document.getElementById("to-roadmap-btn")
        .addEventListener("click", () => showScreen("roadmap"));

    document.getElementById("back-home-btn")
        .addEventListener("click", () => showScreen("home"));

    // 🔹 스테이지 시작: 조용히 리셋 후 퀴즈 화면으로, confirm 없음
    document.getElementById("start-stage-btn")
        .addEventListener("click", async () => {
            await resetStageCore();
            showScreen("quiz");
        });

    // 🔹 퀴즈에서 로드맵으로 나갈 때: 여기에서만 “처음부터 다시 시작” 경고
    document.getElementById("back-roadmap-from-quiz")
        .addEventListener("click", async () => {
            const ok = confirm("로드맵으로 돌아갈까요? 돌아갈 시 스테이지 진행내역은 초기화되니 주의해주세요");
            if (!ok) return;
            await resetStageCore();
            showScreen("roadmap");
        });

    document.getElementById("summary-to-roadmap-btn")
        .addEventListener("click", () => showScreen("roadmap"));

    document.getElementById("summary-restart-btn")
        .addEventListener("click", async () => {
            await resetStageCore();
            showScreen("quiz");
        });

    // 퀴즈용 버튼
    document.getElementById("submit-btn").addEventListener("click", submitAnswer);
    document.getElementById("next-btn").addEventListener("click", goNext);
    document.getElementById("hint-btn").addEventListener("click", showHint);

    // 🔹 퀴즈 화면 안의 “스테이지 리셋” 버튼: confirm 있는 버전 사용
    document.getElementById("reset-btn").addEventListener("click", resetStageWithConfirm);

    // 처음엔 홈 화면 + 서버 상태 로딩
    showScreen("home");
    fetchState();
});
