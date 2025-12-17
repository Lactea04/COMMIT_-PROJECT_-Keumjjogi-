"""
=================================================
BUILD: 2025-12-16 KST (SUMMARY VIEW UX COMPATIBILITY)
FILE: game_logic.py

CHANGE SUMMARY:
- 이번 빌드에서 엔진 로직 변경 없음

COMPATIBILITY NOTE:
- eventCleared / stageCleared 플래그와
  eventOutro / stageOutro payload 구조는 그대로 유지됨.
- 요약 화면 진입 시점을 프론트엔드(main.js)에서
  명시적 사용자 액션("요약 보기")으로 제어하도록 변경됨.

INTENT:
- 게임 엔진은 상태 판정과 데이터 제공에만 집중하고,
  화면 전환 타이밍은 프론트엔드 UX 정책에 위임
=================================================
"""






from dataclasses import dataclass, field
from typing import Dict, List, Optional



# =========================
# Data Models
# =========================

@dataclass
class Question:
    id: str
    order: int
    type: str
    question: str
    options: list
    answer: int
    hint: str
    imageUrl: str
    explanation: str


@dataclass
class Stage:
    stage_id: str
    title: str
    summary: str
    questions: List[Question]

    intro: Optional[dict] = None          # stage-level intro
    outro: Optional[dict] = None          # stage-level outro
    events: Optional[Dict[str, dict]] = None  # roadmap용 event meta


@dataclass
class GameState:
    stage: Stage
    current_index: int = 0
    score: int = 0

    question_meta: List[dict] = field(default_factory=list)

    cleared_events: set[str] = field(default_factory=set)
    current_event_key: Optional[str] = None


# =========================
# Stage Loader
# =========================



def load_stage(stage_id: str, data: dict) -> GameState:
    stage_data = data["stages"][stage_id]

    title = stage_data.get("title", stage_id)
    summary = stage_data.get("summary", "")
    stage_intro = stage_data.get("intro")
    stage_outro = stage_data.get("outro")

    raw_questions: List[Question] = []
    question_meta: List[dict] = []
    events_meta: Dict[str, dict] = {}

    for event_key, block in stage_data.items():
        if not isinstance(block, dict):
            continue
        if "questions" not in block:
            continue

        start_index = len(raw_questions)
        qlist = block.get("questions", [])
        total = len(qlist)

        for i, q in enumerate(qlist):
            question = Question(**q)
            raw_questions.append(question)
            question_meta.append({
                "eventKey": event_key,
                "eventTitle": block.get("title"),
                "eventIndex": i,
                "eventTotal": total
            })

        events_meta[event_key] = {
            "key": event_key,
            "title": block.get("title"),
            "intro": block.get("intro"),
            "outro": block.get("outro"),
            "startIndex": start_index,
            "totalQuestions": total
        }

    stage = Stage(
        stage_id=stage_id,
        title=title,
        summary=summary,
        questions=raw_questions,
        intro=stage_intro,
        outro=stage_outro,
        events=events_meta
    )

    return GameState(stage=stage, question_meta=question_meta)


# =========================
# Game Flow Helpers
# =========================

def get_current_question(state: GameState) -> Optional[Question]:
    if state.current_index >= len(state.stage.questions):
        return None
    return state.stage.questions[state.current_index]


def get_current_meta(state: GameState) -> Optional[dict]:
    if state.current_index >= len(state.question_meta):
        return None
    return state.question_meta[state.current_index]


def start_event(state: GameState, event_key: str):
    event = state.stage.events.get(event_key)
    if not event:
        raise ValueError("Invalid event key")

    state.current_event_key = event_key
    state.current_index = event["startIndex"]


def submit_answer(state: GameState, selected: int) -> dict:
    question = get_current_question(state)
    meta = get_current_meta(state)

    if not question or not meta:
        return {"error": "No active question"}

    correct = (selected + 1 == question.answer)

    event_cleared = False
    stage_cleared = False

    if correct:
        state.score += 1
        state.current_index += 1

        # 사건 종료 판단
        if meta["eventIndex"] == meta["eventTotal"] - 1:
            event_cleared = True
            state.cleared_events.add(meta["eventKey"])
            state.current_event_key = None

            # 스테이지 종료 판단
            if len(state.cleared_events) >= len(state.stage.events):
                stage_cleared = True

    return {
        "correct": correct,

        # 🔹 프론트용 정답 인덱스 (0-based로 내려줌)
        "correctChoiceIndex": question.answer - 1,

        "eventCleared": event_cleared,
        "eventOutro": (
            state.stage.events[meta["eventKey"]]["outro"]
            if event_cleared else None
        ),
        "stageCleared": stage_cleared,
        "stageOutro": state.stage.outro if stage_cleared else None,
        "score": state.score
    }


def get_public_state(state: GameState) -> dict:
    meta = get_current_meta(state)
    question = get_current_question(state)

    return {
        "stageTitle": state.stage.title,
        "summary": state.stage.summary,  # 🔹 프론트와 키 통일

        "currentIndex": state.current_index,
        "totalQuestions": len(state.stage.questions),
        "score": state.score,
        "stageIntro": state.stage.intro,
        "stageOutro": state.stage.outro,

        "events": [
            {
                "key": ev["key"],
                "title": ev.get("title"),
                "cleared": (ev["key"] in state.cleared_events),
            }
            for _, ev in sorted(
                state.stage.events.items(),
                key=lambda item: item[1].get("startIndex", 0)
            )
        ],

        # 🔹 현재 사건 정보 (상단 pill용)
        "currentEvent": {
            "eventKey": meta["eventKey"],
            "title": meta["eventTitle"],
            "eventIndex": meta["eventIndex"],
            "eventTotal": meta["eventTotal"],
            "intro": state.stage.events[meta["eventKey"]].get("intro"),
            "outro": state.stage.events[meta["eventKey"]].get("outro"),
        } if meta else None,

        "question": {
            "id": question.id,
            "type": question.type,
            "text": question.question,
            "options": question.options,
            "imageUrl": question.imageUrl,
            "hasHint": bool(question.hint),
            "hint": question.hint,
            "explanation": question.explanation,  # ✅ 추가
        } if question else None

    }

