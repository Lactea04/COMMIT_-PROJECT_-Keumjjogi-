# app.py
from flask import Flask, render_template, jsonify, request

from game_logic import (
    init_stage_from_url,
    get_public_state,
    submit_answer,
    go_next_question,
    reset_stage,
    start_stage,   # 🔹 추가
)


app = Flask(__name__)


# ------------------------
#  서버 시작 시 기본 스테이지 로딩
# ------------------------
# 에러 나면 콘솔에만 찍고, /api/state 호출 시점에 터지도록 둘 수도 있음.
try:
    init_stage_from_url("stage1")
except Exception as e:
    print(f"[WARN] 초기 스테이지 로딩 실패: {e}")


# ------------------------
#  라우트
# ------------------------

@app.route("/")
def index():
    # templates/index.html
    return render_template("index.html")


@app.get("/api/state")
def api_state():
    """현재 게임 상태 조회"""
    data = get_public_state()
    return jsonify(data)


@app.post("/api/submit")
def api_submit():
    """정답 제출"""
    payload = request.get_json(force=True) or {}
    result = submit_answer(payload)
    return jsonify(result)


@app.post("/api/next")
def api_next():
    """다음 문제로 이동"""
    result = go_next_question()
    return jsonify(result)

@app.post("/api/start_stage")
def api_start_stage():
    """
    로드맵/홈 화면에서 특정 스테이지를 선택했을 때 호출되는 엔드포인트.
    body: { "stageId": "stage1" }
    """
    data = request.get_json(force=True) or {}
    stage_id = data.get("stageId") or "stage1"  # stageId 없으면 기본 stage1
    public = start_stage(stage_id)
    return jsonify(public)

@app.post("/api/reset")
def api_reset():
    """
    스테이지 리셋
    main.js에서 resetStageCore()가 호출하면,
    여기서 publicState 하나만 내려보내면 됨.
    """
    public_state = reset_stage()
    return jsonify(public_state)


if __name__ == "__main__":
    app.run(debug=True)
