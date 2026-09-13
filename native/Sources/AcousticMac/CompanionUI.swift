import AppKit
import SwiftUI
import AcousticTransport
import ServiceManagement

@MainActor final class CompanionModel:ObservableObject {
    @Published var url=UserDefaults.standard.string(forKey:"supabaseURL") ?? ""
    @Published var key=UserDefaults.standard.string(forKey:"supabasePublicKey") ?? ""
    @Published var outputUID=UserDefaults.standard.string(forKey:"outputUID") ?? ""
    @Published var deviceID=UserDefaults.standard.string(forKey:"deviceID") ?? ""
    @Published var code=""
    @Published var status="出力先を確認してから受信を開始してください。"
    @Published var running=false
    @Published var launchAtLogin=SMAppService.mainApp.status == .enabled
    func setLaunchAtLogin(_ enabled:Bool) {Task{do{if enabled {try SMAppService.mainApp.register()}else{try await SMAppService.mainApp.unregister()};launchAtLogin=SMAppService.mainApp.status == .enabled;status=SMAppService.mainApp.status == .requiresApproval ? "システム設定のログイン項目で許可してください":"ログイン時の起動設定を更新しました"}catch{status=error.localizedDescription}}}
    @Published var devices=AudioDevice.all().filter{$0.outputChannels>0}
    private var worker:MacWorker?;private var task:Task<Void,Never>?
    func pair() {Task {do {let client=try CloudClient(url:url,key:key);let result=try await client.pair(name:Host.current().localizedName ?? "Mac",kind:"mac");code=result["code"] as? String ?? "";deviceID=result["deviceId"] as? String ?? "";save();status="Webの接続タブでコードを承認してください（10分間有効）。"} catch {status=error.localizedDescription}}}
    func save() {UserDefaults.standard.set(url,forKey:"supabaseURL");UserDefaults.standard.set(key,forKey:"supabasePublicKey");UserDefaults.standard.set(deviceID,forKey:"deviceID");UserDefaults.standard.set(outputUID,forKey:"outputUID")}
    func start() {do {guard !deviceID.isEmpty,!outputUID.isEmpty else {throw CloudError.message("ペアリングと出力選択が必要です")};save();let client=try CloudClient(url:url,key:key);let cache=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("AcousticLab/cache");let worker=MacWorker(client:client,deviceID:deviceID,outputUID:outputUID,cache:cache){[weak self] text in Task{@MainActor in self?.status=text}};self.worker=worker;running=true;task=Task{await worker.run();running=false}} catch {status=error.localizedDescription}}
    func stop() {task?.cancel();worker?.stop();running=false}
}
struct CompanionView:View {
    @StateObject private var model=CompanionModel()
    @StateObject private var receiver=ReceiverModel()
    var body:some View {TabView {VStack(alignment:.leading,spacing:18){Text("IMMERSIVE / ACOUSTIC LAB").font(.caption).foregroundStyle(.mint);Text("Mac Companion").font(.largeTitle)
        Text("CoreAudio 再生 · クラウド原音の検証・解析").foregroundStyle(.secondary)
        TextField("Supabase URL",text:$model.url).disabled(model.running)
        SecureField("Publishable key",text:$model.key).disabled(model.running)
        HStack{Button("ペアリングコードを発行"){model.pair()}.disabled(model.running);Text(model.code).font(.title2.monospaced()).textSelection(.enabled)}
        Picker("出力デバイス",selection:$model.outputUID){Text("選択してください").tag("");ForEach(model.devices){d in Text("\(d.name) · \(d.outputChannels) ch · \(Int(d.rate)) Hz").tag(d.uid)}}.disabled(model.running)
        if let d=model.devices.first(where:{$0.uid==model.outputUID}) {Text("物理フォーマット: \(Int(d.rate)) Hz / \(d.physicalBits.map(String.init) ?? "不明") bit\nチャンネル割当てと接続先はWebの「部屋・機材」で確認してください。").font(.caption).foregroundStyle(.secondary)}
        HStack{Button(model.running ? "■ 受信・再生を停止":"受信を開始"){if model.running{model.stop()}else{model.start()}}.buttonStyle(.borderedProminent).tint(model.running ? .red:.mint);Button("デバイスを更新"){model.devices=AudioDevice.all().filter{$0.outputChannels>0}}.disabled(model.running)}
        Text(model.status).font(.callout).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading).padding().background(.quaternary,in:RoundedRectangle(cornerRadius:8))
        Text("Macの録音はWebの既定マイク、またはCLIの record コマンドで校正マイクを選べます。High-res PCMは元のレートで保存し、解析条件を記録します。").font(.caption).foregroundStyle(.secondary)
        Toggle("ログイン時にMac Companionを起動",isOn:Binding(get:{model.launchAtLogin},set:{model.setLaunchAtLogin($0)}))
        Text("ウィンドウを閉じてもサービスは継続します。終了はメニューバーのImmersiveから選択してください。").font(.caption).foregroundStyle(.secondary)
        Spacer()
    }.padding(28).frame(minWidth:620,minHeight:550).tabItem {Text("音響")}; ReceiverView(model:receiver,cloudURL:model.url,cloudKey:model.key,deviceID:model.deviceID).tabItem {Text("AVR / HomeKit")} }.preferredColorScheme(.dark)}
}
@MainActor final class CompanionDelegate:NSObject,NSApplicationDelegate {
    var window:NSWindow?
    var statusItem:NSStatusItem?
    func applicationDidFinishLaunching(_ notification:Notification) {let window=NSWindow(contentRect:NSRect(x:0,y:0,width:660,height:590),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false);window.title="Immersive Acoustic Lab";window.contentView=NSHostingView(rootView:CompanionView());window.center();window.makeKeyAndOrderFront(nil);self.window=window;let item=NSStatusBar.system.statusItem(withLength:NSStatusItem.variableLength);item.button?.title="Immersive";let menu=NSMenu();menu.addItem(withTitle:"ウィンドウを表示",action:#selector(showWindow),keyEquivalent:"").target=self;menu.addItem(withTitle:"Immersiveを終了",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");item.menu=menu;statusItem=item;NSApp.activate(ignoringOtherApps:true)}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {false}
    @objc func showWindow() {window?.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)}
}
