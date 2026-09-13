import Foundation

public struct ReceiverOperation: Codable, Sendable {
    public var id: UUID
    public var createdAt: Date
    public var expiresAt: Date
    public var expectedRevision: String
    public var kind: String
    public var zone: Int
    public var enabled: Bool?
    public var value: Double?
    public var name: String?
    public var levels: [String: Int]?
    public init(id: UUID = UUID(), expectedRevision: String, kind: String, zone: Int = 1,
                enabled: Bool? = nil, value: Double? = nil, name: String? = nil, levels: [String: Int]? = nil,
                now: Date = Date()) {
        self.id=id; createdAt=now; expiresAt=now.addingTimeInterval(10); self.expectedRevision=expectedRevision
        self.kind=kind; self.zone=zone; self.enabled=enabled; self.value=value; self.name=name; self.levels=levels
    }
    public func commands() throws -> [DenonCommand] {
        let result: [DenonCommand]
        switch kind {
        case "power": guard let enabled else { throw DenonError.invalid("Missing power") }; result=[.power(zone,enabled)]
        case "mute": guard let enabled else { throw DenonError.invalid("Missing mute") }; result=[.mute(zone,enabled)]
        case "volume": guard let value else { throw DenonError.invalid("Missing volume") }; result=[.volume(zone,value)]
        case "volume-up": result=[.volumeStep(zone,true)]
        case "volume-down": result=[.volumeStep(zone,false)]
        case "source": guard let name else { throw DenonError.invalid("Missing source") }; result=[.source(zone,name)]
        case "surround": guard let name else { throw DenonError.invalid("Missing mode") }; result=[.surround(name)]
        case "channel-levels": guard let levels, !levels.isEmpty, levels.count<=32 else { throw DenonError.invalid("Missing channel levels") }; result=levels.sorted{$0.key<$1.key}.map{.channel($0.key,$0.value)}
        case "reset-channels": result=[.resetChannels]
        default: throw DenonError.invalid("Unsupported operation: \(kind)")
        }
        for command in result { _ = try command.wire() }; return result
    }
}
public struct ReceiverChange: Codable, Sendable {
    public var command: String
    public var status: String
    public var error: String?
}
public struct ReceiverOutcome: Codable, Sendable {
    public var id: UUID
    public var status: String
    public var completedAt: Date
    public var changes: [ReceiverChange]
    public var state: ReceiverState?
    public var error: String?
}
public struct ReceiverMeasurement: Codable, Sendable {
    public let id: UUID
    public let before: ReceiverState
    public var after: ReceiverState?
    public var expiresAt: Date
    public var interrupted: Bool
    public var reason: String?
}
public struct ReceiverPreset: Codable, Sendable {
    public let id: UUID
    public let createdAt: Date
    public let before: [String:Int]
    public let applied: [String:Int]
    public var outcome: String
}
private struct ReceiverJournal: Codable {
    var outcomes: [String: ReceiverOutcome] = [:]
    var preset: ReceiverPreset?
    var measurements: [String: ReceiverMeasurement]?
}

/// Every caller, including background polling, must use this controller. The explicit
/// gate spans awaits; actor isolation alone would allow HTTP operations to interleave.
public actor ReceiverController {
    public let client: DenonClient
    private let journalURL: URL
    private var journal: ReceiverJournal
    private var occupied=false
    private var waiting: [CheckedContinuation<Void,Never>] = []
    private var current: ReceiverState?
    private var measurement: ReceiverMeasurement?
    private var cancelDiagnostics=false
    private var stopped=false
    public func shutdown() {stopped=true;cancelDiagnostics=true;if measurement != nil {measurement?.interrupted=true;measurement?.reason="AVRサービスを停止しました"}}
    public init(client: DenonClient, journalURL: URL) throws {
        self.client=client; self.journalURL=journalURL
        try FileManager.default.createDirectory(at: journalURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions:0o700])
        if FileManager.default.fileExists(atPath:journalURL.path) {
            journal=try JSONDecoder().decode(ReceiverJournal.self,from:Data(contentsOf:journalURL))
        } else { journal=ReceiverJournal() }
        for key in journal.measurements?.keys.map({$0}) ?? [] where journal.measurements?[key]?.after == nil {
            journal.measurements?[key]?.interrupted=true
            journal.measurements?[key]?.reason="測定中にMacサービスが再起動しました"
        }
        // A crash between durable reservation and acknowledgement is indeterminate.
        // Never resend a possibly executed relative-volume or preset command.
        for key in journal.outcomes.keys where journal.outcomes[key]?.status == "executing" {
            journal.outcomes[key]?.status="unknown"
            journal.outcomes[key]?.error="Macが処理中に再起動しました。再送せず実機状態を確認してください。"
        }
    }
    private func acquire() async {
        if !occupied { occupied=true; return }
        await withCheckedContinuation { waiting.append($0) }
    }
    private func release() {
        if waiting.isEmpty { occupied=false } else { waiting.removeFirst().resume() }
    }
    private func save() throws {
        let data=try JSONEncoder().encode(journal)
        try data.write(to:journalURL,options:[.atomic,.completeFileProtectionUnlessOpen])
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:journalURL.path)
    }
    private func checkMeasurement(_ state: ReceiverState) {
        guard var active=measurement else {return}
        if active.expiresAt<Date() {active.interrupted=true;active.reason="測定ロックのリースが失効しました"}
        if state.measurementRevision != active.before.measurementRevision {
            active.interrupted=true; active.reason="AVR条件の変化または読み取り失敗を検出しました"
        }
        measurement=active
    }
    private func refreshUnlocked() async -> ReceiverState {
        try? expireMeasurement()
        let state=await client.state();current=state;checkMeasurement(state);return state
    }
    public func refresh() async -> ReceiverState {
        await acquire();defer{release()};return await refreshUnlocked()
    }
    public func latest() -> ReceiverState? {current}
    public func preset() -> ReceiverPreset? {journal.preset}
    public func measurementStatus() -> ReceiverMeasurement? {measurement}
    public func deviceInfo() async throws -> [String:Any] {
        await acquire();defer{release()}
        guard measurement == nil else {throw DenonError.busy("測定中は機能カタログを取得できません")}
        return try await client.device().json
    }
    public func read(_ method: String) async throws -> DenonObservation {
        await acquire();defer{release()}
        guard measurement == nil else {throw DenonError.busy("詳細診断は測定終了後に実行してください")}
        return try await client.read(method).1
    }
    public func diagnosticSnapshot(includeSetup:Bool=false,telnetHost:String?=nil,includeNetwork:Bool=false) async throws -> DenonSnapshot {
        await acquire();defer{release()}
        guard measurement == nil else {throw DenonError.busy("測定中は詳細スナップショットを取得できません")}
        cancelDiagnostics=false
        var snapshot=DenonSnapshot(schemaVersion:1,startedAt:Date(),completedAt:Date(),observations:[],errors:[:],complete:false)
        do {
            let data=try await client.http.request(port:8080,path:"/goform/Deviceinfo.xml",body:nil);_ = try XMLNode.parse(data)
            snapshot.observations.append(DenonObservation(method:"device/capabilities",observedAt:Date(),raw:String(decoding:data,as:UTF8.self),parameters:[:]))
            for zone in 1...3 {
                let path=zone==1 ? "/goform/formMainZone_MainZoneXmlStatusLite.xml":"/goform/formZone\(zone)_Zone\(zone)XmlStatusLite.xml"
                let raw=try await client.http.request(port:8080,path:path,body:nil);_ = try XMLNode.parse(raw)
                snapshot.observations.append(DenonObservation(method:"status/zone\(zone)",observedAt:Date(),raw:String(decoding:raw,as:UTF8.self),parameters:[:]))
            }
        } catch {snapshot.errors["device/status"]=error.localizedDescription}
        for query in DenonCatalog.shared.commands {
            if cancelDiagnostics || Task.isCancelled {snapshot.errors["cancelled"]="診断を中断しました";break}
            do {snapshot.observations.append(try await client.read(query.method).1)}
            catch {if let reply=error as? DenonReplyError {snapshot.observations.append(reply.observation)};snapshot.errors[query.method]=error.localizedDescription;break}
            try await Task.sleep(for:.milliseconds(400))
        }
        if includeSetup && snapshot.errors.isEmpty {
            for section in DenonCatalog.shared.setupTypes.keys.sorted() {
                for type in DenonCatalog.shared.setupTypes[section]!.keys.sorted() {
                    if cancelDiagnostics || Task.isCancelled {snapshot.errors["cancelled"]="診断を中断しました";break}
                    do {snapshot.observations.append(try await client.setup(section:section,type:Int(type)!))}
                    catch {snapshot.errors["setup/"+section+"/"+type]=error.localizedDescription;break}
                    try await Task.sleep(for:.milliseconds(400))
                }
                if !snapshot.errors.isEmpty {break}
            }
        }
        if let telnetHost,snapshot.errors.isEmpty,!cancelDiagnostics {
            do {
                snapshot.telnet=[:]
                for query in DenonCatalog.shared.queries {
                    if cancelDiagnostics || Task.isCancelled {throw CancellationError()}
                    let reply=try await DenonTelnet.read(host:telnetHost,queries:[query]);snapshot.telnet?.merge(reply){_,new in new}
                }
            }
            catch {snapshot.errors["telnet"]=error.localizedDescription}
        }
        if includeNetwork && !cancelDiagnostics {
            do {
                let data=try await client.http.request(port:60006,path:"/upnp/desc/aios_device/aios_device.xml",body:nil)
                _ = try XMLNode.parse(data);snapshot.observations.append(DenonObservation(method:"upnp",observedAt:Date(),raw:String(decoding:data,as:UTF8.self),parameters:[:]))
            } catch {snapshot.errors["upnp"]=error.localizedDescription}
            if let telnetHost {do{snapshot.observations+=try await DenonHEOS.read(host:telnetHost)}catch{snapshot.errors["heos"]=error.localizedDescription}}
        }
        snapshot.complete=snapshot.errors.isEmpty;snapshot.completedAt=Date();return snapshot
    }
    private func expireMeasurement() throws {
        if var lease=measurement,lease.expiresAt<Date() {
            lease.interrupted=true;lease.reason="測定ロックのリースが失効しました"
            if journal.measurements == nil {journal.measurements=[:]};journal.measurements?[lease.id.uuidString]=lease
            try save();measurement=nil
        }
    }
    public func beginMeasurement(id: UUID, expectedRevision: String) async throws -> ReceiverMeasurement {
        await acquire();defer{release()}
        try expireMeasurement()
        if let prior=journal.measurements?[id.uuidString] {return prior}
        guard measurement == nil else {throw DenonError.busy("別の測定が実行中です")}
        let state=await refreshUnlocked()
        guard !state.simulated else {throw DenonError.invalid("シミュレーターは実機測定の条件にできません")}
        guard state.errors.isEmpty else {throw DenonError.invalid("AVR条件を完全に読み取れません。エラーを解消するか、手動条件で測定してください")}
        guard state.revision==expectedRevision else {throw DenonError.stale("AVR条件が変わりました。更新して測定を開始してください")}
        let lease=ReceiverMeasurement(id:id,before:state,expiresAt:Date().addingTimeInterval(15),interrupted:false)
        if journal.measurements == nil {journal.measurements=[:]};journal.measurements?[id.uuidString]=lease;try save()
        measurement=lease;return lease
    }
    public func renewMeasurement(id: UUID) throws -> ReceiverMeasurement {
        guard var lease=measurement,lease.id==id else {throw DenonError.invalid("測定ロックがありません")}
        if lease.expiresAt<Date() {lease.interrupted=true;lease.reason="測定ロックのリースが失効しました"}
        guard !lease.interrupted else {measurement=lease;throw DenonError.busy(lease.reason ?? "測定中断")}
        lease.expiresAt=Date().addingTimeInterval(15);measurement=lease;return lease
    }
    public func endMeasurement(id: UUID) async throws -> ReceiverMeasurement {
        await acquire();defer{release()}
        if measurement?.id != id,let prior=journal.measurements?[id.uuidString] {return prior}
        guard measurement?.id==id else {throw DenonError.invalid("測定ロックがありません")}
        let state=await refreshUnlocked()
        var lease=measurement!;lease.after=state;
        journal.measurements?[id.uuidString]=lease;try save();measurement=nil;return lease
    }
    public func execute(_ operation: ReceiverOperation) async throws -> ReceiverOutcome {
        if (try? operation.commands().allSatisfy(\.interruptsMeasurement)) == true {cancelDiagnostics=true}
        await acquire();defer{release()};try expireMeasurement();return try await executeUnlocked(operation)
    }
    private func executeUnlocked(_ operation: ReceiverOperation) async throws -> ReceiverOutcome {
        try Task.checkCancellation()
        guard !stopped else {throw DenonError.busy("AVRサービスは停止しています")}
        if let prior=journal.outcomes[operation.id.uuidString] {return prior}
        let commands=try operation.commands()
        let emergency=commands.allSatisfy(\.interruptsMeasurement)
        guard operation.expiresAt>Date(),operation.expiresAt.timeIntervalSince(operation.createdAt)<=10,
              operation.createdAt.timeIntervalSinceNow<=2 else {throw DenonError.invalid("操作期限が切れました。操作は再送されません")}
        if measurement != nil && !emergency {throw DenonError.busy("測定中は条件を変更できません。ミュートON・電源OFFは可能です")}
        let before=await refreshUnlocked()
        guard emergency || before.errors.isEmpty else {throw DenonError.invalid("AVR条件を読み取れないため操作を中止しました")}
        guard emergency || before.revision==operation.expectedRevision else {throw DenonError.stale("他の操作で状態が変わりました。更新してください")}
        // Reads can take time. The deadline is checked again immediately before sending.
        guard operation.expiresAt>Date() else {throw DenonError.invalid("状態確認中に操作期限が切れました")}
        for command in commands {
            switch command {
            case .source(_,let name): guard before.sources.contains(where:{$0.enabled && $0.function==name}) else {throw DenonError.invalid("利用できない入力です")}
            case .surround(let name): guard before.modes.contains(where:{$0.name==name}) else {throw DenonError.invalid("利用できないサウンドモードです")}
            case .channel(let name,_): guard before.channels.contains(where:{$0.active && $0.name==name && $0.value != nil}) else {throw DenonError.invalid("利用できないチャンネルです")}
            case .volume(let zone,let value): if let limit=before.zones["zone\(zone)"]?.limit, value>limit {throw DenonError.invalid("AVRの音量上限を超えます")}
            default:break
            }
        }
        var outcome=ReceiverOutcome(id:operation.id,status:"executing",completedAt:Date(),changes:[],state:before)
        journal.outcomes[operation.id.uuidString]=outcome;try save()
        if emergency,measurement != nil {measurement?.interrupted=true;measurement?.reason="停止操作により測定を中断しました"}
        for command in commands {
            do {
                try Task.checkCancellation()
                guard !stopped else {throw DenonError.busy("AVRサービスは停止しています")}
                try await client.send(command)
                outcome.changes.append(ReceiverChange(command:try command.wire(),status:"sent"))
            } catch {
                outcome.changes.append(ReceiverChange(command:(try? command.wire()) ?? "invalid",status:"unknown",error:error.localizedDescription))
                break // Unknown execution must never be automatically retried.
            }
        }
        let after=await refreshUnlocked();outcome.state=after;outcome.completedAt=Date()
        for index in outcome.changes.indices where outcome.changes[index].status=="sent" {
            outcome.changes[index].status=verify(commands[index],before:before,after:after) ? "verified":"unknown"
        }
        outcome.status=outcome.changes.count==commands.count && outcome.changes.allSatisfy{$0.status=="verified"} ? "succeeded" : (outcome.changes.contains{$0.status=="verified"} ? "partial":"unknown")
        journal.outcomes[operation.id.uuidString]=outcome;try save();return outcome
    }
    private func verify(_ command: DenonCommand, before: ReceiverState, after: ReceiverState) -> Bool {
        switch command {
        case .power(let z,let enabled):return after.zones["zone\(z)"]?.power==(enabled ? "ON":"STANDBY")
        case .mute(let z,let enabled):return after.zones["zone\(z)"]?.muted==enabled
        case .volume(let z,let value):return after.zones["zone\(z)"]?.volume==value
        case .volumeStep(let z,let up):guard let old=before.zones["zone\(z)"]?.volume,let new=after.zones["zone\(z)"]?.volume else{return false};return up ? new>old:new<old
        case .source(let z,let name):return after.zones["zone\(z)"]?.source==name
        case .surround(let name):return after.surround==name || after.modes.contains{$0.name==name && $0.selected}
        case .channel(let name,let value):return after.channels.first{$0.name==name}?.value==value
        case .resetChannels:return !after.channels.isEmpty && after.channels.filter(\.active).allSatisfy{$0.value==24}
        }
    }
    public func importLegacyPreset(id:UUID,saved:[String:Int],expectedRevision:String) async throws -> ReceiverOutcome {
        await acquire();defer{release()}
        if let prior=journal.outcomes[id.uuidString] {return prior}
        guard !stopped,measurement == nil,journal.preset == nil,saved.count==1,let center=saved["C"],(0...48).contains(center) else{throw DenonError.invalid("旧プリセットは v1 の保存済みC値のみ取り込めます。現在のプリセットを先に解決してください")}
        let state=await refreshUnlocked();guard state.revision==expectedRevision else{throw DenonError.stale("AVR条件が変わりました")}
        journal.preset=ReceiverPreset(id:id,createdAt:Date(),before:saved,applied:["C":min(48,center+6)],outcome:"imported-unverified")
        let result=ReceiverOutcome(id:id,status:"imported",completedAt:Date(),changes:[],state:state)
        journal.outcomes[id.uuidString]=result;try save();return result
    }
    public func applyCenterBoost(id: UUID, expectedRevision: String, deadline: Date = Date().addingTimeInterval(10)) async throws -> ReceiverOutcome {
        await acquire();defer{release()}
        if let prior=journal.outcomes[id.uuidString] {return prior}
        guard journal.preset == nil else {throw DenonError.busy("保存済みのプリセットを先に復元してください")}
        let state=await refreshUnlocked()
        guard state.revision==expectedRevision,let center=state.channels.first(where:{$0.name=="C" && $0.active})?.value,center<=42 else {throw DenonError.invalid("現在のセンターレベルを確認してください。+3 dBで上限を超える場合は適用できません")}
        journal.preset=ReceiverPreset(id:id,createdAt:Date(),before:["C":center],applied:["C":center+6],outcome:"pending");try save()
        do {
            var operation=ReceiverOperation(id:id,expectedRevision:expectedRevision,kind:"channel-levels",levels:["C":center+6]);operation.expiresAt=deadline;operation.createdAt=deadline.addingTimeInterval(-10)
            let result=try await executeUnlocked(operation)
            journal.preset?.outcome=result.status;try save();return result
        } catch {journal.preset?.outcome="not-applied";try save();throw error}
    }
    public func restorePreset(id: UUID, expectedRevision: String, resolveConflicts: Bool = false, deadline: Date = Date().addingTimeInterval(10)) async throws -> ReceiverOutcome {
        await acquire();defer{release()}
        if let prior=journal.outcomes[id.uuidString] {return prior}
        guard let preset=journal.preset else {throw DenonError.invalid("復元するプリセットがありません")}
        let state=await refreshUnlocked()
        let conflicts=preset.applied.filter{key,value in state.channels.first{$0.name==key}?.value != value}
        guard conflicts.isEmpty || resolveConflicts else {throw DenonError.stale("プリセット適用後に変更されています。現在値と保存値を比較して復元を承認してください")}
        var operation=ReceiverOperation(id:id,expectedRevision:expectedRevision,kind:"channel-levels",levels:preset.before);operation.expiresAt=deadline;operation.createdAt=deadline.addingTimeInterval(-10)
        let result=try await executeUnlocked(operation)
        if result.status=="succeeded" {journal.preset=nil;try save()};return result
    }
}
