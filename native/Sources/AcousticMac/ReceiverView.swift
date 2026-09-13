import AppKit
import SwiftUI
import CoreImage.CIFilterBuiltins
import DenonControl
import AcousticTransport

@MainActor final class ReceiverModel:ObservableObject {
    @Published var host=UserDefaults.standard.string(forKey:"avrHost") ?? ""
    @Published var fingerprint=""
    @Published var trustCertificate=false
    @Published var includeSetup=false
    @Published var includeNetwork=false
    @Published var homeKitModes=false
    @Published var state:ReceiverState?
    @Published var status="AVRのIPアドレスを入力してください。音声出力の選択は不要です。"
    @Published var running=false
    @Published var cloudRunning=false
    @Published var homeKitRunning=false
    @Published var setupCode=""
    @Published var qr:NSImage?
    @Published var zone=1
    @Published var volume=40.0
    @Published var diagnostic="get_audio_info"
    @Published var raw=""
    @Published var savedPreset:ReceiverPreset?
    let receiverID:UUID
    private var controller:ReceiverController?
    private var poll:Task<Void,Never>?
    private var cloudTask:Task<Void,Never>?
    private var homeKit:ReceiverHomeKit?
    private var api:ReceiverAPI?
    init() {
        receiverID=UserDefaults.standard.string(forKey:"avrReceiverID").flatMap(UUID.init(uuidString:)) ?? UUID()
        UserDefaults.standard.set(receiverID.uuidString,forKey:"avrReceiverID")
    }
    private var directory:URL {FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("AcousticLab/receivers/\(receiverID.uuidString)")}
    func inspectCertificate() {Task {do {fingerprint=try await DenonCertificateProbe.inspect(host:host);trustCertificate=false}catch{status=error.localizedDescription}}}
    func approveCertificate() {guard trustCertificate,!fingerprint.isEmpty else{return};UserDefaults.standard.set(host,forKey:"avrTLSHost");UserDefaults.standard.set(fingerprint,forKey:"avrTLSFingerprint");status="証明書を固定しました。AVRへ接続して詳細診断を実行できます。"}
    func snapshot() {guard let controller else{return};let host=host,setup=includeSetup,network=includeNetwork;Task {do{let snapshot=try await controller.diagnosticSnapshot(includeSetup:setup,telnetHost:network ? host:nil,includeNetwork:network);raw=String(decoding:try jsonData(receiverJSON(snapshot)),as:UTF8.self);status=snapshot.complete ? "スナップショットを取得しました":"一部の照会を停止しました。エラーと取得済みデータを確認してください"}catch{status=error.localizedDescription}}}
    func start() {
        do {
            let controller=try ReceiverController(client:DenonClient(http:DenonHTTPTransport(host:host,certificateFingerprint:UserDefaults.standard.string(forKey:"avrTLSHost")==host ? UserDefaults.standard.string(forKey:"avrTLSFingerprint"):nil)),journalURL:directory.appendingPathComponent("journal.json"))
            let api=try ReceiverAPI(controller:controller,receiverID:receiverID.uuidString);try api.start();self.api=api
            api.homeKitInfo={ [weak self] in await MainActor.run {guard let self else{return ["enabled":false]};return ["enabled":self.homeKitRunning,"running":self.homeKitRunning,"paired":self.homeKit?.paired ?? false,"setup_uri":self.homeKit?.setupURI ?? "","pincode":self.setupCode,"svg":self.homeKit?.setupSVG ?? ""]} }
            self.controller=controller;UserDefaults.standard.set(host,forKey:"avrHost");running=true
            poll=Task {while !Task.isCancelled {
                let snapshot=await controller.refresh();if Task.isCancelled{return}
                state=snapshot;savedPreset=await controller.preset();homeKit?.update(snapshot)
                status=snapshot.errors.isEmpty ? "AVR接続済み · \(snapshot.friendlyName ?? host)":"読取エラー: \(snapshot.errors.sorted{$0.key<$1.key}.map{$0.key+": "+$0.value}.joined(separator:" / "))"
                updatePairing();try? await Task.sleep(for:.seconds(5))
            }}
        } catch {status=error.localizedDescription}
    }
    func stop() {if let controller {Task{await controller.shutdown()}};api?.stop();api=nil;poll?.cancel();cloudTask?.cancel();homeKit?.stop();homeKit=nil;controller=nil;running=false;cloudRunning=false;homeKitRunning=false;setupCode="";qr=nil;status="AVRサービスを停止しました"}
    func command(_ kind:String,enabled:Bool?=nil,value:Double?=nil,name:String?=nil,levels:[String:Int]?=nil) {
        guard let controller,let state else{return}
        let operation=ReceiverOperation(expectedRevision:state.revision,kind:kind,zone:zone,enabled:enabled,value:value,name:name,levels:levels)
        Task {do {let result=try await controller.execute(operation);self.state=result.state;status="操作: \(result.status)";savedPreset=await controller.preset()}catch{status=error.localizedDescription}}
    }
    func preset(restore:Bool,resolve:Bool=false) {
        guard let controller,let state else{return}
        Task {do {
            let result=try await (restore ? controller.restorePreset(id:UUID(),expectedRevision:state.revision,resolveConflicts:resolve):controller.applyCenterBoost(id:UUID(),expectedRevision:state.revision))
            self.state=result.state;status="プリセット: \(result.status)";savedPreset=await controller.preset()
        } catch {status=error.localizedDescription}}
    }
    func read() {guard let controller else{return};Task {do{let result=try await controller.read(diagnostic);raw=result.raw;status="\(diagnostic) を取得しました"}catch{status=error.localizedDescription}}}
    func startCloud(url:String,key:String,deviceID:String) {
        guard let controller,!deviceID.isEmpty else{status="Macのクラウドペアリングが必要です";return}
        do {
            let worker=ReceiverCloudWorker(cloud:try CloudClient(url:url,key:key),controller:controller,receiverID:receiverID.uuidString,deviceID:deviceID,name:state?.friendlyName ?? "AVR",host:host,directory:directory.appendingPathComponent("snapshots")){[weak self] text in Task{@MainActor in self?.status=text}}
            cloudRunning=true;cloudTask=Task {await worker.run();cloudRunning=false}
        } catch {status=error.localizedDescription}
    }
    func copyLocalToken() {guard let api else{return};NSPasteboard.general.clearContents();NSPasteboard.general.setString(api.token,forType:.string);status="ローカル接続トークンをコピーしました"}
    func stopCloud() {cloudTask?.cancel();cloudRunning=false}
    func toggleHomeKit() {
        if homeKitRunning {homeKit?.stop();homeKit=nil;homeKitRunning=false;updatePairing();return}
        guard let controller,let state else{return}
        do {
            let bridge=try ReceiverHomeKit(controller:controller,state:state,directory:directory.appendingPathComponent("homekit"),modeNames:homeKitModes ? state.modes.map(\.name):[]){[weak self] text in Task{@MainActor in self?.status=text}}
            try bridge.start();homeKit=bridge;homeKitRunning=true;updatePairing()
        } catch {status=error.localizedDescription}
    }
    func updatePairing() {
        setupCode=homeKit?.setupCode ?? "";qr=nil
        if let uri=homeKit?.setupURI {
            let filter=CIFilter.qrCodeGenerator();filter.message=Data(uri.utf8)
            if let output=filter.outputImage?.transformed(by:CGAffineTransform(scaleX:7,y:7)),let cg=CIContext().createCGImage(output,from:output.extent){qr=NSImage(cgImage:cg,size:NSSize(width:220,height:220))}
        }
    }
    func exportState() {
        guard let state else{return};let panel=NSSavePanel();panel.nameFieldStringValue="avr-observation.json"
        if panel.runModal() == .OK,let url=panel.url {do{try jsonData(receiverJSON(state)).write(to:url,options:.atomic)}catch{status=error.localizedDescription}}
    }
}
struct ReceiverView:View {
    @ObservedObject var model:ReceiverModel
    let cloudURL:String;let cloudKey:String;let deviceID:String
    @State private var resolvePresetConflict=false
    var body:some View {ScrollView {VStack(alignment:.leading,spacing:16) {
        Text("AVR Control").font(.largeTitle)
        HStack{TextField("AVRのIP / ホスト名",text:$model.host).disabled(model.running);Button(model.running ? "AVRを停止":"AVRに接続"){model.running ? model.stop():model.start()}}
        if !model.running {DisclosureGroup("詳細診断のTLS証明書") {Button("AVR証明書を取得"){model.inspectCertificate()};if !model.fingerprint.isEmpty {Text(model.fingerprint).font(.caption.monospaced()).textSelection(.enabled);Toggle("このAVRの証明書として確認した",isOn:$model.trustCertificate);Button("証明書を固定"){model.approveCertificate()}.disabled(!model.trustCertificate)}}}
        Text(model.status).font(.callout).textSelection(.enabled)
        if model.running {
            Button("ローカル接続トークンをコピー"){model.copyLocalToken()}
            Toggle("HomeKitにサウンドモードスイッチを追加",isOn:$model.homeKitModes).disabled(model.homeKitRunning)
            HStack{Button(model.cloudRunning ? "クラウド操作を停止":"クラウド操作を開始"){model.cloudRunning ? model.stopCloud():model.startCloud(url:cloudURL,key:cloudKey,deviceID:deviceID)};Button(model.homeKitRunning ? "HomeKitを停止":"HomeKitを開始"){model.toggleHomeKit()}}
            if let qr=model.qr {HStack{Image(nsImage:qr).interpolation(.none).frame(width:180,height:180);VStack(alignment:.leading){Text("ホーム → アクセサリを追加");Text(model.setupCode).font(.title.monospaced());Text("同じLANから登録してください").font(.caption)}}}
        }
        if let state=model.state {
            Picker("ゾーン",selection:$model.zone){ForEach(1...3,id:\.self){Text(state.zones["zone\($0)"]?.name ?? "Zone \($0)").tag($0)}}.pickerStyle(.segmented)
            let zone=state.zones["zone\(model.zone)"]
            Text("\(zone?.power ?? "不明") · 音量 \(zone?.volume.map{String(format:"%.1f",$0)} ?? "不明") · \(zone?.source ?? "入力不明")")
            HStack{Button("電源ON"){model.command("power",enabled:true)};Button("電源OFF"){model.command("power",enabled:false)};Button("ミュートON"){model.command("mute",enabled:true)};Button("ミュートOFF"){model.command("mute",enabled:false)}}
            HStack{Button("−"){model.command("volume-down")};Slider(value:$model.volume,in:0...98,step:0.5);Text(String(format:"%.1f",model.volume));Button("音量を適用"){model.command("volume",value:model.volume)};Button("＋"){model.command("volume-up")}}
            HStack{Menu("入力を選択"){ForEach(state.sources.filter(\.enabled),id:\.function){source in Button(source.displayName ?? source.name){model.command("source",name:source.function)}}};Menu("サウンドモード: \(state.surround ?? "不明")"){ForEach(state.modes,id:\.name){mode in Button(mode.name){model.command("surround",name:mode.name)}}}.disabled(model.zone != 1)}
            Text("チャンネル調整（dB）").font(.headline)
            ForEach(state.channels.filter(\.active),id:\.name){channel in HStack{Text(channel.name).frame(width:65,alignment:.leading);Text(channel.value.map{String(format:"%+.1f",Double($0-24)/2)} ?? "不明");Spacer();Button("−0.5"){if let value=channel.value,value>0{model.command("channel-levels",levels:[channel.name:value-1])}};Button("＋0.5"){if let value=channel.value,value<48{model.command("channel-levels",levels:[channel.name:value+1])}}}}
            HStack{Button("全チャンネルを0 dBに戻す"){model.command("reset-channels")};Button("センター +3 dBを保存・適用"){model.preset(restore:false)}.disabled(model.savedPreset != nil);Button("保存値へ復元"){model.preset(restore:true,resolve:resolvePresetConflict)}.disabled(model.savedPreset == nil)}
            if model.savedPreset != nil {Toggle("現在値と保存値の差分を確認し、競合があっても復元する",isOn:$resolvePresetConflict)}
            if let preset=model.savedPreset {Text("保存値: \(preset.before.description) / 適用値: \(preset.applied.description) / \(preset.outcome)").font(.caption)}
            Text("入力信号: \(state.inputSignal.map(\.name).joined(separator:", "))\n有効スピーカー: \(state.activeSpeakers.map(\.name).joined(separator:", "))").textSelection(.enabled)
            HStack{Picker("詳細取得",selection:$model.diagnostic){ForEach(DenonCatalog.shared.commands,id:\.method){Text($0.method).tag($0.method)}};Button("取得"){model.read()};Button("状態JSONを保存"){model.exportState()}}
            HStack{Toggle("HTTPS setupを含める",isOn:$model.includeSetup);Toggle("telnet / UPnP / HEOSを含める",isOn:$model.includeNetwork);Button("詳細スナップショット"){model.snapshot()}}
            if !model.raw.isEmpty {Text(model.raw).font(.system(.caption,design:.monospaced)).textSelection(.enabled)}
        }
    }.padding(24)}}
}
