// #1379 카드 제목 줄바꿈 자리 — 띄어쓰기 없는 코드 이름(OutlinedButton.styleFrom·ReorderableDragStartListener)이 카드 밖으로 삐져나가지 않게
// 읽기 좋은 곳(. _ / - 뒤, 소문자→대문자 경계)에서 나눔. 화면은 조각 사이에 <wbr>(줄을 바꿔도 되는 자리) + overflow-wrap:anywhere(그래도 넘치면 아무 데서나).
export function titleBreaks(s: string): string[] {
  return s.split(/(?<=[._/-])(?=[^\s._/-])|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);
}
