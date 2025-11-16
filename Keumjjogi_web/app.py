from flask import Flask, render_template, jsonify, request
from game_logic import get_public_state, submit_answer, go_next_question, reset_stage

app = Flask(__name__)


@app.route("/")
def index():
    # templates/index.html 렌더링
    return render_template("index.html")


@app.get("/api/state")
def api_state():
    """현재 게임 상태 조회"""
    return jsonify(get_public_state())


@app.post("/api/submit")
def api_submit():
    """정답 제출"""
    data = request.get_json(force=True) or {}
    result = submit_answer(data)
    return jsonify(result)


@app.post("/api/next")
def api_next():
    """다음 문제로 이동"""
    result = go_next_question()
    return jsonify(result)


@app.post("/api/reset")
def api_reset():
    """스테이지 리셋"""
    public = reset_stage()
    return jsonify(public)


if __name__ == "__main__":
    app.run(debug=True)
