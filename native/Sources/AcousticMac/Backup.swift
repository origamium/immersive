import Foundation
import AcousticTransport

func cloudBackup(client:CloudClient,workspace:String,destination:URL) async throws {
    guard !FileManager.default.fileExists(atPath:destination.path) else {throw CloudError.message("Backup destination must be new")}
    try FileManager.default.createDirectory(at:destination,withIntermediateDirectories:true)
    var files=[String:String]()
    for table in ["workspaces","devices","measurement_sessions","commands","artifacts","analysis_jobs","analysis_results","experiments","project_settings"] {
        var rows=[[String:Any]](),offset=0
        // RLS defines the caller's backup scope. Devices cannot back up owner-only experiments.
        while true {let filter=table=="workspaces" ? "id":"workspace_id";let path:String
            if table=="commands" {let sessions=try await client.request("/rest/v1/measurement_sessions?workspace_id=eq.\(workspace)&select=id") as? [[String:Any]] ?? [];let ids=sessions.compactMap{$0["id"] as? String};if ids.isEmpty {break};path="/rest/v1/commands?session_id=in.(\(ids.joined(separator:",")))&order=id&offset=\(offset)&limit=500"}
            else {path="/rest/v1/\(table)?\(filter)=eq.\(workspace)&order=\(table=="project_settings" ? "workspace_id":"id")&offset=\(offset)&limit=500"}
            let page=try await client.request(path) as? [[String:Any]] ?? [];rows+=page;if page.count<500 {break};offset+=500
        }
        let bytes=try jsonData(rows),name="\(table).json";try bytes.write(to:destination.appendingPathComponent(name),options:.atomic);files[name]=sha256(bytes)
        if table=="artifacts" {for artifact in rows {
            guard artifact["status"] as? String != "uploading" else {continue}
            let parts=dictionary(artifact["manifest"])["parts"] as? [[String:Any]] ?? []
            for part in parts {guard let path=part["path"] as? String,path.hasPrefix(workspace+"/"),!path.contains(".."),let hash=part["sha256"] as? String else {throw CloudError.message("Invalid artifact backup path")};let bytes=try await client.object(path);guard sha256(bytes)==hash else {throw CloudError.message("Backup hash mismatch")};let name="storage/"+path,file=destination.appendingPathComponent(name);try FileManager.default.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true);try bytes.write(to:file,options:.atomic);files[name]=hash}
        }}
    }
    let receivers=try await client.request("/rest/v1/avr_receivers?workspace_id=eq.\(workspace)&select=*&order=id") as? [[String:Any]] ?? []
    let receiverIDs=receivers.compactMap{$0["id"] as? String}
    let receiverBytes=try jsonData(receivers);try receiverBytes.write(to:destination.appendingPathComponent("avr_receivers.json"),options:.atomic);files["avr_receivers.json"]=sha256(receiverBytes)
    for receiverID in receiverIDs {
        for table in ["avr_observations","avr_operations","avr_snapshots"] {
            var rows=[[String:Any]](),offset=0
            while true {
                let order=table=="avr_observations" ? "receiver_id":"id"
                let page=try await client.request("/rest/v1/\(table)?receiver_id=eq.\(receiverID)&order=\(order)&offset=\(offset)&limit=500") as? [[String:Any]] ?? []
                rows+=page;if page.count<500 {break};offset+=500
            }
            let name="\(table)-\(receiverID).json",bytes=try jsonData(rows)
            try bytes.write(to:destination.appendingPathComponent(name),options:.atomic);files[name]=sha256(bytes)
            if table=="avr_snapshots" {for row in rows {
                guard let path=row["raw_path"] as? String,let hash=row["raw_sha256"] as? String else{continue}
                let bytes=try await client.avrObject(path);guard sha256(bytes)==hash else{throw CloudError.message("AVR raw checksum mismatch")}
                let name="avr-private/"+path,file=destination.appendingPathComponent(name);try FileManager.default.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700]);try bytes.write(to:file,options:.atomic);files[name]=hash
            }}
        }
    }
    try jsonData(["schemaVersion":1,"workspace":workspace,"createdAt":ISO8601DateFormatter().string(from:Date()),"scope":"caller-visible rows and finalized storage objects; auth identities and owner-only records require owner backup","hashes":files]).write(to:destination.appendingPathComponent("manifest.json"),options:.atomic)
}
func verifyBackup(_ directory:URL) throws {
    let manifest=dictionary(try JSONSerialization.jsonObject(with:Data(contentsOf:directory.appendingPathComponent("manifest.json"))))
    guard let files=manifest["hashes"] as? [String:String],!files.isEmpty else {throw CloudError.message("Invalid backup manifest")}
    for (path,hash) in files {guard !path.contains(".."),!path.hasPrefix("/"),sha256(try Data(contentsOf:directory.appendingPathComponent(path)))==hash else {throw CloudError.message("Backup verification failed: \(path)")}}
}
