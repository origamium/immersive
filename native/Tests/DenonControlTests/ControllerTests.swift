import XCTest
@testable import DenonControl

actor FakeAVR:DenonHTTP {
    var volume=40.0, center=24
    var muted=false, drop=false
    var writes:[String]=[]
    var concurrent=0, maximum=0
    func loseNextReply() {drop=true}
    func remoteCenter(_ value:Int) {center=value}
    func request(port:Int,path:String,body:Data?) async throws -> Data {
        concurrent+=1;maximum=max(maximum,concurrent);defer{concurrent-=1}
        try await Task.sleep(for:.milliseconds(1))
        if path.contains("formiPhoneAppDirect") {
            let wire=String(path.split(separator:"?",maxSplits:1)[1]).removingPercentEncoding!
            writes.append(wire)
            if wire=="MVUP" {volume+=0.5}
            if wire=="MVDOWN" {volume-=0.5}
            if wire=="MUON" {muted=true}
            if wire.hasPrefix("CVC "),let value=Double(wire.dropFirst(4)) {center=Int(value*2)-76}
            if drop {drop=false;throw URLError(.networkConnectionLost)}
            return Data()
        }
        let query=String(decoding:body ?? Data(),as:UTF8.self)
        let content:String
        if query.contains("GetAllZoneVolume") {content=(1...3).map{"<zone\($0)><volume>\(volume-80)</volume><limit>18</limit></zone\($0)>"}.joined()}
        else if query.contains("GetAllZonePowerStatus") {content="<zone1>ON</zone1><zone2>STANDBY</zone2><zone3>STANDBY</zone3>"}
        else if query.contains("GetAllZoneMuteStatus") {content="<zone1>\(muted ? "on":"off")</zone1><zone2>off</zone2><zone3>off</zone3>"}
        else if query.contains("GetChLevel") {content="<chlists><ch><name>C</name><status>1</status><value>\(center)</value><sptype>0</sptype></ch></chlists>"}
        else if query.contains("GetDeletedSource") {content="<functiondelete><list><name>CD</name><FuncName>CD</FuncName><use>1</use></list></functiondelete>"}
        else if query.contains("GetAllZoneSource") {content="<zone1><source>CD</source></zone1>"}
        else {content="<list><param name=\"test\" control=\"0\">stable</param></list>"}
        return Data("<rx><cmd>\(content)</cmd></rx>".utf8)
    }
}
final class ControllerTests:XCTestCase {
    func make(_ fake:FakeAVR) throws -> (ReceiverController,URL) {
        let url=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("journal.json")
        return (try ReceiverController(client:DenonClient(http:fake),journalURL:url),url)
    }
    func testSerialGateSpansAwaitsAndDeduplicatesAfterRestart() async throws {
        let fake=FakeAVR(),(controller,url)=try make(fake)
        let state=await controller.refresh()
        let operation=ReceiverOperation(expectedRevision:state.revision,kind:"volume-up")
        async let result=controller.execute(operation)
        async let reading=controller.refresh()
        let outcome=try await result;_ = await reading
        XCTAssertEqual(outcome.status,"succeeded")
        let peak=await fake.maximum;XCTAssertEqual(peak,1)
        let restored=try ReceiverController(client:DenonClient(http:fake),journalURL:url)
        let prior=try await restored.execute(operation);XCTAssertEqual(prior.status,"succeeded")
        let writes=await fake.writes;XCTAssertEqual(writes,["MVUP"])
    }
    func testUnknownReplyNeverReplaysRelativeVolume() async throws {
        let fake=FakeAVR(),(controller,_)=try make(fake)
        let state=await controller.refresh();await fake.loseNextReply()
        let operation=ReceiverOperation(expectedRevision:state.revision,kind:"volume-up")
        let first=try await controller.execute(operation);XCTAssertEqual(first.status,"unknown")
        _ = try await controller.execute(operation)
        let writes=await fake.writes;XCTAssertEqual(writes.count,1)
    }
    func testMeasurementBlocksChangesButAllowsEmergencyAndRecordsInterruption() async throws {
        let fake=FakeAVR(),(controller,_)=try make(fake)
        let state=await controller.refresh(),id=UUID()
        _ = try await controller.beginMeasurement(id:id,expectedRevision:state.revision)
        do {_ = try await controller.execute(ReceiverOperation(expectedRevision:state.revision,kind:"volume-up"));XCTFail("measurement allowed write")}catch{}
        _ = try await controller.execute(ReceiverOperation(expectedRevision:state.revision,kind:"mute",enabled:true))
        let lease=try await controller.endMeasurement(id:id);XCTAssertTrue(lease.interrupted);XCTAssertNotNil(lease.after)
        let duplicate=try await controller.endMeasurement(id:id);XCTAssertEqual(duplicate.id,id)
    }
    func testPhysicalRemoteChangeInterruptsMeasurement() async throws {
        let fake=FakeAVR(),(controller,_)=try make(fake)
        let state=await controller.refresh(),id=UUID()
        _ = try await controller.beginMeasurement(id:id,expectedRevision:state.revision)
        await fake.remoteCenter(26);_ = await controller.refresh()
        let lease=try await controller.endMeasurement(id:id);XCTAssertTrue(lease.interrupted)
    }
    func testExpiredAndStaleCommandsDoNotSend() async throws {
        let fake=FakeAVR(),(controller,_)=try make(fake)
        let state=await controller.refresh()
        for operation in [ReceiverOperation(expectedRevision:state.revision,kind:"volume-up",now:Date().addingTimeInterval(-20)),ReceiverOperation(expectedRevision:"wrong",kind:"volume-up")] {
            do {_ = try await controller.execute(operation);XCTFail("invalid operation sent")}catch{}
        }
        let writes=await fake.writes;XCTAssertTrue(writes.isEmpty)
    }
    func testPresetRestoresExactValueAndDetectsConflict() async throws {
        let fake=FakeAVR(),(controller,_)=try make(fake)
        await fake.remoteCenter(20)
        let state=await controller.refresh()
        let applied=try await controller.applyCenterBoost(id:UUID(),expectedRevision:state.revision);XCTAssertEqual(applied.status,"succeeded")
        await fake.remoteCenter(28)
        let changed=await controller.refresh()
        do {_ = try await controller.restorePreset(id:UUID(),expectedRevision:changed.revision);XCTFail("overwrote physical change")}catch{}
        let result=try await controller.restorePreset(id:UUID(),expectedRevision:changed.revision,resolveConflicts:true)
        XCTAssertEqual(result.status,"succeeded")
        let center=await fake.center;XCTAssertEqual(center,20)
    }
    func testPresetCannotExtendExpiredCallerDeadline() async throws {
        let fake=FakeAVR(),(controller,_)=try make(fake)
        let state=await controller.refresh()
        do {
            _ = try await controller.applyCenterBoost(id:UUID(),expectedRevision:state.revision,deadline:Date().addingTimeInterval(-1))
            XCTFail("expired preset executed")
        } catch {}
        let writes=await fake.writes;XCTAssertTrue(writes.isEmpty)
    }
}
