import Foundation
import AcousticCore
import AcousticTransport
import AppKit

func cli() async throws {
    let args=Array(CommandLine.arguments.dropFirst())
    if args.first=="generate",args.count>=2 {
        let c=SweepConfiguration();try Wave(sampleRate:c.sampleRate,samples:Stimulus(c).samples).encoded().write(to:URL(fileURLWithPath:args[1]));print("Generated a low-level synchronized sweep. No sound was played.");return
    }
    if args.first=="analyze",args.count>=3 {
        let wave=try Wave.read(Data(contentsOf:URL(fileURLWithPath:args[1])))
        let result=Analyzer.analyzeImpulse(wave.samples,sampleRate:wave.sampleRate)
        let data=try jsonData(["version":Analyzer.version,"sampleRate":wave.sampleRate,"response":try jsonObject(result.response),"decay":try jsonObject(result.decay),"waterfall":try jsonObject(result.waterfall),"qualityReasons":result.reasons]);try data.write(to:URL(fileURLWithPath:args[2]));return
    }
    if args.first=="devices" {print(String(data:try jsonData(AudioDevice.all().map{$0.report.merging(["inputChannels":$0.inputChannels]){_,new in new}}),encoding:.utf8)!);return}
    if args.first=="record",args.count>=4 {
        guard let input=AudioDevice.all().first(where:{$0.uid==args[1] && $0.inputChannels>0}),let seconds=Double(args[2]),seconds>0,seconds<=120 else{throw AcousticError.invalid("record requires an input UID and 1–120 seconds")}
        let recorder=NativeInput();try await recorder.start(deviceID:input.id,url:URL(fileURLWithPath:args[3]));try await Task.sleep(for:.seconds(seconds));recorder.stop();if let error=recorder.error{throw AcousticError.invalid(error)};print("Recorded \(recorder.frames) frames at \(recorder.rate) Hz. Import as capture using upload-capture.");return
    }
    if args.first=="verify-backup",args.count>=2 {try verifyBackup(URL(fileURLWithPath:args[1]));print("All backup checksums verified.");return}
    let env=ProcessInfo.processInfo.environment
    if ["pair","worker","backup","upload-capture"].contains(args.first ?? "") {
        let client=try CloudClient(url:env["SUPABASE_URL"] ?? "",key:env["SUPABASE_PUBLISHABLE_KEY"] ?? "")
        if args.first=="pair" {let result=try await client.pair(name:Host.current().localizedName ?? "Mac",kind:"mac");print(String(data:try jsonData(result),encoding:.utf8)!);return}
        if args.first=="worker",args.count>=3 {let cache=URL(fileURLWithPath:args.count>3 ? args[3]:"./acoustic-cache",isDirectory:true);let worker=await MacWorker(client:client,deviceID:args[1],outputUID:args[2],cache:cache,log:{print($0)});await worker.run();return}
        if args.first=="backup",args.count>=3 {try await cloudBackup(client:client,workspace:args[1],destination:URL(fileURLWithPath:args[2],isDirectory:true));print("Caller-visible database rows and audio objects backed up. See manifest scope.");return}
        if args.first=="upload-capture",args.count>=4 {let context=dictionary(try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:args[2])))),wave=try Wave.read(Data(contentsOf:URL(fileURLWithPath:args[3])));try await uploadNativeCapture(client:client,workspace:args[1],context:context,wave:wave);return}
    }
    print("""
    Acoustic Lab
      (no arguments)                            Open Mac companion
      devices                                   Inspect CoreAudio capabilities
      generate <wav>                            Write a 48 kHz ESS + timing markers
      analyze <ir.wav> <analysis.json>            Analyze imported mono IR
      record <input-uid> <seconds> <wav>          Native unprocessed capture (channel 1)
      pair                                      Print expiring pairing code
      worker <device-id> <output-uid> [cache]     Receive commands and analyze jobs
      upload-capture <workspace> <context.json> <wav>
      backup <workspace> <new-directory>         Back up visible rows + audio
      verify-backup <directory>                  Verify every SHA-256
    Cloud commands use SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. Sessions live in Keychain.
    """)
}
func uploadNativeCapture(client:CloudClient,workspace:String,context:[String:Any],wave:Wave) async throws {
    let sessions=try await client.request("/rest/v1/measurement_sessions",method:"POST",body:["workspace_id":workspace,"context":context]) as? [[String:Any]]
    guard let sid=sessions?.first?["id"] as? String else {throw AcousticError.invalid("Cannot create capture session; use owner login or Web-created session")}
    let artifacts=try await client.request("/rest/v1/artifacts",method:"POST",body:["workspace_id":workspace,"session_id":sid,"kind":"capture"]) as? [[String:Any]]
    guard let aid=artifacts?.first?["id"] as? String else {throw AcousticError.invalid("Cannot create capture artifact")}
    var parts=[[String:Any]]()
    for start in stride(from:0,to:wave.samples.count,by:262144) {let end=min(wave.samples.count,start+262144);var bytes=Data();for x in wave.samples[start..<end] {var bit=Float(x).bitPattern.littleEndian;withUnsafeBytes(of:&bit){bytes.append(contentsOf:$0)}};let path="\(workspace)/\(aid)/\(parts.count).f32";try await client.putObject(path,data:bytes);parts.append(["index":parts.count,"path":path,"bytes":bytes.count,"frames":end-start,"sha256":sha256(bytes)])}
    _=try await client.rpc("finalize_artifact",["aid":aid,"info":["schemaVersion":1,"encoding":"float32-le","sampleRate":wave.sampleRate,"frames":wave.samples.count,"parts":parts,"complete":true,"context":context]]);print("Uploaded \(aid); analysis queued.")
}
if CommandLine.arguments.count==1 {MainActor.assumeIsolated {let app=NSApplication.shared;app.setActivationPolicy(.regular);let delegate=CompanionDelegate();app.delegate=delegate;app.run()}}
else {Task {do{try await cli();exit(0)}catch{fputs("\(error.localizedDescription)\n",stderr);exit(1)}};RunLoop.main.run()}
