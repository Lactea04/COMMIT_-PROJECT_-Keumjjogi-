"""
=================================================
BUILD NOTE – app.py
UPDATED: 2025-12-17-12:51 (KST)

[CHANGE SUMMARY]
- /api/start_stage 재호출 시 진행 초기화 방지

[DETAIL]
1) 동일 stageId로 start_stage 요청이 들어오면
   STATE를 재생성(load_stage)하지 않고 기존 STATE를 반환하도록 가드 추가

2) 기대 효과
   - 프론트가 실수로 start_stage를 재호출해도 진행 유지
   - 테마 화면 ↔ 로드맵 화면 이동 시 진행도 보존

=================================================
"""





from flask import Flask, jsonify, request, render_template
import requests

from game_logic import (
    load_stage,
    get_public_state,
    submit_answer,
    start_event,
    GameState
)

app = Flask(__name__)

# =========================
# Firebase Config
# =========================

FIREBASE_URL = "https://keumjjogi-problems-storage-default-rtdb.firebaseio.com/.json"

# =========================
# Global State
# =========================

GAME_DATA = None      # 전체 quiz_data.json
STATE: GameState | None = None


# =========================
# Data Loader
# =========================

def load_quiz_data():
    global GAME_DATA
    if GAME_DATA is None:
        res = requests.get(FIREBASE_URL)
        res.raise_for_status()
        GAME_DATA = res.json()
    return GAME_DATA


# =========================
# API Endpoints
# =========================

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/api/state")
def api_get_state():
    if STATE is None:
        return jsonify({"status": "NOT_STARTED"})
    return jsonify(get_public_state(STATE))


@app.post("/api/start_stage")
def api_start_stage():
    global STATE
    body = request.get_json()
    stage_id = body.get("stageId", "stage1")

    # ✅ 이미 같은 스테이지가 진행 중이면 리셋하지 말고 그대로 반환
    if STATE is not None and getattr(STATE.stage, "stage_id", None) == stage_id:
        return jsonify(get_public_state(STATE))

    data = load_quiz_data()
    STATE = load_stage(stage_id, data)
    return jsonify(get_public_state(STATE))



@app.post("/api/start_event")
def api_start_event():
    """
    로드맵에서 금융사(event) 클릭 시
    """
    if STATE is None:
        return jsonify({"error": "Stage not started"}), 400

    body = request.get_json()
    event_key = body.get("eventKey")

    try:
        start_event(STATE, event_key)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    return jsonify(get_public_state(STATE))


@app.post("/api/submit")
def api_submit_answer():
    """
    퀴즈 답안 제출
    """
    if STATE is None:
        return jsonify({"error": "Stage not started"}), 400

    body = request.get_json()
    selected = body.get("choiceIndex")

    result = submit_answer(STATE, selected)

    return jsonify({
        **result,
        "publicState": get_public_state(STATE)
    })


@app.post("/api/reset")
def api_reset():
    """
    현재 stage 리셋 → stage intro로 복귀
    """
    global STATE

    STATE = None
    return jsonify({"status": "RESET"})


# =========================
# App Run
# =========================

if __name__ == "__main__":
    app.run(debug=True)
