import Foundation
import Security
import CryptoKit

public protocol DenonHTTP:Sendable {
    var simulated:Bool {get}
    func request(port:Int,path:String,body:Data?) async throws -> Data
}
public extension DenonHTTP {var simulated:Bool {false}}
public final class DenonHTTPTransport:NSObject,DenonHTTP,URLSessionDelegate,@unchecked Sendable {
    public let host:String
    private let fingerprint:String?
    private lazy var session:URLSession = {let c=URLSessionConfiguration.ephemeral;c.timeoutIntervalForRequest=5;c.timeoutIntervalForResource=12;return URLSession(configuration:c,delegate:self,delegateQueue:nil)}()
    public init(host:String,certificateFingerprint:String?=nil) throws {
        guard !host.isEmpty,host.count<=253,host.unicodeScalars.allSatisfy({CharacterSet(charactersIn:"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:").contains($0)}) else {throw DenonError.invalid("AVRのホスト名またはIPを入力してください")}
        self.host=host;fingerprint=certificateFingerprint?.lowercased();super.init()
    }
    public func request(port:Int,path:String,body:Data?=nil) async throws -> Data {
        guard [8080,10443,60006].contains(port),path.hasPrefix("/"),!path.contains("..") else {throw DenonError.invalid("Invalid AVR endpoint")}
        var c=URLComponents();c.scheme=port==10443 ? "https":"http";c.host=host;c.port=port
        guard let base=c.url,let u=URL(string:base.absoluteString+path),u.host==host,u.port==port else {throw DenonError.invalid("Invalid AVR URL")}
        var r=URLRequest(url:u);r.httpMethod=body==nil ? "GET":"POST";r.httpBody=body
        if body != nil {r.setValue("text/xml; charset=utf-8",forHTTPHeaderField:"Content-Type")}
        let (data,res)=try await session.data(for:r)
        guard let h=res as? HTTPURLResponse,(200..<300).contains(h.statusCode) else {throw DenonError.transport("AVR HTTP \((res as? HTTPURLResponse)?.statusCode ?? 0)")}
        guard data.count<=4*1024*1024 else {throw DenonError.transport("AVR response too large")};return data
    }
    public func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping (URLRequest?)->Void) {completionHandler(nil)}
    public func urlSession(_ session:URLSession,didReceive challenge:URLAuthenticationChallenge,completionHandler:@escaping(URLSession.AuthChallengeDisposition,URLCredential?)->Void) {
        guard challenge.protectionSpace.host==host,challenge.protectionSpace.port==10443,let trust=challenge.protectionSpace.serverTrust,let chain=SecTrustCopyCertificateChain(trust) as? [SecCertificate],let cert=chain.first else {completionHandler(.performDefaultHandling,nil);return}
        let hash=SHA256.hash(data:SecCertificateCopyData(cert) as Data).map{String(format:"%02x",$0)}.joined()
        guard fingerprint==hash else {completionHandler(.cancelAuthenticationChallenge,nil);return}
        completionHandler(.useCredential,URLCredential(trust:trust))
    }
}
public struct DenonParameter:Codable,Sendable {public let value:String;public let control:Int?}
public struct DenonObservation:Codable,Sendable {
    public let method:String;public let observedAt:Date;public let raw:String
    public let parameters:[String:DenonParameter]
}
/// A received reply remains available even when its XML cannot be interpreted.
public struct DenonReplyError:Error,LocalizedError,Sendable {
    public let observation:DenonObservation
    public let reason:String
    public var errorDescription:String? {reason}
}
public final class DenonClient:Sendable {
    public let http:any DenonHTTP
    public init(http:any DenonHTTP) {self.http=http}
    public func read(_ method:String) async throws -> (XMLNode,DenonObservation) {
        let q=try DenonCatalog.shared.query(method)
        let data=try await http.request(port:8080,path:q.extended ? "/goform/AppCommand0300.xml":"/goform/AppCommand.xml",body:Data(queryBody(q).utf8))
        let root:XMLNode
        do {
            root=try XMLNode.parse(data)
            guard root.name=="rx",let command=root.nodes("cmd").first,!command.children.isEmpty || !command.value.isEmpty else {throw DenonError.transport("AVR returned an empty command response")}
        } catch {
            throw DenonReplyError(observation:DenonObservation(method:method,observedAt:Date(),raw:String(decoding:data,as:UTF8.self),parameters:[:]),reason:error.localizedDescription)
        }
        var parameters:[String:DenonParameter]=[:]
        for p in root.descendants("param") {if let key=p.attributes["name"] {parameters[key]=DenonParameter(value:p.value,control:p.attributes["control"].flatMap(Int.init))}}
        if parameters.isEmpty {
            func collect(_ node:XMLNode,_ path:String) {
                if node.children.isEmpty {parameters[path]=DenonParameter(value:node.value,control:node.attributes["control"].flatMap(Int.init))}
                else {for (index,child) in node.children.enumerated() {collect(child,path+"/"+child.name+"[\(index)]")}}
            }
            for child in root.children {collect(child,child.name)}
        }
        return (root,DenonObservation(method:method,observedAt:Date(),raw:String(decoding:data,as:UTF8.self),parameters:parameters))
    }
    public func device() async throws -> XMLNode {try XMLNode.parse(await http.request(port:8080,path:"/goform/Deviceinfo.xml",body:nil))}
    public func status(zone:Int) async throws -> XMLNode {
        guard (1...3).contains(zone) else {throw DenonError.invalid("Invalid zone")}
        return try XMLNode.parse(await http.request(port:8080,path:zone==1 ? "/goform/formMainZone_MainZoneXmlStatusLite.xml":"/goform/formZone\(zone)_Zone\(zone)XmlStatusLite.xml",body:nil))
    }
    public func send(_ command:DenonCommand) async throws {
        let value=try command.wire()
        let allowed=CharacterSet.alphanumerics.union(CharacterSet(charactersIn:"-._~"))
        guard let encoded=value.addingPercentEncoding(withAllowedCharacters:allowed) else {throw DenonError.invalid("Invalid command")}
        _ = try await http.request(port:8080,path:"/goform/formiPhoneAppDirect.xml?"+encoded,body:nil)
    }
}
public enum DenonCommand:Sendable,Equatable {
    case power(Int,Bool),mute(Int,Bool),volume(Int,Double),volumeStep(Int,Bool),source(Int,String),surround(String),channel(String,Int),resetChannels
    public func wire() throws -> String {
        func zone(_ z:Int) throws {guard (1...3).contains(z) else {throw DenonError.invalid("Invalid zone")}}
        func text(_ s:String) throws {guard !s.isEmpty,s.count<=80,s.unicodeScalars.allSatisfy({$0.value>=32 && $0.value<127}),!s.contains("?"),!s.contains("&"),!s.contains("#") else {throw DenonError.invalid("Invalid command value")}}
        switch self {
        case .power(let z,let on):try zone(z);return z==1 ? (on ? "PWON":"PWSTANDBY"):"Z\(z)"+(on ? "ON":"OFF")
        case .mute(let z,let on):try zone(z);return (z==1 ? "MU":"Z\(z)MU")+(on ? "ON":"OFF")
        case .volume(let z,let v):try zone(z);guard v.isFinite,(0...98).contains(v),(v*2).rounded()==v*2 else {throw DenonError.invalid("音量は0〜98、0.5刻みです")};let n=Int(v*2);return (z==1 ? "MV":"Z\(z)")+String(format:"%02d",n/2)+(n%2==0 ? "":"5")
        case .volumeStep(let z,let up):try zone(z);return (z==1 ? "MV":"Z\(z)")+(up ? "UP":"DOWN")
        case .source(let z,let s):try zone(z);try text(s);return (z==1 ? "SI":"Z\(z)")+s
        case .surround(let s):try text(s);return "MS"+s
        case .channel(let s,let n):try text(s);guard s.allSatisfy({$0.isASCII && ($0.isLetter || $0.isNumber)}),(0...48).contains(n) else {throw DenonError.invalid("Invalid channel / level")};return "CV\(s) \((n+76)/2)"+((n+76)%2==0 ? "":"5")
        case .resetChannels:return "CVZRL"
        }
    }
    public var interruptsMeasurement:Bool {switch self {case .mute(_,true),.power(_,false):return true;default:return false}}
}
/// Retrieves the certificate identity without trusting it or sending setup commands.
public final class DenonCertificateProbe:NSObject,URLSessionDelegate,@unchecked Sendable {
    private let host:String
    private let lock=NSLock()
    private var fingerprint:String?
    private init(host:String){self.host=host}
    public static func inspect(host:String) async throws -> String {
        _ = try DenonHTTPTransport(host:host)
        let probe=DenonCertificateProbe(host:host),configuration=URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest=5;configuration.timeoutIntervalForResource=8
        let session=URLSession(configuration:configuration,delegate:probe,delegateQueue:nil);defer{session.invalidateAndCancel()}
        var components=URLComponents();components.scheme="https";components.host=host;components.port=10443;components.path="/"
        guard let url=components.url else{throw DenonError.invalid("Invalid AVR host")}
        _ = try? await session.data(from:url)
        guard let fingerprint=probe.result() else{throw DenonError.transport("AVR証明書を取得できません")};return fingerprint
    }
    private func result()->String? {lock.lock();defer{lock.unlock()};return fingerprint}
    public func urlSession(_ session:URLSession,didReceive challenge:URLAuthenticationChallenge,completionHandler:@escaping(URLSession.AuthChallengeDisposition,URLCredential?)->Void) {
        if challenge.protectionSpace.host==host,challenge.protectionSpace.port==10443,let trust=challenge.protectionSpace.serverTrust,let chain=SecTrustCopyCertificateChain(trust) as? [SecCertificate],let cert=chain.first {
            let hash=SHA256.hash(data:SecCertificateCopyData(cert) as Data).map{String(format:"%02x",$0)}.joined();lock.lock();fingerprint=hash;lock.unlock()
        }
        completionHandler(.cancelAuthenticationChallenge,nil)
    }
}
