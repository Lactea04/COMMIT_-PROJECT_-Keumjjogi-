# ============================================
#  app.py - Flask 웹 서버 메인 파일
# ============================================
# 금쪽이 게임의 Flask 웹 서버를 구성하는 메인 파일입니다.
# 게임 로직(game_logic.py)과 프론트엔드(index.html)를 연결하는 API 엔드포인트를 제공합니다.

from flask import Flask, render_template, jsonify, request

# game_logic.py에서 필요한 함수들을 import
from game_logic import (
    init_stage_from_url,   # 스테이지 초기화 함수
    get_public_state,      # 현재 게임 상태 조회
    submit_answer,         # 정답 제출 처리
    go_next_question,      # 다음 문제로 이동
    reset_stage,           # 스테이지 리셋
    start_stage,           # 특정 스테이지 시작
)


# Flask 애플리케이션 인스턴스 생성
app = Flask(__name__)


# ============================================
#  서버 시작 시 기본 스테이지 로딩
# ============================================
# 서버가 시작될 때 기본 스테이지(stage1)를 자동으로 로드합니다.
# 만약 로딩에 실패하면 경고 메시지만 출력하고 서버는 계속 실행됩니다.
try:
    init_stage_from_url("stage1")
except Exception as e:
    print(f"[WARN] 초기 스테이지 로딩 실패: {e}")


# ============================================
#  라우트 (Routes) - API 엔드포인트 정의
# ============================================

@app.route("/")
def index():
    """
    메인 페이지 라우트
    - 사용자가 웹사이트 루트(/)에 접속하면 templates/index.html을 렌더링합니다.
    """
    return render_template("index.html")


@app.get("/api/state")
def api_state():
    """
    현재 게임 상태 조회 API (GET)
    - 클라이언트가 현재 게임 상태를 요청할 때 사용합니다.
    - 반환값: 현재 스테이지, 문제 번호, 점수 등의 공개 상태 정보 (JSON)
    """
    data = get_public_state()
    return jsonify(data)


@app.post("/api/submit")
def api_submit():
    """
    정답 제출 API (POST)
    - 사용자가 문제에 대한 답을 제출할 때 호출됩니다.
    - 요청 본문(body): 사용자가 입력한 답변 데이터 (JSON)
    - 반환값: 정답 여부, 피드백 메시지 등 (JSON)
    """
    payload = request.get_json(force=True) or {}
    result = submit_answer(payload)
    return jsonify(result)


@app.post("/api/next")
def api_next():
    """
    다음 문제로 이동 API (POST)
    - 현재 문제를 완료하고 다음 문제로 넘어갈 때 호출됩니다.
    - 반환값: 다음 문제의 상태 정보 (JSON)
    """
    result = go_next_question()
    return jsonify(result)


@app.post("/api/start_stage")
def api_start_stage():
    """
    특정 스테이지 시작 API (POST)
    - 로드맵/홈 화면에서 사용자가 특정 스테이지를 선택했을 때 호출됩니다.
    - 요청 본문(body): { "stageId": "stage1" }
    - stageId가 없으면 기본값으로 "stage1"을 사용합니다.
    - 반환값: 선택한 스테이지의 초기 상태 정보 (JSON)
    """
    data = request.get_json(force=True) or {}
    stage_id = data.get("stageId") or "stage1"  # stageId 없으면 기본 stage1
    public = start_stage(stage_id)
    return jsonify(public)


@app.post("/api/reset")
def api_reset():
    """
    스테이지 리셋 API (POST)
    - 현재 스테이지를 처음부터 다시 시작할 때 호출됩니다.
    - main.js에서 resetStageCore() 함수가 이 엔드포인트를 호출합니다.
    - 반환값: 리셋된 스테이지의 초기 상태 정보 (JSON)
    """
    public_state = reset_stage()
    return jsonify(public_state)


# ============================================
#  서버 실행
# ============================================
# 이 파일을 직접 실행하면 Flask 개발 서버가 시작됩니다.
# debug=True: 코드 변경 시 자동 재시작, 에러 발생 시 상세한 디버깅 정보 제공
if __name__ == "__main__":
    app.run(debug=True)
