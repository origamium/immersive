import SwiftUI
import AVKit
import AcousticTransport

@MainActor final class TVEndpoint:ObservableObject {
    @Published var url=UserDefaults.standard.string(forKey:"supabaseURL") ?? ""
    @Published var key=UserDefaults.standard.string(forKey:"supabasePublicKey") ?? ""
    @Published var code=""
    @Published var status="Webアプリでペアリングし、検証済み素材を選択してください。"
    @Published var active=false
    @Published var player:AVPlayer?
    private var deviceID=UserDefaults.standard.string(forKey:"deviceID") ?? ""
    private var task:Task<Void,Never>?
    private var prepared:String?,playing:String?,leaseDeadline=Date.distantPast,preparedUntil=Date.distantPast
    private var watchdog:Timer?
    private var observers=[NSObjectProtocol]()
    private func save() {UserDefaults.standard.set(url,forKey:"supabaseURL");UserDefaults.standard.set(key,forKey:"supabasePublicKey");UserDefaults.standard.set(deviceID,forKey:"deviceID")}
    func pair() {Task{do{let c=try CloudClient(url:url,key:key);let p=try await c.pair(name:"Apple TV 4K",kind:"tv");deviceID=p["deviceId"] as? String ?? "";code=p["code"] as? String ?? "";save();status="接続タブでコードを承認してください。"}catch{status=error.localizedDescription}}}
    func stopPlayback() {player?.pause();player=nil;playing=nil;prepared=nil;leaseDeadline = .distantPast}
    func stop() {task?.cancel();watchdog?.invalidate();watchdog=nil;stopPlayback();active=false;observers.forEach{NotificationCenter.default.removeObserver($0)};observers=[]}
    func start() {
        guard !deviceID.isEmpty else{status="ペアリングが必要です";return};save();active=true
        for name in [AVAudioSession.interruptionNotification,AVAudioSession.routeChangeNotification,UIApplication.didEnterBackgroundNotification] {observers.append(NotificationCenter.default.addObserver(forName:name,object:nil,queue:.main){[weak self] _ in Task{@MainActor in self?.stopPlayback();self?.status="音声経路またはアプリ状態の変化で停止しました"}})}
        watchdog=Timer.scheduledTimer(withTimeInterval:0.1,repeats:true){[weak self] _ in Task{@MainActor in guard let self else{return};if self.playing != nil && Date()>self.leaseDeadline {self.stopPlayback();self.status="通信リース切れで停止"};if self.prepared != nil && self.playing==nil && Date()>self.preparedUntil {self.stopPlayback()}}}
        task=Task {do {let client=try CloudClient(url:url,key:key);var tick=0
            while !Task.isCancelled {
                do {
                    guard let device=try await client.device(deviceID),device["revoked_at"] is NSNull,device["workspace_id"] is String else{stopPlayback();try await Task.sleep(for:.seconds(2));continue}
                    if tick%5==0 {let audio=AVAudioSession.sharedInstance();try await client.heartbeat(deviceID,caps:["schemaVersion":1,"deviceId":deviceID,"name":"Apple TV 4K","platform":"tvOS","requestedRate":NSNull(),"actualRate":audio.sampleRate,"channels":audio.outputNumberOfChannels,"physicalBits":NSNull(),"supportedRates":[],"verification":"api","notes":["\(UIDevice.current.systemVersion)","AVPlayerの音声出力。Atmos表示は14ch分離の証明ではありません。","高さ出力はアセットと接続経路ごとの検証が必要。"]])};tick+=1
                    if let id=playing {let rows=try await client.request("/rest/v1/commands?id=eq.\(id)&select=lease_until") as? [[String:Any]];let remaining=(parseDate(rows?.first?["lease_until"]) ?? .distantPast).timeIntervalSince(await client.serverNow());if remaining<=0 {stopPlayback()}else{leaseDeadline=Date().addingTimeInterval(min(5,remaining))}}
                    for command in try await client.commands(deviceID) {
                        guard let id=command["id"] as? String,let sid=command["session_id"] as? String else{continue}
                        let sessions=try await client.request("/rest/v1/measurement_sessions?id=eq.\(sid)&select=*") as? [[String:Any]]
                        guard let session=sessions?.first,session["generation"] as? Int==command["generation"] as? Int else{continue}
                        do {switch command["action"] as? String {
                        case "prepare":
                            guard playing==nil,session["state"] as? String=="preparing",let aid=dictionary(command["payload"])["assetId"] as? String,!aid.isEmpty else{throw CloudError.message("No stimulus asset or invalid preparation state")}
                            let trial=dictionary(command["payload"])["validationOnly"] as? Bool==true
                            let artifacts=try await client.request("/rest/v1/artifacts?id=eq.\(aid)&select=*") as? [[String:Any]];guard let artifact=artifacts?.first,artifact["kind"] as? String=="stimulus",(artifact["status"] as? String=="verified" || (trial && artifact["status"] as? String=="ready")) else{throw CloudError.message("Stimulus channel mapping has not been verified")}
                            let manifest=dictionary(artifact["manifest"]),context=dictionary(session["context"]),assetContext=dictionary(manifest["context"]),validation=dictionary(manifest["validation"])
                            let expected=dictionary(context["profile"]), encoded=dictionary(assetContext["profile"])
                            guard let speaker=context["speakerId"] as? String,assetContext["speakerId"] as? String==speaker,["sampleRate","sweepSeconds","startHz","endHz","amplitudeDBFS"].allSatisfy({(expected[$0] as? Double)==(encoded[$0] as? Double)}),(assetContext["referenceSpeaker"] as? String)==(context["referenceSpeaker"] as? String) else {throw CloudError.message("Stimulus does not match speaker / sweep profile / timing reference")}
                            if !trial {guard manifest["channelMappingVerified"] as? Bool==true,validation["markersVerified"] as? Bool==true,(validation["speakers"] as? [String])?.contains(speaker)==true else {throw CloudError.message("Stimulus mapping must be validated first")}}

                            let cache=FileManager.default.urls(for:.cachesDirectory,in:.userDomainMask)[0].appendingPathComponent("AcousticLab");let bytes=try await client.readArtifact(artifact,cache:cache.appendingPathComponent("parts"));let ext=URL(fileURLWithPath:manifest["filename"] as? String ?? "asset.mp4").pathExtension.lowercased();guard ["mp4","m4a","mov","ec3"].contains(ext) else{throw CloudError.message("Unsupported AVPlayer asset container")}
                            let file=cache.appendingPathComponent("\(aid).\(ext)");try bytes.write(to:file,options:.atomic)
                            let audio=AVAudioSession.sharedInstance();try audio.setCategory(.playback,mode:.moviePlayback);try audio.setActive(true)
                            let asset=AVURLAsset(url:file);guard try await asset.load(.isPlayable) else{throw CloudError.message("AVPlayer cannot play this asset")}
                            let duration=try await asset.load(.duration).seconds;guard duration>1,duration<90 else{throw CloudError.message("Invalid test asset duration")}
                            player=AVPlayer(playerItem:AVPlayerItem(asset:asset));player?.volume=1;player?.automaticallyWaitsToMinimizeStalling=false;prepared=sid;preparedUntil=Date().addingTimeInterval(25)
                            try await client.ack(id,["ready":true,"duration":duration]);status="素材を検証済み・再生待ち"
                        case "start":
                            guard prepared==sid,playing==nil,session["state"] as? String=="playing" else{throw CloudError.message("No matching prepared asset")}
                            let remaining=(parseDate(command["lease_until"]) ?? .distantPast).timeIntervalSince(await client.serverNow());guard remaining>0 else{throw CloudError.message("Expired start lease")};leaseDeadline=Date().addingTimeInterval(min(5,remaining));playing=id;player?.play();try await client.ack(id,["playing":true]);status="テスト信号を再生中"
                        case "stop":stopPlayback();try await client.ack(id,["stopped":true]);status="停止"
                        default:try await client.ack(id,["error":"Unsupported action"])
                        }}catch{stopPlayback();try? await client.ack(id,["ready":false,"playing":false,"error":error.localizedDescription]);status=error.localizedDescription}
                    }
                }catch{stopPlayback();status=error.localizedDescription}
                try await Task.sleep(for:.seconds(1))
            }
        }catch{status=error.localizedDescription};stopPlayback();active=false}
    }
}
struct TVView:View {
    @StateObject private var model=TVEndpoint()
    var body:some View {VStack(alignment:.leading,spacing:24){Text("IMMERSIVE / ACOUSTIC LAB").font(.caption).foregroundStyle(.mint);Text("Apple TV endpoint").font(.largeTitle);Text("AVC-A110 · 7.1.6 / validated media playback").foregroundStyle(.secondary)
        if !model.active {TextField("Supabase URL",text:$model.url).textInputAutocapitalization(.never).autocorrectionDisabled();SecureField("Publishable key",text:$model.key).textInputAutocapitalization(.never);HStack{Button("ペアリング"){model.pair()};Text(model.code).font(.title.monospaced())}}
        Button(model.active ? "受信・再生を停止":"受信を開始"){if model.active{model.stop()}else{model.start()}}
        Text(model.status).foregroundStyle(.mint)
        Text("高さチャンネルの分離、時間基準マーカー、接続経路を確認した素材だけを再生します。Atmos表示だけでは検証完了になりません。").font(.callout).foregroundStyle(.secondary)
        if let player=model.player {VideoPlayer(player:player).frame(height:160)}
        Spacer()
    }.padding(70).preferredColorScheme(.dark).onDisappear{model.stop()}}
}
@main struct AcousticTVApp:App {var body:some Scene {WindowGroup{TVView()}}}
