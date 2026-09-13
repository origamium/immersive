import Foundation
import Darwin

public struct DenonSnapshot:Codable,Sendable {
    public let schemaVersion:Int
    public let startedAt:Date
    public var completedAt:Date
    public var observations:[DenonObservation]
    public var errors:[String:String]
    public var telnet:[String:[String]]?
    public var complete:Bool
}
extension DenonClient {
    public func setup(section:String,type:Int) async throws -> DenonObservation {
        guard DenonCatalog.shared.setupTypes[section]?[String(type)] != nil else {throw DenonError.invalid("未検証またはハング既知のsetup項目です")}
        let data=try await http.request(port:10443,path:"/ajax/\(section)/get_config?type=\(type)",body:nil)
        _ = try XMLNode.parse(data)
        return DenonObservation(method:"setup/\(section)/\(type)",observedAt:Date(),raw:String(decoding:data,as:UTF8.self),parameters:[:])
    }
}
/// Read-only telnet. Only the captured catalog's exact queries are accepted.
/// One socket handles the whole batch; no event is treated as a command acknowledgement.
public enum DenonTelnet {
    public static func read(host:String,queries:[String]) async throws -> [String:[String]] {
        guard !queries.isEmpty,queries.count<=78,queries.allSatisfy({DenonCatalog.shared.queries.contains($0)}) else {throw DenonError.invalid("未登録のtelnet照会です")}
        return try await exchange(host:host,queries:queries,port:23)
    }
    static func exchange(host:String,queries:[String],port:Int) async throws -> [String:[String]] {
        _ = try DenonHTTPTransport(host:host)
        guard [23,1255].contains(port),queries.count<=100 else {throw DenonError.invalid("Invalid TCP diagnostics")}
        return try await Task.detached(priority:.utility) {
            var hints=addrinfo();hints.ai_socktype=SOCK_STREAM;hints.ai_protocol=IPPROTO_TCP
            var addresses:UnsafeMutablePointer<addrinfo>?
            guard getaddrinfo(host,String(port),&hints,&addresses)==0,let first=addresses else {throw DenonError.transport("telnetの宛先を解決できません")}
            defer{freeaddrinfo(first)}
            let fd=socket(first.pointee.ai_family,SOCK_STREAM,0)
            guard fd>=0 else {throw DenonError.transport("telnet socket")};defer{Darwin.close(fd)}
            var noSignal:Int32=1;setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&noSignal,socklen_t(MemoryLayout.size(ofValue:noSignal)))
            _ = fcntl(fd,F_SETFL,O_NONBLOCK)
            let connected=Darwin.connect(fd,first.pointee.ai_addr,first.pointee.ai_addrlen)
            if connected != 0 {
                guard errno==EINPROGRESS else {throw DenonError.transport("telnet接続失敗")}
                var p=pollfd(fd:fd,events:Int16(POLLOUT),revents:0)
                guard poll(&p,1,3000)>0 else {throw DenonError.transport("telnet接続タイムアウト")}
                var error:Int32=0,size=socklen_t(MemoryLayout<Int32>.size)
                getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&size)
                guard error==0 else {throw DenonError.transport("telnet接続失敗")}
            }
            var result:[String:[String]]=[:],total=0
            for query in queries {
                try Task.checkCancellation()
                let bytes=Array((query+(port==1255 ? "\r\n":"\r")).utf8)
                let sent=bytes.withUnsafeBytes{Darwin.send(fd,$0.baseAddress,bytes.count,0)}
                guard sent==bytes.count else {throw DenonError.transport("telnet照会送信失敗")}
                var data=Data(),buffer=[UInt8](repeating:0,count:4096)
                let deadline=Date().addingTimeInterval(1.5)
                while Date()<deadline {
                    var p=pollfd(fd:fd,events:Int16(POLLIN),revents:0)
                    if poll(&p,1,data.isEmpty ? 1000:200)<=0 {break}
                    let count=Darwin.recv(fd,&buffer,buffer.count,0)
                    guard count>0 else {break};data.append(contentsOf:buffer.prefix(count));total+=count
                    guard total<=1024*1024 else {throw DenonError.transport("telnet応答上限")}
                }
                let prefix=query.replacingOccurrences(of:"?",with:"").trimmingCharacters(in:.whitespaces)
                let lines=String(decoding:data,as:UTF8.self).components(separatedBy:.newlines).flatMap{$0.components(separatedBy:"\r")}.filter{!$0.isEmpty}
                result[query]=port==23 ? lines.filter{$0.hasPrefix(prefix)}:lines
                if result[query]?.isEmpty != false {throw DenonError.transport("\(query): 応答なし。残りの照会を停止しました")}
                Thread.sleep(forTimeInterval:0.4)
            }
            return result
        }.value
    }
}
public enum DenonHEOS {
    public static func read(host:String) async throws -> [DenonObservation] {
        var output:[DenonObservation]=[]
        let initial=["heos://system/heart_beat","heos://player/get_players"]
        let replies=try await DenonTelnet.exchange(host:host,queries:initial,port:1255)
        var playerIDs:[Int]=[]
        func append(_ query:String,_ lines:[String]) throws {
            let expected=String(query.dropFirst(7).split(separator:"?")[0])
            guard let line=lines.first(where:{line in
                guard let object=(try? JSONSerialization.jsonObject(with:Data(line.utf8))) as? [String:Any],let heos=object["heos"] as? [String:Any] else{return false}
                return heos["command"] as? String==expected
            }),let object=try JSONSerialization.jsonObject(with:Data(line.utf8)) as? [String:Any],let heos=object["heos"] as? [String:Any],heos["result"] as? String=="success" else {throw DenonError.transport("HEOS \(expected): 成功応答を確認できません")}
            if expected=="player/get_players" {playerIDs=(object["payload"] as? [[String:Any]] ?? []).compactMap{$0["pid"] as? Int}}
            output.append(DenonObservation(method:query,observedAt:Date(),raw:line,parameters:[:]))
        }
        for query in initial {try append(query,replies[query] ?? [])}
        guard playerIDs.count<=16 else {throw DenonError.invalid("Too many HEOS players")}
        for pid in playerIDs {
            let queries=["get_play_state","get_now_playing_media","get_volume","get_mute","get_play_mode"].map{"heos://player/\($0)?pid=\(pid)"}
            let replies=try await DenonTelnet.exchange(host:host,queries:queries,port:1255)
            for query in queries {try append(query,replies[query] ?? [])}
        }
        return output
    }
}
