// 순수 진단용: 이 파일이 배포되어 /api/ping 이 정상 응답하면,
// Vercel 프로젝트 자체는 api/ 폴더의 함수를 잘 인식하고 있다는 뜻입니다.
// 반대로 이것마저 404가 뜨면, 문제는 Root Directory 등 프로젝트 설정 쪽입니다.
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, message: 'pong', url: req.url }));
};
