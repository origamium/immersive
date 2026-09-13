import Foundation
import AcousticTransport
import DenonControl

func receiverJSON<T:Encodable>(_ value:T) throws -> Any {
    let encoder=JSONEncoder();encoder.dateEncodingStrategy = .iso8601
    return try JSONSerialization.jsonObject(with:encoder.encode(value),options:.fragmentsAllowed)
}
actor ReceiverCloudWorker {
    let cloud:CloudClient
    let controller:ReceiverController
    let receiverID:String
    let deviceID:String
    let name:String
    let host:String
    let directory:URL
    private var inFlight=[String:Task<Void,Never>]()
    let report:@Sendable(String)->Void
    init(cloud:CloudClient,controller:ReceiverController,receiverID:String,deviceID:String,name:String,host:String,directory:URL,report:@escaping @Sendable(String)->Void) {
        self.cloud=cloud;self.controller=controller;self.receiverID=receiverID.lowercased();self.deviceID=deviceID;self.name=name;self.host=host;self.directory=directory;self.report=report
    }
    private func publish(_ state:ReceiverState) async throws {
        _ = try await cloud.rpc("observe_avr",["r":receiverID,"at_time":ISO8601DateFormatter().string(from:state.observedAt),"rev":state.revision,"observation":try receiverJSON(state),"lease":try receiverJSON(await controller.measurementStatus()),"saved_preset":try receiverJSON(await controller.preset())])
    }
    func run() async {
        defer {for task in inFlight.values {task.cancel()};inFlight.removeAll()}
        do {
            _ = try await cloud.rpc("register_avr",["r":receiverID,"d":deviceID,"receiver_name":name])
            try await publish(controller.refresh())
        } catch {report("AVRクラウド登録: \(error.localizedDescription)");return}
        var lastRefresh=Date.distantPast
        while !Task.isCancelled {
            do {
                let now=ISO8601DateFormatter().string(from:await cloud.serverNow())
                let rows=try await cloud.request("/rest/v1/avr_operations?receiver_id=eq.\(receiverID)&completed_at=is.null&expires_at=gt.\(now)&order=created_at.asc&limit=20") as? [[String:Any]] ?? []
                for row in rows {
                    if Task.isCancelled {return}
                    guard let id=row["id"] as? String,inFlight[id] == nil else{continue}
                    inFlight[id]=Task {await self.perform(row);self.inFlight[id]=nil}
                }
                if inFlight.isEmpty && Date().timeIntervalSince(lastRefresh)>5 {
                    // Poll only through the same controller used by local/HomeKit writes.
                    try await publish(controller.refresh());lastRefresh=Date()
                    try await cloud.heartbeat(deviceID)
                }
            } catch {report("AVRクラウド: \(error.localizedDescription)")}
            try? await Task.sleep(for:.seconds(1))
        }
    }
    private func perform(_ row:[String:Any]) async {
        guard let idString=row["id"] as? String,let id=UUID(uuidString:idString) else{return}
        var response:[String:Any]
        do {
            guard let expiry=parseDate(row["expires_at"]),expiry > (await cloud.serverNow()) else {throw DenonError.invalid("expired")}
            let body=dictionary(row["body"]),kind=row["kind"] as? String ?? "",revision=row["expected_revision"] as? String ?? ""
            let deadline=Date().addingTimeInterval(expiry.timeIntervalSince(await cloud.serverNow()))
            switch kind {
            case "measurement-begin":
                guard let s=body["measurementId"] as? String,let measurementID=UUID(uuidString:s) else {throw DenonError.invalid("Missing measurement ID")}
                let lease=try await controller.beginMeasurement(id:measurementID,expectedRevision:revision)
                try await snapshot(lease.before,purpose:"measurement-before",measurementID:measurementID)
                response=["status":"succeeded","measurement":try receiverJSON(lease)]
            case "measurement-renew":
                guard let s=body["measurementId"] as? String,let measurementID=UUID(uuidString:s) else {throw DenonError.invalid("Missing measurement ID")}
                response=["status":"succeeded","measurement":try receiverJSON(await controller.renewMeasurement(id:measurementID))]
            case "measurement-end":
                guard let s=body["measurementId"] as? String,let measurementID=UUID(uuidString:s) else {throw DenonError.invalid("Missing measurement ID")}
                let lease=try await controller.endMeasurement(id:measurementID)
                if let state=lease.after {try await snapshot(state,purpose:"measurement-after",measurementID:measurementID)}
                response=["status":"succeeded","measurement":try receiverJSON(lease)]
            case "import-preset":
                guard let saved=body["saved"] as? [String:Int] else{throw DenonError.invalid("Invalid legacy preset")}
                response=dictionary(try receiverJSON(await controller.importLegacyPreset(id:id,saved:saved,expectedRevision:revision)))
            case "center-boost":response=dictionary(try receiverJSON(await controller.applyCenterBoost(id:id,expectedRevision:revision,deadline:deadline)))
            case "restore-preset":response=dictionary(try receiverJSON(await controller.restorePreset(id:id,expectedRevision:revision,resolveConflicts:body["resolveConflicts"] as? Bool ?? false,deadline:deadline)))
            case "read":
                let result=try await controller.read(body["method"] as? String ?? "")
                response=["status":"succeeded","observation":try receiverJSON(result)]
            case "snapshot":
                let raw=try await controller.diagnosticSnapshot(includeSetup:body["includeSetup"] as? Bool ?? false,telnetHost:body["includeNetwork"] as? Bool==true ? host:nil,includeNetwork:body["includeNetwork"] as? Bool ?? false)
                let state=await controller.refresh(),bytes=try jsonData(receiverJSON(raw)),sid=id.uuidString.lowercased()
                try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
                let file=directory.appendingPathComponent(sid+".json");try bytes.write(to:file,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
                _ = try await cloud.request("/rest/v1/avr_snapshots",method:"POST",body:["id":sid,"receiver_id":receiverID,"purpose":"diagnostic","state":try receiverJSON(state),"revision":state.revision,"raw_path":"\(receiverID)/\(sid).json","raw_sha256":sha256(bytes)])
                try await cloud.putAvrObject(receiverID:receiverID,snapshotID:sid,data:bytes)
                response=["status":raw.complete ? "succeeded":"partial","snapshotId":sid,"state":try receiverJSON(state),"errors":raw.errors]
            default:
                var operation=ReceiverOperation(id:id,expectedRevision:revision,kind:kind,zone:body["zone"] as? Int ?? 1,enabled:body["enabled"] as? Bool,value:body["value"] as? Double,name:body["name"] as? String,levels:body["levels"] as? [String:Int])
                // Convert the server deadline using its observed clock offset.
                let remaining=expiry.timeIntervalSince(await cloud.serverNow())
                operation.expiresAt=Date().addingTimeInterval(remaining);operation.createdAt=operation.expiresAt.addingTimeInterval(-10)
                response=dictionary(try receiverJSON(await controller.execute(operation)))
            }
        } catch {response=["status":"rejected","error":error.localizedDescription]}
        do {_ = try await cloud.rpc("finish_avr_operation",["operation_id":idString,"response":response])}
        catch {report("操作応答を送信できません。保存済み操作IDにより二重実行を防ぎます。")}
        if let state=await controller.latest() {try? await publish(state)}
    }
    @discardableResult private func snapshot(_ state:ReceiverState,purpose:String,measurementID:UUID?=nil) async throws -> String {
        let id=UUID().uuidString
        var body:[String:Any]=["id":id,"receiver_id":receiverID,"purpose":purpose,"state":try receiverJSON(state),"revision":state.revision]
        if let measurementID {body["measurement_id"]=measurementID.uuidString}
        _ = try await cloud.request("/rest/v1/avr_snapshots",method:"POST",body:body);return id
    }
}
