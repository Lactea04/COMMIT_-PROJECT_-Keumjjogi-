# game_logic.py
# 금쪽이 웹 게임의 핵심 게임 로직을 담당하는 모듈
# Firebase Realtime Database에서 문제 데이터를 가져와 게임 상태를 관리합니다.

from dataclasses import dataclass, field
from typing import List, Optional, Literal, Union, Dict, Any
import requests

# ------------------------
#  설정: Firebase Realtime DB URL
# ------------------------
FIREBASE_DB_URL = "https://keumjjogi-problems-storage-default-rtdb.firebaseio.com/"

# 문제 유형 (객관식/주관식)
QuestionType = Literal["mcq", "short"]


# ------------------------
#  데이터 클래스 정의
# ------------------------

@dataclass
class Question:
    """
    개별 문제를 나타내는 데이터 클래스

    속성:
        id: 문제의 고유 식별자
        type: 문제 유형 ("mcq" 또는 "short")
        question: 문제 텍스트
        options: 객관식일 경우 선택지 리스트
        answer: 정답 (객관식: 정답 인덱스(1-base), 주관식: 문자열)
        hint: 힌트 텍스트
        explanation: 문제 해설
        image_url: 이미지 URL
    """
    id: str
    type: QuestionType
    question: str
    options: Optional[List[str]] = None
    answer: Union[int, str] = ""
    hint: Optional[str] = None
    explanation: Optional[str] = None
    image_url: str | None = None


@dataclass
class Stage:
    """
    스테이지(게임 단계)를 나타내는 데이터 클래스

    속성:
        stage_id: 스테이지 고유 식별자
        title: 스테이지 제목
        summary: 스테이지 요약 설명
        questions: 스테이지에 포함된 문제들의 리스트 (사건 10개 × 5문제 = 50문제 형태로 flatten)
        question_meta: 각 문제의 사건 메타데이터 (eventKey/eventTitle/eventIndex/eventTotal)
    """
    stage_id: str
    title: str
    summary: str
    questions: List[Question] = field(default_factory=list)
    question_meta: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class GameState:
    """
    현재 게임 진행 상태를 관리하는 데이터 클래스

    속성:
        stage: 현재 진행 중인 스테이지
        current_index: 현재 문제 인덱스 (0부터 시작)
        score: 현재 점수
        has_cleared_current: 현재 문제를 이미 클리어했는지 여부
    """
    stage: Stage
    current_index: int = 0
    score: int = 0
    has_cleared_current: bool = False

    def reset_local(self):
        """같은 Stage에서 인덱스/점수만 리셋."""
        self.current_index = 0
        self.score = 0
        self.has_cleared_current = False


# ------------------------
#  전역 상태
# ------------------------
state: Optional[GameState] = None
DEFAULT_STAGE_ID = "stage1"


# ------------------------
#  내부 유틸
# ------------------------

def _require_state() -> GameState:
    if state is None:
        raise RuntimeError("GameState가 초기화되지 않았습니다. init_stage_from_url()을 먼저 호출하세요.")
    return state


def _normalize_questions_list(questions_data):
    """Firebase에서 questions가 dict로 올 수도 있어 리스트로 정규화."""
    if isinstance(questions_data, dict):
        return list(questions_data.values())
    return questions_data or []


def _extract_event_blocks(stage_json: dict):
    """
    새 JSON 구조에서 사건 블록들을 추출.
    stage1 안에서 (title, summary) 제외하고, dict이며 questions 키가 있는 것들을 사건으로 간주.
    """
    event_blocks = []
    for k, v in stage_json.items():
        if k in ("title", "summary"):
            continue
        if isinstance(v, dict) and "questions" in v:
            event_blocks.append((k, v))
    # (권장) 사건 순서를 고정하고 싶으면 각 블록에 order를 넣고 정렬
    event_blocks.sort(key=lambda kv: kv[1].get("order", 0))
    return event_blocks


# ------------------------
#  Stage 로딩
# ------------------------

def load_stage_from_url(stage_id: str) -> Stage:
    """
    Firebase Realtime Database에서 특정 스테이지(stage_id)의 데이터를 가져오는 함수.

    새 구조:
      stages/{stage_id}.json =
        {
          "title": "...",
          "summary": "...",
          "<event_key_1>": { "title": "...", "questions": [ ... ] },
          ...
          "<event_key_10>": { "title": "...", "questions": [ ... ] }
        }
    """
    if (not FIREBASE_DB_URL) or ("YOUR_PROJECT_ID" in FIREBASE_DB_URL):
        raise RuntimeError(
            "FIREBASE_DB_URL이 설정되지 않았습니다. "
            "game_logic.py 상단의 FIREBASE_DB_URL 값을 실제 Realtime DB URL로 바꿔주세요."
        )

    base = FIREBASE_DB_URL.rstrip("/")
    url = f"{base}/stages/{stage_id}.json"

    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    s = resp.json()

    if s is None:
        raise ValueError(f"stage '{stage_id}' 데이터를 찾을 수 없습니다. URL: {url}")

    title = s.get("title", stage_id)
    summary = s.get("summary", "")

    # ✅ 새 구조: 사건 블록들에서 questions를 모두 수집해 flatten
    event_blocks = _extract_event_blocks(s)

    raw_questions: List[dict] = []
    question_meta: List[Dict[str, Any]] = []

    for event_key, block in event_blocks:
        event_title = block.get("title", event_key)
        qlist = _normalize_questions_list(block.get("questions", []))
        qlist = sorted(qlist, key=lambda qd: qd.get("order", 0))

        for i, qd in enumerate(qlist):
            raw_questions.append(qd)
            question_meta.append({
                "eventKey": event_key,
                "eventTitle": event_title,
                "eventIndex": i,          # 0~4
                "eventTotal": len(qlist)  # 보통 5
            })

    # 문제 데이터를 Question 객체로 변환
    questions: List[Question] = []
    for qd in raw_questions:
        questions.append(
            Question(
                id=qd.get("id", ""),
                type=qd.get("type", "mcq"),
                question=qd.get("question", ""),
                options=qd.get("options"),
                answer=qd.get("answer", ""),
                hint=qd.get("hint"),
                explanation=qd.get("explanation"),
                image_url=qd.get("imageUrl"),
            )
        )

    return Stage(
        stage_id=stage_id,
        title=title,
        summary=summary,
        questions=questions,
        question_meta=question_meta,
    )


def init_stage_from_url(stage_id: str = DEFAULT_STAGE_ID):
    global state
    stage = load_stage_from_url(stage_id)
    state = GameState(stage=stage)


# ------------------------
#  외부로 노출되는 API (Flask에서 사용)
# ------------------------

def get_public_state():
    """
    프론트엔드(main.js)가 사용하는 상태 스냅샷을 반환.
    (정답 등 민감한 정보 제외)
    """
    s = _require_state()
    q = s.stage.questions[s.current_index]
    total = len(s.stage.questions)

    meta = None
    if s.stage.question_meta and 0 <= s.current_index < len(s.stage.question_meta):
        meta = s.stage.question_meta[s.current_index]

    return {
        "stageTitle": s.stage.title,
        "summary": s.stage.summary,
        "score": s.score,
        "currentIndex": s.current_index,
        "totalQuestions": total,

        # ✅ 사건(금융사/사건) 정보: 화면에 "1929년 대공황 (2/5)" 같은 걸 띄우기 좋음
        "event": meta,  # {eventKey, eventTitle, eventIndex, eventTotal}

        "question": {
            "id": q.id,
            "type": q.type,
            "text": q.question,
            "options": q.options,
            "hasHint": bool(q.hint),
            "hint": q.hint,
            "imageUrl": q.image_url,
        },
    }


def submit_answer(payload: dict):
    """
    정답 제출 처리.
    - mcq: {"choiceIndex": int}  (0-base)
    - short: {"answer": "문자열"}
    """
    s = _require_state()
    q = s.stage.questions[s.current_index]
    total = len(s.stage.questions)

    # 이미 맞춘 문제면 중복 제출 방지
    if s.has_cleared_current:
        return {
            "alreadyCleared": True,
            "publicState": get_public_state(),
        }

    correct = False
    user_answer = None

    if q.type == "mcq":
        idx = payload.get("choiceIndex")
        if isinstance(idx, int):
            user_answer = idx
            # JSON answer는 1부터 시작(1-base)이라고 가정
            correct = (idx + 1 == q.answer)
    else:
        ans = payload.get("answer")
        if isinstance(ans, str):
            user_answer = ans.strip()
            correct = (user_answer == str(q.answer).strip())

    if user_answer is None:
        return {
            "error": "no_answer",
            "message": "정답을 입력해 주세요.",
            "publicState": get_public_state(),
        }

    feedback_lines: List[str] = []

    if correct:
        base_score = 20 if q.type == "mcq" else 30
        s.score += base_score
        s.has_cleared_current = True

        feedback_lines.append("✅ 정답입니다!")
        if q.explanation:
            feedback_lines.append(f"해설: {q.explanation}")
    else:
        s.score = max(0, s.score - 2)
        feedback_lines.append("❌ 오답입니다. 힌트를 참고해 다시 도전해 보세요.")

    # ✅ 마지막 문제를 정답으로 맞추면 스테이지 클리어
    is_last = (s.current_index == total - 1)
    stage_cleared = bool(correct and is_last)

    # 정답 보기 인덱스(객관식)
    correct_choice_index = None
    if q.type == "mcq" and isinstance(q.answer, int):
        correct_choice_index = int(q.answer) - 1  # 0-base로 보정

    return {
        "correct": correct,
        "feedback": "\n".join(feedback_lines),
        "score": s.score,
        "stageCleared": stage_cleared,
        "publicState": get_public_state(),
        "correctChoiceIndex": correct_choice_index,
    }


def go_next_question():
    """
    다음 문제로 이동.
    현재 문제를 클리어한 경우에만 이동 가능.
    """
    s = _require_state()
    total = len(s.stage.questions)
    is_last = (s.current_index == total - 1)

    if not s.has_cleared_current:
        return {
            "error": "not_cleared",
            "message": "정답을 맞춘 후에만 다음 문제로 이동할 수 있습니다.",
            "publicState": get_public_state(),
        }

    if not is_last:
        s.current_index += 1
        s.has_cleared_current = False
        return {
            "moved": True,
            "publicState": get_public_state(),
        }

    return {
        "moved": False,
        "publicState": get_public_state(),
    }


def start_stage(stage_id: str):
    """
    선택한 스테이지를 다시 읽어 GameState를 초기화.
    """
    global state
    stage = load_stage_from_url(stage_id)
    state = GameState(stage=stage)
    return get_public_state()


def reset_stage():
    """
    현재 스테이지를 전체 리셋.
    """
    global state
    s = _require_state()
    new_stage = load_stage_from_url(s.stage.stage_id)
    state = GameState(stage=new_stage)
    return get_public_state()
