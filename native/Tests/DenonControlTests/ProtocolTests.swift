import XCTest
@testable import DenonControl
private struct MalformedReplyAVR:DenonHTTP {
    func request(port:Int,path:String,body:Data?) async throws -> Data {Data("<rx><CMD ERR></rx>".utf8)}
}
final class ProtocolTests:XCTestCase {
    func testFailedDiagnosticRetainsReceivedXML() async throws {
        let controller=try ReceiverController(client:DenonClient(http:MalformedReplyAVR()),journalURL:FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("journal.json"))
        let result=try await controller.diagnosticSnapshot()
        XCTAssertFalse(result.complete)
        XCTAssertFalse(result.errors.isEmpty)
        XCTAssertEqual(result.observations.last?.raw,"<rx><CMD ERR></rx>")
        XCTAssertEqual(result.observations.last?.method,DenonCatalog.shared.commands.first?.method)
    }
    func testArchivedAvconVolumeAndChannelResponses() throws {
        func fixture(_ name:String) throws -> DenonControl.XMLNode {
            let url=try XCTUnwrap(Bundle.module.url(forResource:name,withExtension:"xml",subdirectory:"Fixtures"))
            return try XMLNode.parse(Data(contentsOf:url))
        }
        var state=ReceiverState()
        state.apply("get_all_zone_volume",try fixture("GetAllZoneVolume"))
        XCTAssertEqual(state.zones["zone1"]?.volume,33.5)
        XCTAssertEqual(state.zones["zone1"]?.limit,70)
        XCTAssertEqual(state.zones["zone2"]?.volume,40)
        XCTAssertNil(state.zones["zone3"]?.volume)
        XCTAssertEqual(try DenonCommand.volume(1,XCTUnwrap(state.zones["zone1"]?.volume)).wire(),"MV335")
        state.apply("get_channel_levels",try fixture("GetChLevel"))
        XCTAssertEqual(state.channels.first?.name,"C")
        XCTAssertEqual(state.channels.first?.value,24)
        XCTAssertEqual(state.channels.first?.speakerType,2)
        XCTAssertEqual(state.channels.first?.level,"0.0dB")
        state.apply("get_all_zone_power",try fixture("GetAllZonePowerStatus"))
        XCTAssertEqual(state.zones["zone2"]?.power,"STANDBY")
    }
    func testProtocolEncoding() throws {
        XCTAssertEqual(try DenonCommand.volume(1,45.5).wire(),"MV455")
        XCTAssertEqual(try DenonCommand.volume(3,0).wire(),"Z300")
        XCTAssertEqual(try DenonCommand.channel("C",24).wire(),"CVC 50")
        XCTAssertEqual(try DenonCommand.channel("C",30).wire(),"CVC 53")
        XCTAssertThrowsError(try DenonCommand.volume(1,.nan).wire())
        XCTAssertThrowsError(try DenonCommand.volume(1,12.3).wire())
        XCTAssertThrowsError(try DenonCommand.power(4,true).wire())
        XCTAssertThrowsError(try DenonCommand.source(1,"BD\rPWON").wire())
        XCTAssertThrowsError(try DenonCommand.channel("C",49).wire())
    }
    func testCatalogAndNewlines() throws {
        XCTAssertEqual(DenonCatalog.shared.commands.count,50)
        XCTAssertEqual(DenonCatalog.shared.queries.count,78)
        let q=try DenonCatalog.shared.query("get_audyssey")
        XCTAssertTrue(queryBody(q).contains("\n<cmd id=\"3\">\n"))
        XCTAssertTrue(queryBody(q).contains("audysseylfc"))
        XCTAssertThrowsError(try DenonCatalog.shared.query("arbitrary"))
        XCTAssertNil(DenonCatalog.shared.setupTypes["speakers"]?["15"])
    }
    func testXMLKeepsControlAndRejectsErrors() throws {
        let r=try XMLNode.parse(Data("<rx><cmd><list><param name=\"fs\" control=\"0\">48 kHz   </param></list></cmd></rx>".utf8))
        XCTAssertEqual(r.descendants("param")[0].value,"48 kHz")
        XCTAssertEqual(r.descendants("param")[0].attributes["control"],"0")
        for s in ["<rx/>","<rx><error>3</error></rx>","<rx><CMD ERR></rx>","<!DOCTYPE x><x/>"] {XCTAssertThrowsError(try XMLNode.parse(Data(s.utf8)))}
    }
    func testMissingStateIsNotZero() throws {
        var s=ReceiverState();s.apply("get_all_zone_volume",try XMLNode.parse(Data("<rx><cmd><zone1><volume>-34.5</volume></zone1></cmd></rx>".utf8)))
        XCTAssertEqual(s.zones["zone1"]?.volume,45.5)
        XCTAssertNil(s.zones["zone2"]?.volume)
        let revision=s.revision;s.observedAt=Date(timeIntervalSinceNow:10);XCTAssertEqual(s.revision,revision)
    }
}
