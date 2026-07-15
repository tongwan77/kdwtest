// Vercel Serverless Function 진입점.
// 파일 경로가 api/[...path].js 이므로 /api/* 로 들어오는 모든 요청이 이 함수 하나로 모입니다.
// 실제 라우팅 로직은 프로젝트 루트의 api.js(라우터 정의)를 그대로 재사용합니다.
const { router } = require('../api');
const { sendJSON } = require('../util');
const { initDb } = require('../db');

module.exports = async (req, res) => {
  try {
    // 콜드스타트 시 1회(또는 초기화 실패 시 재시도)만 스키마 생성 + 시드 데이터를 실행합니다.
    await initDb();

    const u = new URL(req.url, 'http://localhost');
    const handled = await router.handle(req, res, u.pathname);
    if (!handled) sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: '서버 오류가 발생했습니다.', detail: err.message });
    }
  }
};
