// Mustard 컴퓨터 사용 도우미(#1189). Mustard main이 `open -n -g`로 띄움 → macOS가 이 앱을 책임 프로세스로 봐서
// 접근성·화면 기록 권한이 Mustard가 아니라 이 도우미에 붙음.
// 실행: MustardComputerUse --serve <소켓 경로> --token-file <토큰 파일>
//   - 토큰 파일은 읽고 바로 지움. 요청 = 한 줄 JSON {id, token, method, params}, 답 = {id, ok, result | error:{code,message}}.
//   - 연결이 하나도 없이 30초, 또는 요청 없이 10분이면 스스로 끝남(주인 Mustard가 죽어도 남지 않게).
// 막는 앱·켜기·비상 정지·기록은 Mustard main이 이 앞에서 처리 — 여기는 조작만.
import AppKit
import ApplicationServices
import ScreenCaptureKit
import UniformTypeIdentifiers

let VERSION = "1.0.0"
typealias J = [String: Any]

struct ToolError: Error { let code: String; let message: String }
func fail(_ code: String, _ message: String) -> ToolError { ToolError(code: code, message: message) }

func str(_ a: J, _ k: String) -> String? { (a[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }
func int(_ a: J, _ k: String) -> Int? {
  if let n = a[k] as? NSNumber { return n.intValue }
  if let s = a[k] as? String { return Int(s) }
  return nil
}
func dbl(_ a: J, _ k: String) -> Double? {
  if let n = a[k] as? NSNumber { return n.doubleValue }
  if let s = a[k] as? String { return Double(s) }
  return nil
}
func clip(_ s: String, _ n: Int) -> String {
  let one = s.replacingOccurrences(of: "\n", with: " ")
  return one.count > n ? String(one.prefix(n)) + "…" : one
}

// ── 앱 찾기 ──────────────────────────────────────────────────────────────
// 막는 앱(Mustard가 요청마다 보냄) — 이름을 대충 줘도("1pass") 실제로 찾은 앱으로 다시 확인
var blocked: [String] = []
func checkBlocked(_ r: NSRunningApplication) throws -> NSRunningApplication {
  let labels = [r.localizedName, r.bundleIdentifier, r.bundleURL?.path].compactMap { $0?.lowercased() }
  if let b = blocked.first(where: { b in labels.contains { $0.contains(b.lowercased()) } }) { throw fail("app_blocked", "Mustard blocks \(b). Do not operate it; tell the user.") }
  return r
}
func resolveApp(_ a: J) throws -> NSRunningApplication { try checkBlocked(findApp(a)) }
func findApp(_ a: J) throws -> NSRunningApplication {
  if let pid = int(a, "pid") {
    if let r = NSRunningApplication(processIdentifier: pid_t(pid)) { return r }
    throw fail("app_not_found", "No running app with pid \(pid). Use list_apps.")
  }
  guard let q = str(a, "app")?.lowercased() else { throw fail("invalid_argument", "Pass app (name or bundle id) or pid.") }
  let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy != .prohibited }
  if let r = apps.first(where: { $0.bundleIdentifier?.lowercased() == q }) { return r }
  if let r = apps.first(where: { $0.localizedName?.lowercased() == q }) { return r }
  let m = apps.filter { ($0.localizedName ?? "").lowercased().contains(q) }
  if m.count == 1 { return m[0] }
  if m.count > 1 { throw fail("app_ambiguous", "Several apps match \"\(q)\": \(m.compactMap { $0.localizedName }.joined(separator: ", ")). Use the bundle id or pid.") }
  throw fail("app_not_found", "No running app matches \"\(q)\". Use list_apps (open it first if needed).")
}

// ── 접근성(AX) 도우미 ────────────────────────────────────────────────────
func attr(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
  var v: CFTypeRef?
  return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}
func sattr(_ e: AXUIElement, _ name: String) -> String? { attr(e, name) as? String }
func elem(_ v: CFTypeRef?) -> AXUIElement? {
  guard let v, CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
  return (v as! AXUIElement)
}
func children(_ e: AXUIElement) -> [AXUIElement] { (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func actions(_ e: AXUIElement) -> [String] {
  var arr: CFArray?
  guard AXUIElementCopyActionNames(e, &arr) == .success, let a = arr as? [String] else { return [] }
  return a
}
func axValue<T>(_ e: AXUIElement, _ name: String, _ type: AXValueType, _ empty: T) -> T? {
  guard let v = attr(e, name), CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
  var out = empty
  return AXValueGetValue(v as! AXValue, type, &out) ? out : nil
}
func frame(_ e: AXUIElement) -> CGRect? {
  guard let p = axValue(e, kAXPositionAttribute, .cgPoint, CGPoint.zero), let s = axValue(e, kAXSizeAttribute, .cgSize, CGSize.zero) else { return nil }
  return CGRect(origin: p, size: s)
}
func settable(_ e: AXUIElement, _ name: String) -> Bool {
  var b: DarwinBoolean = false
  return AXUIElementIsAttributeSettable(e, name as CFString, &b) == .success && b.boolValue
}
func needAX() throws {
  if !AXIsProcessTrusted() { throw fail("permission_denied", "Accessibility permission is off for Mustard Computer Use. Ask the user to allow it in Mustard (Settings > Computer use).") }
}

// 일렉트론·크로미움 앱은 이걸 켜야 접근성 트리를 만듦 — 처음 켤 때만 잠깐 기다림
var enhanced = Set<pid_t>()
func enableAX(_ app: AXUIElement, _ pid: pid_t) {
  if enhanced.contains(pid) { return }
  enhanced.insert(pid)
  let a = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  let b = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
  if a == .success || b == .success { usleep(300_000) }
}

func windows(_ app: AXUIElement) -> [AXUIElement] { (attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? [] }
func pickWindow(_ app: AXUIElement, _ index: Int?) throws -> AXUIElement {
  let ws = windows(app)
  if let i = index {
    guard i >= 0, i < ws.count else { throw fail("window_not_found", "No window \(i) (app has \(ws.count)). Use list_windows.") }
    return ws[i]
  }
  if let w = elem(attr(app, kAXFocusedWindowAttribute)) ?? elem(attr(app, kAXMainWindowAttribute)) ?? ws.first { return w }
  throw fail("window_not_found", "The app has no open window.")
}

// 마지막 스냅샷의 요소들(앱별) — 번호로 조작
var snapshots: [pid_t: [AXUIElement]] = [:]
func element(_ pid: pid_t, _ index: Int) throws -> AXUIElement {
  guard let list = snapshots[pid] else { throw fail("element_not_found", "No snapshot for this app. Call get_app_state first.") }
  guard index >= 0, index < list.count else { throw fail("element_not_found", "No element \(index) in the last snapshot. Call get_app_state again.") }
  let e = list[index]
  if sattr(e, kAXRoleAttribute) == nil { throw fail("element_stale", "Element \(index) is gone (the screen changed). Call get_app_state again.") }
  return e
}

// 트리 → 번호 붙은 짧은 글. 이름·값·동작이 없는 묶음(group 등)은 건너뛰고 아래만 봄.
let MAX_NODES = 1200, MAX_DEPTH = 64, MAX_VISIT = 20000
func render(_ root: AXUIElement) -> (text: String, elems: [AXUIElement], truncated: Bool) {
  var lines: [String] = [], elems: [AXUIElement] = []
  var truncated = false, visited = 0
  let quiet: Set<String> = ["AXGroup", "AXUnknown", "AXSplitGroup", "AXLayoutArea", "AXScrollArea", "AXList", "AXSection"]
  func walk(_ e: AXUIElement, _ depth: Int, _ indent: Int) {
    visited += 1
    if elems.count >= MAX_NODES || depth > MAX_DEPTH || visited > MAX_VISIT { truncated = true; return }
    let role = sattr(e, kAXRoleAttribute) ?? "AXUnknown"
    let label = [sattr(e, kAXTitleAttribute), sattr(e, kAXDescriptionAttribute)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " — ")
    var value = ""
    if let v = attr(e, kAXValueAttribute) {
      if let s = v as? String { value = s } else if let n = v as? NSNumber, role != "AXGroup" { value = n.stringValue }
    }
    let acts = actions(e)
    var next = indent
    if !(quiet.contains(role) && label.isEmpty && value.isEmpty && !acts.contains("AXPress")) {
      let i = elems.count
      elems.append(e)
      var line = String(repeating: "  ", count: indent) + "\(i) " + (role.hasPrefix("AX") ? String(role.dropFirst(2)).lowercased() : role)
      if !label.isEmpty { line += " \(clip(label, 120))" }
      if !value.isEmpty && value != label { line += " = \"\(clip(value, 200))\"" }
      if acts.contains("AXPress") { line += " [click]" }
      if settable(e, kAXValueAttribute) { line += " [edit]" }
      if (attr(e, kAXFocusedAttribute) as? Bool) == true { line += " [focused]" }
      lines.append(line)
      next = indent + 1
    }
    for c in children(e) { walk(c, depth + 1, next) }
  }
  walk(root, 0, 0)
  return (lines.joined(separator: "\n"), elems, truncated)
}

// ── 스크린샷(ScreenCaptureKit) ───────────────────────────────────────────
let shotDir: URL = {
  let d = FileManager.default.temporaryDirectory.appendingPathComponent("mustard-computer", isDirectory: true)
  try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  // 하루 지난 스크린샷은 지움
  let old = Date().addingTimeInterval(-86_400)
  for f in (try? FileManager.default.contentsOfDirectory(at: d, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
    if let m = try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, m < old { try? FileManager.default.removeItem(at: f) }
  }
  return d
}()
// AX 창 틀과 가장 가까운 같은 pid 창(일반 층)
func windowID(_ pid: pid_t, _ f: CGRect) -> CGWindowID? {
  guard let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [J] else { return nil }
  let mine = infos.filter { ($0[kCGWindowOwnerPID as String] as? Int).map(pid_t.init) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
  let scored = mine.compactMap { w -> (CGWindowID, CGFloat)? in
    guard let n = w[kCGWindowNumber as String] as? Int, let b = w[kCGWindowBounds as String] as? NSDictionary, let r = CGRect(dictionaryRepresentation: b as CFDictionary) else { return nil }
    return (CGWindowID(n), abs(r.minX - f.minX) + abs(r.minY - f.minY) + abs(r.width - f.width) + abs(r.height - f.height))
  }
  return scored.min { $0.1 < $1.1 }?.0
}
func screenshot(_ pid: pid_t, _ f: CGRect) -> J {
  if !CGPreflightScreenCaptureAccess() { return ["error": "Screen Recording permission is off for Mustard Computer Use. Ask the user to allow it in Mustard (Settings > Computer use)."] }
  guard let wid = windowID(pid, f) else { return ["error": "Window is not on screen (minimized or on another Space)."] }
  var out: J = ["error": "Screenshot timed out."]
  let sem = DispatchSemaphore(value: 0)
  Task {
    defer { sem.signal() }
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      guard let w = content.windows.first(where: { $0.windowID == wid }) else { out = ["error": "Window not capturable."]; return }
      let filter = SCContentFilter(desktopIndependentWindow: w)
      let scale = CGFloat(filter.pointPixelScale)
      let cfg = SCStreamConfiguration()
      cfg.width = max(1, Int(w.frame.width * scale)); cfg.height = max(1, Int(w.frame.height * scale)); cfg.showsCursor = false
      let img = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
      let url = shotDir.appendingPathComponent(UUID().uuidString + ".png")
      guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { out = ["error": "Could not write the PNG."]; return }
      CGImageDestinationAddImage(dest, img, nil)
      guard CGImageDestinationFinalize(dest) else { out = ["error": "Could not write the PNG."]; return }
      chmod(url.path, 0o600)
      out = ["path": url.path, "width": img.width, "height": img.height, "scale": Double(scale)]
    } catch { out = ["error": "Screenshot failed: \(error.localizedDescription)"] }
  }
  _ = sem.wait(timeout: .now() + 5)
  return out
}

// ── 합성 입력(CGEvent) ───────────────────────────────────────────────────
let src = CGEventSource(stateID: .hidSystemState)
func activate(_ app: NSRunningApplication) {
  if NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier { app.activate(); usleep(300_000) }
}
func requireFront(_ app: NSRunningApplication) throws {
  activate(app)
  if NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier { throw fail("window_not_focused", "Could not bring the app to the front, so keystrokes were not sent.") }
}
func syntheticClick(_ app: NSRunningApplication, _ p: CGPoint, right: Bool, count: Int) {
  activate(app)
  let (down, up, btn): (CGEventType, CGEventType, CGMouseButton) = right ? (.rightMouseDown, .rightMouseUp, .right) : (.leftMouseDown, .leftMouseUp, .left)
  CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: btn)?.post(tap: .cghidEventTap)
  usleep(30_000)
  for i in 1...count {
    for t in [down, up] {
      let e = CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: btn)
      e?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
      e?.post(tap: .cghidEventTap)
    }
    usleep(40_000)
  }
}
let KEYS: [String: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
  "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33,
  "i": 34, "p": 35, "return": 36, "enter": 36, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47,
  "tab": 48, "space": 49, "`": 50, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
  "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
  "home": 115, "pageup": 116, "forwarddelete": 117, "end": 119, "pagedown": 121, "left": 123, "right": 124, "down": 125, "up": 126,
]
func parseKey(_ s: String) throws -> (CGKeyCode, CGEventFlags) {
  var flags: CGEventFlags = []
  var key: CGKeyCode?
  for raw in s.lowercased().split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces) }) {
    switch raw {
    case "cmd", "command", "meta", "cmdorctrl": flags.insert(.maskCommand)
    case "shift": flags.insert(.maskShift)
    case "alt", "option", "opt": flags.insert(.maskAlternate)
    case "ctrl", "control": flags.insert(.maskControl)
    case "fn": flags.insert(.maskSecondaryFn)
    default:
      guard let k = KEYS[raw] else { throw fail("invalid_argument", "Unknown key \"\(raw)\". Examples: return, tab, escape, cmd+a, cmd+shift+t, down.") }
      key = k
    }
  }
  guard let key else { throw fail("invalid_argument", "No key in \"\(s)\".") }
  return (key, flags)
}

// ── 도구 ─────────────────────────────────────────────────────────────────
let APP_ARGS: J = ["app": ["type": "string", "description": "App name or bundle id (from list_apps)"], "pid": ["type": "number", "description": "Or the app's pid"]]
func schema(_ extra: J, _ required: [String] = []) -> J { ["type": "object", "properties": APP_ARGS.merging(extra) { a, _ in a }, "required": required] }
let TOOLS: [J] = [
  ["name": "list_apps", "description": "Running apps with windows: name, bundleId, pid, active.", "inputSchema": ["type": "object", "properties": [:]]],
  ["name": "list_windows", "description": "Windows of an app: index, title, frame (screen points), focused/main/minimized.", "inputSchema": schema([:])],
  ["name": "get_app_state", "description": "Snapshot of one window: numbered accessibility tree (line = index role label = \"value\" [click] [edit] [focused]) plus a screenshot file path. Element numbers are valid until the screen changes; take a new snapshot after every action.", "inputSchema": schema(["window": ["type": "number", "description": "Window index from list_windows (default: focused window)"], "screenshot": ["type": "boolean", "description": "Default true"]])],
  ["name": "click", "description": "Click an element from the last snapshot (accessibility press first, real mouse click if needed), or window-relative point x,y in points (screenshot pixels / scale). Real clicks bring the app to the front and move the mouse.", "inputSchema": schema(["element": ["type": "number"], "x": ["type": "number"], "y": ["type": "number"], "window": ["type": "number"], "button": ["type": "string", "enum": ["left", "right"]], "count": ["type": "number", "description": "2 = double click"]])],
  ["name": "set_value", "description": "Set the text/value of an [edit] element directly (no typing). Returns whether a read-back matched.", "inputSchema": schema(["element": ["type": "number"], "value": ["type": "string"]], ["element", "value"])],
  ["name": "type_text", "description": "Type text into the app's focused field (brings the app to the front first; refuses if it cannot).", "inputSchema": schema(["text": ["type": "string"]], ["text"])],
  ["name": "press_key", "description": "Press a key or shortcut in the app, e.g. return, tab, escape, down, cmd+a, cmd+shift+t (app is brought to the front first).", "inputSchema": schema(["key": ["type": "string"]], ["key"])],
  ["name": "scroll", "description": "Scroll at an element or window-relative point.", "inputSchema": schema(["element": ["type": "number"], "x": ["type": "number"], "y": ["type": "number"], "window": ["type": "number"], "direction": ["type": "string", "enum": ["up", "down", "left", "right"]], "amount": ["type": "number", "description": "Lines, default 5"]], ["direction"])],
]

func appInfo(_ r: NSRunningApplication) -> J { ["name": r.localizedName ?? "", "bundleId": r.bundleIdentifier ?? "", "pid": Int(r.processIdentifier)] }

func callTool(_ name: String, _ a: J) throws -> Any {
  switch name {
  case "list_apps":
    return NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map { r -> J in var j = appInfo(r); j["active"] = r.isActive; j["hidden"] = r.isHidden; return j }
  case "list_windows":
    try needAX()
    let r = try resolveApp(a), ax = AXUIElementCreateApplication(r.processIdentifier)
    enableAX(ax, r.processIdentifier)
    let focused = elem(attr(ax, kAXFocusedWindowAttribute)), main = elem(attr(ax, kAXMainWindowAttribute))
    return windows(ax).enumerated().map { i, w -> J in
      let f = frame(w) ?? .zero
      return ["index": i, "title": sattr(w, kAXTitleAttribute) ?? "", "x": f.minX, "y": f.minY, "width": f.width, "height": f.height,
              "focused": focused.map { CFEqual($0, w) } ?? false, "main": main.map { CFEqual($0, w) } ?? false, "minimized": (attr(w, kAXMinimizedAttribute) as? Bool) ?? false]
    }
  case "get_app_state":
    try needAX()
    let r = try resolveApp(a), pid = r.processIdentifier, ax = AXUIElementCreateApplication(pid)
    enableAX(ax, pid)
    let w = try pickWindow(ax, int(a, "window"))
    let t = render(w)
    snapshots[pid] = t.elems
    let f = frame(w) ?? .zero
    var out: J = ["app": appInfo(r), "window": ["title": sattr(w, kAXTitleAttribute) ?? "", "x": f.minX, "y": f.minY, "width": f.width, "height": f.height],
                  "coordinates": "window-relative points; screenshot pixels / scale", "elementCount": t.elems.count, "truncated": t.truncated, "tree": t.text]
    if (a["screenshot"] as? Bool) != false { out["screenshot"] = screenshot(pid, f) }
    return out
  case "click":
    try needAX()
    let r = try resolveApp(a), pid = r.processIdentifier
    let right = str(a, "button") == "right", count = max(1, min(3, int(a, "count") ?? 1))
    if let i = int(a, "element") {
      let e = try element(pid, i)
      if count == 1 {
        let acts = actions(e)
        for act in (right ? ["AXShowMenu"] : ["AXPress", "AXConfirm", "AXOpen", "AXPick"]) where acts.contains(act) {
          if AXUIElementPerformAction(e, act as CFString) == .success { return ["done": true, "via": "accessibility", "action": String(act.dropFirst(2))] }
        }
      }
      guard let f = frame(e) else { throw fail("element_not_clickable", "Element \(i) has no position. Try another element or x,y.") }
      syntheticClick(r, CGPoint(x: f.midX, y: f.midY), right: right, count: count)
      return ["done": true, "via": "mouse"]
    }
    guard let x = dbl(a, "x"), let y = dbl(a, "y") else { throw fail("invalid_argument", "Pass element, or x and y.") }
    let ax = AXUIElementCreateApplication(pid)
    guard let wf = frame(try pickWindow(ax, int(a, "window"))) else { throw fail("window_not_found", "Window has no position.") }
    syntheticClick(r, CGPoint(x: wf.minX + x, y: wf.minY + y), right: right, count: count)
    return ["done": true, "via": "mouse"]
  case "set_value":
    try needAX()
    let r = try resolveApp(a)
    guard let i = int(a, "element"), let v = a["value"] as? String else { throw fail("invalid_argument", "Pass element and value.") }
    let e = try element(r.processIdentifier, i)
    guard settable(e, kAXValueAttribute) else { throw fail("value_not_settable", "Element \(i) is not editable. Click it and use type_text instead.") }
    guard AXUIElementSetAttributeValue(e, kAXValueAttribute as CFString, v as CFString) == .success else { throw fail("action_failed", "The app rejected the value.") }
    return ["done": true, "verified": sattr(e, kAXValueAttribute) == v]
  case "type_text":
    let r = try resolveApp(a)
    guard let text = a["text"] as? String else { throw fail("invalid_argument", "Pass text.") }
    try requireFront(r)
    var units = Array(text.utf16)[...]
    while !units.isEmpty {
      var chunk = Array(units.prefix(16)); units = units.dropFirst(chunk.count)
      for down in [true, false] {
        let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)
        e?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
        e?.post(tap: .cghidEventTap)
      }
      usleep(10_000)
    }
    return ["done": true, "via": "keyboard"]
  case "press_key":
    let r = try resolveApp(a)
    guard let k = str(a, "key") else { throw fail("invalid_argument", "Pass key.") }
    let (code, flags) = try parseKey(k)
    try requireFront(r)
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
      e?.flags = flags
      e?.post(tap: .cghidEventTap)
    }
    return ["done": true, "via": "keyboard"]
  case "scroll":
    try needAX()
    let r = try resolveApp(a), pid = r.processIdentifier
    let n = Int32(max(1, min(50, int(a, "amount") ?? 5)))
    var p: CGPoint
    if let i = int(a, "element") {
      guard let f = frame(try element(pid, i)) else { throw fail("element_not_found", "Element \(i) has no position.") }
      p = CGPoint(x: f.midX, y: f.midY)
    } else {
      guard let wf = frame(try pickWindow(AXUIElementCreateApplication(pid), int(a, "window"))) else { throw fail("window_not_found", "Window has no position.") }
      p = CGPoint(x: wf.minX + (dbl(a, "x") ?? wf.width / 2), y: wf.minY + (dbl(a, "y") ?? wf.height / 2))
    }
    let (dy, dx): (Int32, Int32) = switch str(a, "direction") { case "up": (n, 0); case "down": (-n, 0); case "left": (0, n); case "right": (0, -n); default: (0, 0) }
    if dy == 0 && dx == 0 { throw fail("invalid_argument", "direction must be up, down, left or right.") }
    let e = CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
    e?.location = p
    e?.post(tap: .cghidEventTap)
    return ["done": true]
  default:
    throw fail("unknown_tool", "Unknown tool \(name). Use the tool list.")
  }
}

func permissions() -> J { ["accessibility": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess()] }
// 권한 요청 — macOS 프롬프트(이 도우미 이름으로) + 해당 시스템 설정 화면
func requestPermission(_ kind: String) -> J {
  if kind == "accessibility" {
    _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
  } else {
    _ = CGRequestScreenCaptureAccess()
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
  }
  return permissions()
}

func dispatch(_ method: String, _ p: J) throws -> Any {
  switch method {
  case "handshake": return ["protocol": 1, "version": VERSION]
  case "permissions": return permissions()
  case "request_permission": return requestPermission(str(p, "kind") ?? "accessibility")
  case "list_tools": return TOOLS
  case "describe":
    guard let t = TOOLS.first(where: { ($0["name"] as? String) == str(p, "tool") }) else { throw fail("unknown_tool", "Unknown tool.") }
    return t
  case "call":
    blocked = (p["blocked"] as? [String]) ?? []
    return try callTool(str(p, "tool") ?? "", (p["args"] as? J) ?? [:])
  default: throw fail("unknown_method", method)
  }
}

// ── 서버(유닉스 소켓, 줄 단위 JSON) ─────────────────────────────────────
let lock = NSLock()
var openConns = 0
var lastActive = Date()
let work = DispatchQueue(label: "work") // 조작은 한 번에 하나

func writeAll(_ fd: Int32, _ data: Data) {
  data.withUnsafeBytes { (buf: UnsafeRawBufferPointer) in
    var off = 0
    while off < buf.count {
      let n = write(fd, buf.baseAddress! + off, buf.count - off)
      if n <= 0 { return }
      off += n
    }
  }
}
func handleConn(_ fd: Int32, _ token: String) {
  var pending = Data()
  var buf = [UInt8](repeating: 0, count: 65_536)
  while true {
    let n = read(fd, &buf, buf.count)
    if n <= 0 { break }
    pending.append(buf, count: n)
    while let nl = pending.firstIndex(of: 0x0A) {
      let line = pending[pending.startIndex..<nl]
      pending = Data(pending[(nl + 1)...])
      guard let m = (try? JSONSerialization.jsonObject(with: line)) as? J else { continue }
      lock.lock(); lastActive = Date(); lock.unlock()
      let id = m["id"] ?? NSNull()
      var reply: J
      if (m["token"] as? String) != token {
        reply = ["id": id, "ok": false, "error": ["code": "unauthorized", "message": "bad token"]]
      } else {
        reply = work.sync {
          do { return ["id": id, "ok": true, "result": try dispatch(str(m, "method") ?? "", (m["params"] as? J) ?? [:])] }
          catch let e as ToolError { return ["id": id, "ok": false, "error": ["code": e.code, "message": e.message]] }
          catch { return ["id": id, "ok": false, "error": ["code": "error", "message": "\(error)"]] }
        }
      }
      if var d = try? JSONSerialization.data(withJSONObject: reply) { d.append(0x0A); writeAll(fd, d) }
    }
  }
  close(fd)
  lock.lock(); openConns -= 1; lastActive = Date(); lock.unlock()
}

func serve(_ path: String, _ tokenFile: String) {
  guard let raw = try? String(contentsOfFile: tokenFile, encoding: .utf8) else { exit(2) }
  try? FileManager.default.removeItem(atPath: tokenFile)
  let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !token.isEmpty else { exit(2) }
  unlink(path)
  let fd = socket(AF_UNIX, SOCK_STREAM, 0)
  var addr = sockaddr_un()
  addr.sun_family = sa_family_t(AF_UNIX)
  let bytes = Array(path.utf8)
  guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { exit(3) }
  withUnsafeMutableBytes(of: &addr.sun_path) { p in p.copyBytes(from: bytes); p[bytes.count] = 0 }
  let ok = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
  guard ok == 0, listen(fd, 4) == 0 else { exit(4) }
  chmod(path, 0o600)
  Thread {
    while true {
      let c = accept(fd, nil, nil)
      if c < 0 { continue }
      lock.lock(); openConns += 1; lastActive = Date(); lock.unlock()
      Thread { handleConn(c, token) }.start()
    }
  }.start()
  // 주인이 없으면 끝남: 연결 0개로 30초, 또는 요청 없이 10분
  Thread {
    while true {
      sleep(5)
      lock.lock(); let idle = Date().timeIntervalSince(lastActive), conns = openConns; lock.unlock()
      if (conns == 0 && idle > 30) || idle > 600 { unlink(path); exit(0) }
    }
  }.start()
}

let argv = CommandLine.arguments
if let i = argv.firstIndex(of: "--serve"), i + 1 < argv.count, let t = argv.firstIndex(of: "--token-file"), t + 1 < argv.count {
  _ = shotDir
  NSApplication.shared.setActivationPolicy(.accessory)
  serve(argv[i + 1], argv[t + 1])
  NSApplication.shared.run()
} else {
  FileHandle.standardError.write("Mustard Computer Use runs only when Mustard starts it.\n".data(using: .utf8)!)
  exit(13)
}
