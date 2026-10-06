import Foundation
import AcousticCore
import AcousticTransport

func sweepConfig(_ context:[String:Any],rate:Double?=nil)->SweepConfiguration {
    let p=dictionary(context["profile"])
    return SweepConfiguration(sampleRate:rate ?? p["sampleRate"] as? Double ?? 48000,sweepSeconds:p["sweepSeconds"] as? Double ?? 10,startHz:p["startHz"] as? Double ?? 20,endHz:p["endHz"] as? Double ?? 20000,amplitudeDBFS:p["amplitudeDBFS"] as? Double ?? -30)
}
func jsonObject<T:Encodable>(_ value:T) throws -> Any {try JSONSerialization.jsonObject(with:JSONEncoder().encode(value))}
func interpolateCalibration(_ points:[[String:Any]],hz:Double)->Double? {
    let data=points.compactMap{p -> (Double,Double)? in guard let f=p["hz"] as? Double,let db=p["db"] as? Double,f>0,db.isFinite else{return nil};return(f,db)}.sorted{$0.0<$1.0}
    guard let first=data.first,let last=data.last,hz>=first.0,hz<=last.0 else{return nil}
    for i in 1..<data.count where data[i].0>=hz {let a=data[i-1],b=data[i];guard b.0>a.0 else{return nil};return a.1+(b.1-a.1)*log(hz/a.0)/log(b.0/a.0)};return last.1
}
func makeResult(_ dsp:DSPResult,context:[String:Any],session:String,artifact:String?,source:String,sampleRate:Double) throws -> [String:Any] {
    var context=context,reasons=dsp.reasons,response=try jsonObject(dsp.response) as! [[String:Any]]
    let calibration=dictionary(context["calibration"]),points=calibration["points"] as? [[String:Any]] ?? []
    var covered=true
    if source=="sweep",!points.isEmpty {
        for i in response.indices {if let offset=interpolateCalibration(points,hz:response[i]["hz"] as? Double ?? 0) {response[i]["db"]=(response[i]["db"] as? Double ?? 0)-offset} else {covered=false}}
        if !covered {reasons.append("校正ファイルの周波数範囲外を含みます")}
    }
    let processing=dictionary(context["processing"]),processingOff=["echoCancellation","autoGainControl","noiseSuppression"].allSatisfy{processing[$0] as? Bool==false}
    if !processingOff {reasons.append("入力のAGC・ノイズ抑制・エコー除去が停止していることを確認できません")}
    if points.isEmpty {reasons.append("周波数校正なし: 相対評価")}
    let microphone=(context["microphone"] as? String ?? "").uppercased().replacingOccurrences(of:" ",with:"")
    let sm58=context["microphoneProfile"] as? String=="sm58" || microphone.contains("SM58")
    if sm58 {reasons.append("SM58は単一指向性のボーカル用マイク: 向き・ゲインを固定した参考測定。50 Hz未満／15 kHz超は仕様範囲外です。")}
    if calibration["orientation"] as? String=="other" {reasons.append("校正ファイルとマイクの方向を未確認")}
    let reference=context["referenceSpeaker"] as? String
    let unverifiedAsset = dictionary(context["profile"])["route"] as? String=="apple-tv" && dictionary(dictionary(context["profile"])["settings"])["Asset mapping"] as? String != "verified"
    if unverifiedAsset {reasons.append("素材のチャンネル検証モード: 分離を未確認、調整提案は無効")}
    let timing=source=="sweep" && reference != nil && dsp.driftPPM != nil && !unverifiedAsset
    context["timingVerified"]=timing
    if !timing {reasons.append("共通の音響基準がないためチャンネル間の位相・遅延比較は無効")}
    let avrBound=context["avrBinding"] is [String:Any],avrObservation=dictionary(context["avrObservation"])
    let avrInvalid=avrBound && (dictionary(avrObservation["before"])["simulated"] as? Bool == true || avrObservation["interrupted"] as? Bool != false || avrObservation["after"] as? [String:Any] == nil)
    if avrInvalid {reasons.append("AVR条件の検証が未完了または中断しています")}
    if !avrBound {reasons.append("AVR自動条件記録なし: アンプ条件は手動申告です")}
    let invalid=avrInvalid || dsp.clippedSamples>0 || (dsp.snrDB ?? 100)<30 || dsp.response.isEmpty
    let metadataKnown = (context["inputGain"] as? String).map{!$0.isEmpty && $0 != "未確認"} ?? false
    let avrUnknown = (dictionary(avrObservation["before"])["unknownConditions"] as? [String] ?? [])
    if !avrUnknown.isEmpty {reasons.append("AVRに未確認条件があります: "+avrUnknown.joined(separator:" / "))}
    let verified = !sm58 && avrUnknown.isEmpty && !invalid && !unverifiedAsset && source=="sweep" && !points.isEmpty && covered && processingOff && metadataKnown && calibration["orientation"] as? String != "other"
    var display=[[String:Any]]();let strideSize=max(1,dsp.impulse.count/4000)
    for start in stride(from:0,to:dsp.impulse.count,by:strideSize) {let end=min(dsp.impulse.count,start+strideSize);let peak=(start..<end).max{abs(dsp.impulse[$0])<abs(dsp.impulse[$1])}!;display.append(["seconds":Double(peak)/sampleRate+dsp.timeOriginSeconds,"value":dsp.impulse[peak]])}
    let speaker=context["speakerId"] as? String ?? "IR",date=ISO8601DateFormatter().string(from:Date())
    reasons.append("周波数応答は伝達ゲイン。感度校正値だけで絶対SPLへ変換しません。")
    return ["schemaVersion":1,"id":UUID().uuidString.lowercased(),"sessionId":session,"createdAt":date,"version":Analyzer.version,"source":source,"title":"\(speaker) · \(date)","context":context,"response":response,"quality":["level":invalid ? "invalid":verified ? "verified":"relative","reasons":reasons,"snrDB":dsp.snrDB as Any? ?? NSNull(),"clippedSamples":dsp.clippedSamples,"driftPPM":dsp.driftPPM as Any? ?? NSNull()],"impulse":display,"decay":try jsonObject(dsp.decay),"waterfall":try jsonObject(dsp.waterfall),"delaySeconds":timing ? (dsp.delaySeconds as Any? ?? NSNull()):NSNull(),"rawArtifactId":artifact as Any? ?? NSNull()]
}
@MainActor final class MacWorker {
    let client:CloudClient;let deviceID:String;let outputUID:String;let cache:URL;let log:(String)->Void
    private let output=NativeOutput();private var prepared:String?;private var preparedUntil=Date.distantPast;private var playing:String?;private var workspace:String?;private var cancelled=false
    init(client:CloudClient,deviceID:String,outputUID:String,cache:URL,log:@escaping(String)->Void) {self.client=client;self.deviceID=deviceID;self.outputUID=outputUID;self.cache=cache;self.log=log}
    func stop() {cancelled=true;output.stop()}
    func run() async {
        log("受信待機中。音はWebの測定開始操作でのみ再生します。")
        var heartbeats=0
        while !cancelled && !Task.isCancelled {
            do {
                guard let device=try await client.device(deviceID),device["revoked_at"] is NSNull,let w=device["workspace_id"] as? String else {output.stop();playing=nil;try await Task.sleep(for:.seconds(2));continue};workspace=w
                if heartbeats%5==0 {let caps=AudioDevice.all().first{$0.uid==outputUID}?.report;try await client.heartbeat(deviceID,caps:caps)};heartbeats+=1
                if prepared != nil && playing==nil && Date()>preparedUntil {output.stop();prepared=nil}
                if let id=playing {
                    let rows=try await client.request("/rest/v1/commands?id=eq.\(id)&select=lease_until") as? [[String:Any]]
                    let remaining=(parseDate(rows?.first?["lease_until"]) ?? .distantPast).timeIntervalSince(await client.serverNow())
                    if remaining<=0 {output.stop();playing=nil;prepared=nil;log("再生を停止: リース切れ")} else {output.renew(seconds:min(remaining,5))}
                }
                for command in try await client.commands(deviceID) {
                    if cancelled || Task.isCancelled {break}
                    let now=await client.serverNow()
                    guard let id=command["id"] as? String,let sid=command["session_id"] as? String,let expires=parseDate(command["expires_at"]),expires>now else {continue}
                    let rows=try await client.request("/rest/v1/measurement_sessions?id=eq.\(sid)&select=generation,state,context") as? [[String:Any]]
                    guard let session=rows?.first,session["generation"] as? Int==command["generation"] as? Int else{continue}
                    do {
                        switch command["action"] as? String {
                        case "prepare":
                            guard playing==nil,session["state"] as? String=="preparing" else {throw AcousticError.invalid("Session is no longer preparing")}
                            let context=dictionary(session["context"]),speaker=context["speakerId"] as? String ?? "",speakers=dictionary(context["room"])["speakers"] as? [[String:Any]] ?? [],route=dictionary(context["profile"])["route"] as? String ?? ""
                            guard ["mac-usb","mac-hdmi","external"].contains(route),let device=AudioDevice.all().first(where:{$0.uid==outputUID && $0.outputChannels>0}),let channel=speakers.first(where:{$0["id"] as? String==speaker})?["inputChannel"] as? Int else {throw AcousticError.invalid("Output device / speaker mapping is unavailable")}
                            let ref=context["referenceSpeaker"] as? String ?? speaker
                            guard let reference=speakers.first(where:{$0["id"] as? String==ref})?["inputChannel"] as? Int else{throw AcousticError.invalid("Timing reference channel is unavailable")}
                            if route=="mac-usb" && (channel>1 || reference>1) {throw AcousticError.invalid("PMA USB route supports two channels")}
                            try output.prepare(device:device,config:sweepConfig(context),sweepChannel:channel,referenceChannel:reference)
                            prepared=sid;preparedUntil=Date().addingTimeInterval(25);var caps=device.report;caps["requestedRate"]=sweepConfig(context).sampleRate;caps["actualRate"]=output.actualRate;try await client.heartbeat(deviceID,caps:caps)
                            try await client.ack(id,["ready":true,"actualRate":output.actualRate,"deviceUID":device.uid,"channels":device.outputChannels]);log("準備完了: \(speaker), \(output.actualRate) Hz")
                        case "start":
                            guard prepared==sid,session["state"] as? String=="playing",playing==nil else {throw AcousticError.invalid("No matching prepared session")}
                            let remaining=(parseDate(command["lease_until"]) ?? .distantPast).timeIntervalSince(await client.serverNow());guard remaining>0,!cancelled,!Task.isCancelled else{throw AcousticError.invalid("Start lease expired or cancelled")}
                            try output.start(leaseSeconds:min(remaining,5));playing=id;try await client.ack(id,["playing":true]);log("再生中")
                        case "stop":output.stop();playing=nil;prepared=nil;try await client.ack(id,["stopped":true]);log("停止")
                        default:try await client.ack(id,["error":"Unsupported action"])
                        }
                    } catch {output.stop();playing=nil;prepared=nil;try? await client.ack(id,["ready":false,"playing":false,"error":error.localizedDescription]);log(error.localizedDescription)}
                }
                if playing==nil,prepared==nil {try await analyzeNext()}
            } catch {output.stop();playing=nil;prepared=nil;log("通信 / 処理: \(error.localizedDescription)")}
            try? await Task.sleep(for:.seconds(1))
        }
        output.stop();log("ワーカー停止")
    }
    func analyzeNext() async throws {
        guard let job=(try await client.rpc("claim_analysis",["d":deviceID]) as? [[String:Any]])?.first,let jid=job["id"] as? String,let aid=job["artifact_id"] as? String,let sid=job["session_id"] as? String else {return}
        do {
            log("原音を検証・解析中…")
            guard let artifact=(try await client.request("/rest/v1/artifacts?id=eq.\(aid)&select=*") as? [[String:Any]])?.first else {throw AcousticError.invalid("Missing artifact")}
            let manifest=dictionary(artifact["manifest"]),bytes=try await client.readArtifact(artifact,cache:cache.appendingPathComponent("objects"))
            guard manifest["complete"] as? Bool==true else {throw AcousticError.invalid("Interrupted capture")}
            let context=dictionary(manifest["context"]);var wave:Wave
            if manifest["encoding"] as? String=="float32-le" {
                guard let rate=manifest["sampleRate"] as? Double,rate>=8000,rate<=384000,let frames=manifest["frames"] as? Int,frames>0,frames*4==bytes.count else {throw AcousticError.invalid("PCM frame count / sample rate mismatch")}
                let samples=bytes.withUnsafeBytes {raw in (0..<frames).map{Double(Float(bitPattern:UInt32(littleEndian:raw.loadUnaligned(fromByteOffset:$0*4,as:UInt32.self))))}}
                guard samples.allSatisfy(\.isFinite) else {throw AcousticError.invalid("Non-finite PCM")};wave=Wave(sampleRate:rate,samples:samples)
            } else if manifest["encoding"] as? String=="wav" {wave=try Wave.read(bytes)} else {throw AcousticError.invalid("Unsupported recording encoding")}
            let sweep=artifact["kind"] as? String=="capture"
            // Full input is retained; bounded analysis windows prevent corrupt files exhausting memory.
            guard Double(wave.samples.count)/wave.sampleRate<=120 else{throw AcousticError.invalid("Recording exceeds 120 second analysis limit")}
            let capturedWave=wave,configuration=sweepConfig(context,rate:wave.sampleRate)
            let dsp=try await Task.detached(priority:.userInitiated) {sweep ? try Analyzer.analyzeSweep(recording:capturedWave.samples,config:configuration):Analyzer.analyzeImpulse(capturedWave.samples,sampleRate:capturedWave.sampleRate)}.value
            let result=try makeResult(dsp,context:context,session:sid,artifact:aid,source:sweep ? "sweep":"impulse-import",sampleRate:wave.sampleRate)
            try FileManager.default.createDirectory(at:cache.appendingPathComponent("results"),withIntermediateDirectories:true)
            try jsonData(result).write(to:cache.appendingPathComponent("results/\(aid).json"),options:.atomic)
            _=try await client.rpc("finish_analysis",["jid":jid,"result_data":result]);log("解析完了: \(result["title"] ?? "")")
        } catch {_ = try await client.rpc("finish_analysis",["jid":jid,"result_data":NSNull(),"failure":error.localizedDescription]);log("解析を無効として保存: \(error.localizedDescription)")}
    }
}
