// Mustard 받아쓰기 도우미(#1341, 에픽 #1354 #1349) — macOS 음성 인식(가능하면 기기 안에서만)으로 마이크 소리를 글로.
// 실행: mustard-dictate --locale ko-KR [--device <장치 UID>]
//       mustard-dictate --pcm [--device <UID>]  — 인식 없이 16kHz 모노 float32 소리를 stdout으로(로컬 모델 일꾼이 받음), 이벤트는 stderr
//       mustard-dictate --list-devices          — 마이크 장치 목록 JSON 한 줄 [{id,name,default}]
// 출력(stdout, 한 줄에 JSON 하나): {"type":"ready"} · {"type":"level","v":0~1} · {"type":"partial","text"} · {"type":"final","text"} · {"type":"error","code","message"}
// 입력(stdin 한 줄): "stop" = 지금까지를 확정하고 끝냄, "cancel" = 버리고 바로 끝냄. stdin이 닫혀도 끝냄(부모가 죽은 경우).
// 권한: 마이크·음성 인식은 부모 앱(Mustard) 이름으로 물어봄 → Mustard Info.plist에 사용 설명 필요(electron-builder.yml extendInfo).
import Foundation
import Speech
import AVFoundation
import CoreAudio
import AudioToolbox

let args = CommandLine.arguments
let pcmMode = args.contains("--pcm")
setvbuf(stdout, nil, pcmMode ? _IOFBF : _IOLBF, 0)
setvbuf(stderr, nil, _IOLBF, 0)
func emit(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
  if pcmMode { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) } else { print(s) }
}

// 마이크 장치 — CoreAudio 입력 채널이 있는 장치만
func audioDevices() -> [(id: AudioDeviceID, uid: String, name: String)] {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
  return ids.compactMap { id in
    var a = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var sz: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &a, 0, nil, &sz) == noErr, sz > 0 else { return nil }
    let buf = UnsafeMutableRawPointer.allocate(byteCount: Int(sz), alignment: 16); defer { buf.deallocate() }
    guard AudioObjectGetPropertyData(id, &a, 0, nil, &sz, buf) == noErr else { return nil }
    let list = UnsafeMutableAudioBufferListPointer(buf.assumingMemoryBound(to: AudioBufferList.self))
    if list.reduce(0, { $0 + Int($1.mNumberChannels) }) == 0 { return nil }
    func str(_ sel: AudioObjectPropertySelector) -> String {
      var p = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
      var cf: Unmanaged<CFString>?; var s2 = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
      guard AudioObjectGetPropertyData(id, &p, 0, nil, &s2, &cf) == noErr, let v = cf else { return "" }
      return v.takeRetainedValue() as String // 이름·UID는 호출자가 놓아야 하는(+1) CFString
    }
    return (id, str(kAudioDevicePropertyDeviceUID), str(kAudioObjectPropertyName))
  }
}
func defaultInput() -> AudioDeviceID {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var id = AudioDeviceID(0); var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
  return id
}
if args.contains("--list-devices") {
  let def = defaultInput()
  let list = audioDevices().map { ["id": $0.uid, "name": $0.name, "default": $0.id == def] as [String: Any] }
  if let d = try? JSONSerialization.data(withJSONObject: list), let s = String(data: d, encoding: .utf8) { print(s) }
  exit(0)
}
func fail(_ code: String, _ msg: String) -> Never { emit(["type": "error", "code": code, "message": msg]); exit(1) }

var localeId = "en-US"
if let i = args.firstIndex(of: "--locale"), i + 1 < args.count { localeId = args[i + 1] }
let recognizer: SFSpeechRecognizer? = pcmMode ? nil : SFSpeechRecognizer(locale: Locale(identifier: localeId))
if !pcmMode && recognizer == nil { fail("locale", "unsupported locale \(localeId)") }
var deviceUID = ""
if let i = args.firstIndex(of: "--device"), i + 1 < args.count { deviceUID = args[i + 1] }

let engine = AVAudioEngine()
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
if recognizer?.supportsOnDeviceRecognition == true { request.requiresOnDeviceRecognition = true } // 소리가 Mac 밖으로 안 나감
if #available(macOS 13.0, *) { request.addsPunctuation = true }
var task: SFSpeechRecognitionTask?
var lastText = ""
var stopping = false
var lastLevel = Date.distantPast

func finish() { emit(["type": "final", "text": lastText]); exit(0) }

let pcmFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
var converter: AVAudioConverter?
func writePCM(_ buf: AVAudioPCMBuffer) {
  guard let conv = converter else { return }
  let cap = AVAudioFrameCount(Double(buf.frameLength) * 16000 / buf.format.sampleRate) + 32
  guard let out = AVAudioPCMBuffer(pcmFormat: pcmFormat, frameCapacity: cap) else { return }
  var fed = false
  _ = conv.convert(to: out, error: nil) { _, status in
    if fed { status.pointee = .noDataNow; return nil }
    fed = true; status.pointee = .haveData; return buf
  }
  if let ch = out.floatChannelData?[0], out.frameLength > 0 {
    FileHandle.standardOutput.write(Data(bytes: ch, count: Int(out.frameLength) * 4))
  }
}

func start() {
  let input = engine.inputNode
  // 장치 고르기 — UID로 찾아 입력 장치로(못 찾으면 시스템 기본)
  if !deviceUID.isEmpty, let dev = audioDevices().first(where: { $0.uid == deviceUID }), let unit = input.audioUnit {
    var id = dev.id
    AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size))
  }
  let fmt = input.outputFormat(forBus: 0)
  if fmt.channelCount == 0 { fail("nodevice", "no input device") }
  if pcmMode { converter = AVAudioConverter(from: fmt, to: pcmFormat) }
  input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { buf, _ in
    if pcmMode { writePCM(buf) } else { request.append(buf) }
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
  if pcmMode { emit(["type": "ready"]); return }
  task = recognizer!.recognitionTask(with: request) { result, error in
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
    if pcmMode { exit(0) } // 소리만 보내는 모드 — 끝(글은 일꾼이 만듦)
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { finish() } // 확정이 늦으면 지금까지로
  }
}

// 권한 — 음성 인식 → 마이크 순서로 물어봄(소리만 보내는 모드는 마이크만)
if pcmMode {
  AVCaptureDevice.requestAccess(for: .audio) { ok in
    guard ok else { fail("denied-mic", "microphone not allowed") }
    DispatchQueue.main.async { start() }
  }
} else {
SFSpeechRecognizer.requestAuthorization { status in
  guard status == .authorized else { fail("denied-speech", "speech recognition not allowed") }
  AVCaptureDevice.requestAccess(for: .audio) { ok in
    guard ok else { fail("denied-mic", "microphone not allowed") }
    DispatchQueue.main.async { start() }
  }
}
}
RunLoop.main.run()
