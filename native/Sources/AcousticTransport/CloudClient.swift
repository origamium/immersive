import Foundation
import Security
import CryptoKit

public enum CloudError: LocalizedError { case message(String); public var errorDescription:String? { if case .message(let s)=self{return s};return nil } }
public func jsonData(_ value:Any) throws -> Data {try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys])}
public func dictionary(_ value:Any?) -> [String:Any] {value as? [String:Any] ?? [:]}
public func sha256(_ data:Data)->String {SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()}
public func parseDate(_ value:Any?)->Date? {guard let s=value as? String else{return nil};let format=ISO8601DateFormatter();format.formatOptions=[.withInternetDateTime,.withFractionalSeconds];return format.date(from:s) ?? ISO8601DateFormatter().date(from:s)}
public enum Keychain {
    public static func read(_ account:String)->Data? {var item:CFTypeRef?;let q:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"app.immersive.acoustic",kSecAttrAccount as String:account,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne];return SecItemCopyMatching(q as CFDictionary,&item)==errSecSuccess ? item as? Data:nil}
    public static func write(_ data:Data,account:String) throws {let q:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"app.immersive.acoustic",kSecAttrAccount as String:account];let update=SecItemUpdate(q as CFDictionary,[kSecValueData as String:data] as CFDictionary);if update==errSecItemNotFound {var insert=q;insert[kSecValueData as String]=data;insert[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;let status=SecItemAdd(insert as CFDictionary,nil);if status != errSecSuccess {throw CloudError.message("Keychain write: \(status)")}} else if update != errSecSuccess {throw CloudError.message("Keychain update: \(update)")}}
}
public actor CloudClient {
    public let baseURL:URL; private let key:String; private let account:String; private var auth=[String:Any](); private var serverOffset:Double=0
    public init(url:String,key:String) throws {
        guard let u=URL(string:url),u.host != nil,(u.scheme=="https" || ["localhost","127.0.0.1"].contains(u.host ?? "")),!key.isEmpty,!key.hasPrefix("sb_secret_") else {throw CloudError.message("HTTPS Supabase URL and publishable key are required")}
        let pieces=key.split(separator:".");if pieces.count==3 {var b=String(pieces[1]).replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");while b.count%4 != 0 {b+="="};if let data=Data(base64Encoded:b),let v=try? JSONSerialization.jsonObject(with:data),dictionary(v)["role"] as? String=="service_role" {throw CloudError.message("Do not use a service_role key")}}
        baseURL=u;self.key=key;account="session:"+sha256(Data(url.utf8));if let data=Keychain.read(account),let value=try? JSONSerialization.jsonObject(with:data){auth=dictionary(value)}
    }
    private func send(_ path:String,method:String="GET",body:Any?=nil,token:String?=nil,raw:Data?=nil,contentType:String="application/json") async throws -> Data {
        guard let url=URL(string:baseURL.absoluteString.trimmingCharacters(in:CharacterSet(charactersIn:"/"))+path) else {throw CloudError.message("Invalid API path")}
        var req=URLRequest(url:url,timeoutInterval:15);req.httpMethod=method;req.setValue(key,forHTTPHeaderField:"apikey");req.setValue("Bearer \(token ?? key)",forHTTPHeaderField:"Authorization");req.setValue(contentType,forHTTPHeaderField:"Content-Type");req.setValue("return=representation",forHTTPHeaderField:"Prefer");req.httpBody=try body.map{try jsonData($0)} ?? raw
        let (data,response)=try await URLSession.shared.data(for:req);guard let http=response as? HTTPURLResponse else {throw CloudError.message("No HTTP response")}
        if let date=http.value(forHTTPHeaderField:"Date") {let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.dateFormat="EEE, dd MMM yyyy HH:mm:ss zzz";if let server=f.date(from:date){serverOffset=server.timeIntervalSinceNow}}
        guard (200..<300).contains(http.statusCode) else {let value=(try? JSONSerialization.jsonObject(with:data)).map(dictionary) ?? [:];throw CloudError.message("HTTP \(http.statusCode): \(value["message"] ?? value["msg"] ?? value["error_description"] ?? "request failed")")};return data
    }
    private func token() async throws -> String {
        if let token=auth["access_token"] as? String,let expiry=auth["expires_at"] as? Double,expiry>Date().timeIntervalSince1970+60{return token}
        let refresh=auth["refresh_token"] as? String
        let data=try await send(refresh == nil ? "/auth/v1/signup" : "/auth/v1/token?grant_type=refresh_token",method:"POST",body:refresh.map{["refresh_token":$0]} ?? [:])
        auth=dictionary(try JSONSerialization.jsonObject(with:data));if auth["expires_at"] == nil {auth["expires_at"]=Date().timeIntervalSince1970+(auth["expires_in"] as? Double ?? 3600)}
        guard let token=auth["access_token"] as? String else {throw CloudError.message("Enable anonymous sign-ins in Supabase Auth")};try Keychain.write(jsonData(auth),account:account);return token
    }
    public func request(_ path:String,method:String="GET",body:Any?=nil) async throws -> Any {
        let data=try await send(path,method:method,body:body,token:token());return data.isEmpty ? NSNull():try JSONSerialization.jsonObject(with:data,options:.fragmentsAllowed)
    }
    public func rpc(_ name:String,_ args:[String:Any]) async throws -> Any {try await request("/rest/v1/rpc/\(name)",method:"POST",body:args)}
    public func pair(name:String,kind:String) async throws -> [String:Any] {dictionary(try await rpc("begin_pairing",["device_name":name,"device_kind":kind]))}
    public func serverNow()->Date {Date().addingTimeInterval(serverOffset)}
    public func device(_ id:String) async throws -> [String:Any]? {let rows=try await request("/rest/v1/devices?id=eq.\(id)&select=*") as? [[String:Any]];return rows?.first}
    public func heartbeat(_ id:String,caps:[String:Any]?=nil) async throws {var args:[String:Any]=["d":id];if let caps {args["caps"]=caps};_ = try await rpc("device_heartbeat",args)}
    public func commands(_ id:String) async throws -> [[String:Any]] {let after=ISO8601DateFormatter().string(from:serverNow());return try await request("/rest/v1/commands?target_device_id=eq.\(id)&acknowledged_at=is.null&expires_at=gt.\(after)&order=sequence.asc&limit=100") as? [[String:Any]] ?? []}
    public func ack(_ id:String,_ result:[String:Any]) async throws {_ = try await rpc("ack_command",["cid":id,"response":result])}
    public func object(_ path:String) async throws -> Data {guard !path.contains(".."),!path.hasPrefix("/") else {throw CloudError.message("Invalid object path")};let encoded=path.addingPercentEncoding(withAllowedCharacters:.urlPathAllowed)!;return try await send("/storage/v1/object/authenticated/acoustic-artifacts/\(encoded)",token:token())}
    public func putObject(_ path:String,data:Data) async throws {let encoded=path.addingPercentEncoding(withAllowedCharacters:.urlPathAllowed)!;_ = try await send("/storage/v1/object/acoustic-artifacts/\(encoded)",method:"POST",token:token(),raw:data,contentType:"application/octet-stream")}
    public func readArtifact(_ artifact:[String:Any],cache:URL) async throws -> Data {
        let aid=artifact["id"] as? String ?? "",w=artifact["workspace_id"] as? String ?? "",manifest=dictionary(artifact["manifest"])
        guard manifest["schemaVersion"] as? Int==1,let parts=manifest["parts"] as? [[String:Any]],!parts.isEmpty,parts.count<20000 else {throw CloudError.message("Invalid artifact manifest")}
        try FileManager.default.createDirectory(at:cache,withIntermediateDirectories:true)
        var joined=Data(),seen=Set<String>()
        for (index,part) in parts.enumerated() {
            guard part["index"] as? Int==index,let path=part["path"] as? String,path.hasPrefix("\(w)/\(aid)/"),!path.contains(".."),seen.insert(path).inserted,let hash=part["sha256"] as? String,let count=part["bytes"] as? Int,count>0,count<=50*1024*1024,joined.count+count<=512*1024*1024 else {throw CloudError.message("Artifact part metadata is invalid")}
            let file=cache.appendingPathComponent(sha256(Data(path.utf8)))
            var bytes=(try? Data(contentsOf:file)) ?? Data()
            if bytes.count != count || sha256(bytes) != hash {bytes=try await object(path);guard bytes.count==count,sha256(bytes)==hash else {throw CloudError.message("Artifact checksum mismatch")};try bytes.write(to:file,options:.atomic)}
            joined.append(bytes)
        }
        return joined
    }
}
