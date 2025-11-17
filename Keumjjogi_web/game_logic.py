# game_logic.py
from dataclasses import dataclass, field
from typing import List, Optional, Literal, Union
import requests

# ------------------------
#  설정: Firebase Realtime DB URL
# ------------------------
FIREBASE_DB_URL = "https://keumjjogi-problems-storage-default-rtdb.firebaseio.com/"

QuestionType = Literal["mcq", "short"]  # 객관식 / 주관식


@dataclass
class Question:
    id: str
    type: QuestionType
    question: str
    options: Optional[List[str]] = None  # mcq일 때만 사용
    answer: Union[int, str] = ""         # mcq: 정답 인덱스 / short: 문자열
    hint: Optional[str] = None
    clue: Optional[str] = None           # 테마 문제용 단서
    explanation: Optional[str] = None    # 해설


@dataclass
class Stage:
    stage_id: str
    title: str
    summary: str
    questions: List[Question] = field(default_factory=list)


@dataclass
class GameState:
    stage: Stage
    current_index: int = 0
    score: int = 0
    clues: List[str] = field(default_factory=list)
    has_cleared_current: bool = False

    def reset_local(self):
        """같은 Stage에서 인덱스/점수/단서만 리셋 (Stage 구조는 그대로)."""
        self.current_index = 0
        self.score = 0
        self.clues = []
        self.has_cleared_current = False


# ------------------------
#  전역 상태
# ------------------------

state: Optional[GameState] = None
DEFAULT_STAGE_ID = "stage1"


# ------------------------
#  유틸 함수
# ------------------------

def _require_state() -> GameState:
    if state is None:
        raise RuntimeError("GameState가 초기화되지 않았습니다. init_stage_from_url()을 먼저 호출하세요.")
    return state


def load_stage_from_url(stage_id: str) -> Stage:
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
    questions_data = s.get("questions", [])

    # 🔹 여기만 수정
    if isinstance(questions_data, dict):
        questions_data = list(questions_data.values())
    questions_data = sorted(questions_data, key=lambda qd: qd.get("order", 0))

    questions: List[Question] = []
    for qd in questions_data:
        questions.append(
            Question(
                id=qd.get("id", ""),
                type=qd.get("type", "mcq"),
                question=qd.get("question", ""),
                options=qd.get("options"),
                answer=qd.get("answer", ""),
                hint=qd.get("hint"),
                clue=qd.get("clue"),
                explanation=qd.get("explanation"),
            )
        )

    return Stage(
        stage_id=stage_id,
        title=title,
        summary=summary,
        questions=questions,
    )



def init_stage_from_url(stage_id: str = DEFAULT_STAGE_ID):
    """
    서버 시작 시 한 번 호출해서
    URL에서 stage 데이터를 읽고 GameState를 초기화한다.
    """
    global state
    stage = load_stage_from_url(stage_id)
    state = GameState(stage=stage)


# ------------------------
#  외부로 노출되는 API (Flask에서 사용)
# ------------------------

def get_public_state():
    """
    프론트엔드(main.js)가 사용하는 상태 스냅샷.
    """
    s = _require_state()
    q = s.stage.questions[s.current_index]
    total = len(s.stage.questions)
    theme_index = total - 1
    is_theme = s.current_index == theme_index

    return {
        "stageTitle": s.stage.title,
        "summary": s.stage.summary,
        "score": s.score,
        "currentIndex": s.current_index,
        "totalQuestions": total,
        "isTheme": is_theme,
        "clues": s.clues,
        "question": {
            "id": q.id,
            "type": q.type,
            "text": q.question,
            "options": q.options,
            "hasHint": bool(q.hint),
            "hint": q.hint,
        },
    }


def submit_answer(payload: dict):
    """
    정답 제출 처리.
    mcq: { "choiceIndex": int }
    short: { "answer": "문자열" }
    """
    s = _require_state()
    q = s.stage.questions[s.current_index]
    total = len(s.stage.questions)
    theme_index = total - 1
    is_theme = s.current_index == theme_index

    # 이미 맞춘 문제면 아무 것도 안 함
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
            correct = (idx == q.answer)
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
    gained_clue = None

    if correct:
        # 점수 규칙: mcq 20점, short 30점
        base_score = 20 if q.type == "mcq" else 30
        s.score += base_score
        s.has_cleared_current = True

        feedback_lines.append("✅ 정답입니다!")
        if q.explanation:
            feedback_lines.append(f"해설: {q.explanation}")

        # 테마 문제가 아니고, clue가 있으면 단서 지급
        if (not is_theme) and q.clue:
            s.clues.append(q.clue)
            gained_clue = q.clue
            feedback_lines.append(f"단서 획득: {q.clue}")
    else:
        # 오답 시 -2점 (최소 0)
        s.score = max(0, s.score - 2)
        feedback_lines.append("❌ 오답입니다. 힌트를 참고해 다시 도전해 보세요.")

    stage_cleared = bool(correct and is_theme)

    return {
        "correct": correct,
        "feedback": "\n".join(feedback_lines),
        "score": s.score,
        "gainedClue": gained_clue,
        "isTheme": is_theme,
        "stageCleared": stage_cleared,
        "publicState": get_public_state(),
    }


def go_next_question():
    """다음 문제로 이동."""
    s = _require_state()
    total = len(s.stage.questions)
    theme_index = total - 1
    is_theme = s.current_index == theme_index

    if not s.has_cleared_current:
        return {
            "error": "not_cleared",
            "message": "정답을 맞춘 후에만 다음 문제로 이동할 수 있습니다.",
            "publicState": get_public_state(),
        }

    if not is_theme:
        s.current_index += 1
        s.has_cleared_current = False
        return {
            "moved": True,
            "publicState": get_public_state(),
        }
    else:
        # 테마 문제 이후엔 더 이동할 문제가 없음
        return {
            "moved": False,
            "publicState": get_public_state(),
        }

def start_stage(stage_id: str):
    """
    선택한 스테이지를 URL에서 다시 읽어와 GameState를 초기화한다.
    로드맵 화면에서 스테이지 버튼을 눌렀을 때 사용.
    """
    global state
    stage = load_stage_from_url(stage_id)
    state = GameState(stage=stage)
    return get_public_state()


def reset_stage():
    """
    스테이지 전체 리셋.
    - URL에서 다시 읽어오면, DB의 변경 사항이 리셋 시점에 반영됨.
    """
    global state
    s = _require_state()
    # 현재 stage_id 기준으로 다시 로딩
    new_stage = load_stage_from_url(s.stage.stage_id)
    state = GameState(stage=new_stage)
    return get_public_state()
