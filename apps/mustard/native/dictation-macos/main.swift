// Mustard 받아쓰기 도우미(#1341, 에픽 #1354 #1349) — macOS 음성 인식(가능하면 기기 안에서만)으로 마이크 소리를 글로.
// 실행: mustard-dictate --locale ko-KR
// 출력(stdout, 한 줄에 JSON 하나): {"type":"ready"} · {"type":"level","v":0~1} · {"type":"partial","text"} · {"type":"final","text"} · {"type":"error","code","message"}
// 입력(stdin 한 줄): "stop" = 지금까지를 확정하고 끝냄, "cancel" = 버리고 바로 끝냄. stdin이 닫혀도 끝냄(부모가 죽은 경우).
// 권한: 마이크·음성 인식은 부모 앱(Mustard) 이름으로 물어봄 → Mustard Info.plist에 사용 설명 필요(electron-builder.yml extendInfo).
import Foundation
import Speech
import AVFoundation

setvbuf(stdout, nil, _IOLBF, 0)
func emit(_ o: [String: Any]) {
  if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) { print(s) }
}
func fail(_ code: String, _ msg: String) -> Never { emit(["type": "error", "code": code, "message": msg]); exit(1) }

var localeId = "en-US"
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--locale"), i + 1 < args.count { localeId = args[i + 1] }
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else { fail("locale", "unsupported locale \(localeId)") }

let engine = AVAudioEngine()
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true } // 소리가 Mac 밖으로 안 나감
if #available(macOS 13.0, *) { request.addsPunctuation = true }
var task: SFSpeechRecognitionTask?
var lastText = ""
var stopping = false
var lastLevel = Date.distantPast

func finish() { emit(["type": "final", "text": lastText]); exit(0) }

func start() {
  let input = engine.inputNode
  let fmt = input.outputFormat(forBus: 0)
  if fmt.channelCount == 0 { fail("nodevice", "no input device") }
  input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { buf, _ in
    request.append(buf)
    // 소리 크기(파형용) — 60ms마다 한 번
    let now = Date()
    if now.timeIntervalSince(lastLevel) < 0.06 { return }
    lastLevel = now
    guard let ch = buf.floatChannelData?[0] else { return }
    let n = Int(buf.frameLength)
    if n == 0 { return }
    var sum: Float = 0
    for k in 0..<n { sum += ch[k] * ch[k] }
    let rms = sqrt(sum / Float(n))
    emit(["type": "level", "v": min(1.0, Double(rms) * 8)])
  }
  engine.prepare()
  do { try engine.start() } catch { fail("audio", error.localizedDescription) }
  task = recognizer.recognitionTask(with: request) { result, error in
    if let r = result {
      lastText = r.bestTranscription.formattedString
      emit(["type": r.isFinal ? "final" : "partial", "text": lastText])
      if r.isFinal { exit(0) }
    }
    if let e = error {
      if stopping { finish() }
      let ns = e as NSError
      if ns.code == 1110 || ns.code == 216 { return } // 말이 없음·취소 — 무시하고 계속 들음
      fail("recognize", e.localizedDescription)
    }
  }
  emit(["type": "ready", "onDevice": request.requiresOnDeviceRecognition])
}

// stdin 명령
DispatchQueue.global().async {
  while let line = readLine() {
    let cmd = line.trimmingCharacters(in: .whitespaces)
    if cmd == "cancel" { exit(0) }
    if cmd == "stop" { break }
  }
  DispatchQueue.main.async {
    stopping = true
    engine.stop(); engine.inputNode.removeTap(onBus: 0)
    request.endAudio()
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { finish() } // 확정이 늦으면 지금까지로
  }
}

// 권한 — 음성 인식 → 마이크 순서로 물어봄
SFSpeechRecognizer.requestAuthorization { status in
  guard status == .authorized else { fail("denied-speech", "speech recognition not allowed") }
  AVCaptureDevice.requestAccess(for: .audio) { ok in
    guard ok else { fail("denied-mic", "microphone not allowed") }
    DispatchQueue.main.async { start() }
  }
}
RunLoop.main.run()
