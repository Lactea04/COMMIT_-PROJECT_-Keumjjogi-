from dataclasses import dataclass, field
from typing import List, Optional, Literal, Union

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

    def reset(self):
        self.current_index = 0
        self.score = 0
        self.clues = []
        self.has_cleared_current = False


# -----------------------------
#  스테이지 정의 (과일 예시)
# -----------------------------
def make_stage1() -> Stage:
    q: List[Question] = []

    q.append(Question(
        id="q1",
        type="mcq",
        question="다음 중 빨간색 과일은?",
        options=["바나나", "사과", "포도"],
        answer=1,
        hint="한국 사람들이 자주 먹는 과일이에요.",
        clue="A",
        explanation="세 과일 중 일반적으로 빨간색인 과일은 사과입니다."
    ))

    q.append(Question(
        id="q2",
        type="short",
        question="strawberry를 한국어로 하면 무엇인가요?",
        answer="딸기",
        hint="빨간색이고 케이크 위에 자주 올라갑니다.",
        clue="P",
        explanation="strawberry는 한국어로 '딸기'입니다."
    ))

    q.append(Question(
        id="q3",
        type="mcq",
        question="다음 중 껍질을 까서 먹는 과일은?",
        options=["포도", "수박", "귤"],
        answer=2,
        hint="겨울에 많이 먹는 과일입니다.",
        clue="P",
        explanation="여기서는 껍질을 벗겨 먹는 '귤'을 정답으로 봅니다."
    ))

    q.append(Question(
        id="q4",
        type="mcq",
        question="다음 중 과일이 아닌 것은?",
        options=["사과", "토마토", "감자"],
        answer=2,
        hint="땅속에서 자랍니다.",
        clue="L",
        explanation="'감자'는 과일이 아니라 뿌리채소입니다."
    ))

    q.append(Question(
        id="q5",
        type="short",
        question="banana를 한국어로 하면 무엇인가요?",
        answer="바나나",
        hint="노란색이고 길쭉한 과일입니다.",
        clue="E",
        explanation="banana는 한국어로 '바나나'입니다."
    ))

    q.append(Question(
        id="theme",
        type="short",
        question="지금까지 모은 단서를 조합하면 어떤 단어가 될까요? (대문자로 입력)",
        answer="APPLE",
        hint="빨갛고 둥근 과일입니다.",
        explanation="이번 스테이지의 테마는 APPLE이었습니다."
    ))

    return Stage(
        stage_id="stage1",
        title="과일 스테이지",
        summary="이번 스테이지의 테마는 과일이었습니다. 실제 버전에서는 금융 사건/역사 요약이 들어갈 예정입니다.",
        questions=q,
    )


# 전역 상태 (단일 사용자/개발용)
stage1 = make_stage1()
state = GameState(stage=stage1)


# -----------------------------
#  상태 조회 / 갱신 함수
# -----------------------------
def get_public_state():
    """현재 상태를 프론트에 내려줄 JSON 직렬화용 dict."""
    q = state.stage.questions[state.current_index]
    total = len(state.stage.questions)
    theme_index = total - 1
    is_theme = state.current_index == theme_index

    return {
        "stageTitle": state.stage.title,
        "summary": state.stage.summary,
        "score": state.score,
        "currentIndex": state.current_index,
        "totalQuestions": total,
        "isTheme": is_theme,
        "clues": state.clues,
        "question": {
            "id": q.id,
            "type": q.type,
            "text": q.question,
            "options": q.options,
            "hasHint": bool(q.hint),
            "hint": q.hint,  # 프론트에서 힌트 버튼 눌렀을 때 사용
        },
    }


def submit_answer(payload: dict):
    """
    정답 제출 처리.
    mcq: { "choiceIndex": int }
    short: { "answer": "문자열" }
    """
    q = state.stage.questions[state.current_index]
    total = len(state.stage.questions)
    theme_index = total - 1
    is_theme = state.current_index == theme_index

    if state.has_cleared_current:
        # 이미 맞춘 문제면 아무 것도 안 함
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
        base_score = 20 if q.type == "mcq" else 30
        state.score += base_score
        state.has_cleared_current = True

        feedback_lines.append("✅ 정답입니다!")
        if q.explanation:
            feedback_lines.append(f"해설: {q.explanation}")

        if (not is_theme) and q.clue:
            state.clues.append(q.clue)
            gained_clue = q.clue
            feedback_lines.append(f"단서 획득: {q.clue}")
    else:
        # 오답 시 -2점 (최소 0점)
        state.score = max(0, state.score - 2)
        feedback_lines.append("❌ 오답입니다. 힌트를 참고해 다시 도전해 보세요.")

    stage_cleared = bool(correct and is_theme)

    return {
        "correct": correct,
        "feedback": "\n".join(feedback_lines),
        "score": state.score,
        "gainedClue": gained_clue,
        "isTheme": is_theme,
        "stageCleared": stage_cleared,
        "publicState": get_public_state(),
    }


def go_next_question():
    """현재 문제가 맞춰진 상태일 때 다음 문제로 이동."""
    total = len(state.stage.questions)
    theme_index = total - 1
    is_theme = state.current_index == theme_index

    if not state.has_cleared_current:
        return {
            "error": "not_cleared",
            "message": "정답을 맞춘 후에만 다음 문제로 이동할 수 있습니다.",
            "publicState": get_public_state(),
        }

    if not is_theme:
        state.current_index += 1
        state.has_cleared_current = False
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


def reset_stage():
    """스테이지 전체 리셋."""
    state.reset()
    return get_public_state()
