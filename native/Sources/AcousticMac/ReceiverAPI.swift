import Foundation
import Security
import NIO
import NIOHTTP1
import DenonControl
import AcousticTransport

/// Authenticated loopback only. Hosted clients use Supabase, never this endpoint.
final class ReceiverAPI {
    let controller:ReceiverController
    let receiverID:String
    let token:String
    private let group=MultiThreadedEventLoopGroup(numberOfThreads:1)
    private var channel:Channel?
    var homeKitInfo:(@Sendable () async -> [String:Any])?
    init(controller:ReceiverController,receiverID:String,testToken:String?=nil) throws {
        self.controller=controller;self.receiverID=receiverID
        if let testToken {guard testToken.utf8.count>=32 else{throw DenonError.invalid("Invalid simulator token")};token=testToken}
        else if let data=Keychain.read("avr-loopback"),let token=String(data:data,encoding:.utf8) {self.token=token}
        else {var bytes=[UInt8](repeating:0,count:32);guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)==errSecSuccess else{throw DenonError.invalid("乱数を生成できません")};token=Data(bytes).base64EncodedString();try Keychain.write(Data(token.utf8),account:"avr-loopback")}
    }
    func start() throws {
        channel=try ServerBootstrap(group:group).serverChannelOption(ChannelOptions.backlog,value:16)
            .childChannelInitializer {channel in channel.pipeline.configureHTTPServerPipeline(withErrorHandling:true).flatMap {channel.pipeline.addHandler(ReceiverHTTPHandler(api:self))}}
            .bind(host:"127.0.0.1",port:8765).wait()
    }
    func stop() {try? channel?.close().wait();channel=nil;try? group.syncShutdownGracefully()}
    func authorized(_ value:String?) -> Bool {
        let actual=Array((value ?? "").utf8),expected=Array(("Bearer "+token).utf8)
        guard actual.count==expected.count else{return false};return zip(actual,expected).reduce(UInt8(0)){$0 | ($1.0 ^ $1.1)}==0
    }
    func route(method:HTTPMethod,uri:String,data:Data) async throws -> Any {
        guard let url=URLComponents(string:"http://127.0.0.1"+uri),uri.hasPrefix("/api/"),uri.count<1024 else{throw DenonError.invalid("Invalid path")}
        let path=url.path
        if method == .GET {
            if path=="/api/homekit" {return await homeKitInfo?() ?? ["enabled":false]}
            if path=="/api/receivers" {return [["id":receiverID,"name":"AVR","mac_device_id":"local"]]}
            if path=="/api/catalog" {return try receiverJSON(DenonCatalog.shared)}
            if path=="/api/snapshot" {return try receiverJSON(await controller.diagnosticSnapshot())}
            if path=="/api/capabilities" {return try await controller.deviceInfo()}
            if path=="/api/diagnostic",let query=url.queryItems?.first(where:{$0.name=="method"})?.value {return try receiverJSON(await controller.read(query))}
            let state=await controller.refresh()
            switch path {
            case "/api/receivers/"+receiverID:
                return ["receiver_id":receiverID,"observed_at":ISO8601DateFormatter().string(from:state.observedAt),"received_at":ISO8601DateFormatter().string(from:state.observedAt),"revision":state.revision,"state":try receiverJSON(state),"measurement":try receiverJSON(await controller.measurementStatus()),"preset":try receiverJSON(await controller.preset())]
            case "/api/status":
                func fields(_ method:String,_ names:[String:String])->[String:Any] {names.mapValues {state.details[method]?[$0]?.value as Any? ?? NSNull()}}
                let volumes=state.zones.mapValues {zone -> [String:Any] in ["volume":zone.volume.map{$0-80} as Any? ?? NSNull(),"limit":zone.limit.map{$0-80} as Any? ?? NSNull(),"display_type":zone.displayType as Any? ?? NSNull(),"display_value":zone.displayValue as Any? ?? NSNull()]}
                return ["revision":state.revision,"state":try receiverJSON(state),"friendly_name":state.friendlyName ?? "","power":try receiverJSON(state.zones.mapValues(\.power)),"volume":volumes,"mute":try receiverJSON(state.zones.mapValues(\.muted)),"source":try receiverJSON(state.zones.mapValues(\.source)),"surround_mode":state.surround ?? "","audio":fields("get_audio_info",["input_mode":"inputmode","output":"output","signal":"signal","sound":"sound","sample_rate":"fs"]),"video":fields("get_video_info",["output":"videooutput","hdmi_in":"hdmisigin","hdmi_out":"hdmisigout"]),"input_signal":try receiverJSON(state.inputSignal),"active_speaker":try receiverJSON(state.activeSpeakers)]
            case "/api/sound-modes":return ["genre":state.genre as Any? ?? NSNull(),"modes":try receiverJSON(state.modes)]
            case "/api/sources":return ["sources":state.sources.filter(\.enabled).map{["name":$0.name,"func_name":$0.function,"display_name":$0.displayName ?? $0.name]}]
            case "/api/channel-levels":return ["channels":state.channels.map{["name":$0.name,"active":$0.active,"speaker_type":$0.speakerType as Any? ?? NSNull(),"level":$0.level as Any? ?? NSNull(),"value":$0.value as Any? ?? NSNull()]}]
            default:throw DenonError.invalid("Unknown endpoint")
            }
        }
        guard method == .POST else{throw DenonError.invalid("Unsupported method")}
        var body=dictionary(try JSONSerialization.jsonObject(with:data))
        guard let id=(body["id"] as? String).flatMap(UUID.init(uuidString:)),let revision=body["expectedRevision"] as? String else {throw DenonError.invalid("id and expectedRevision are required")}
        let aliases=["/api/power":"power","/api/volume":"volume","/api/volume/up":"volume-up","/api/volume/down":"volume-down","/api/mute":"mute","/api/source":"source","/api/surround":"surround","/api/channel-levels":"channel-levels"]
        let kind=path=="/api/operation" ? body["kind"] as? String:aliases[path]
        guard let kind else{throw DenonError.invalid("Unknown operation")}
        if body["enabled"] == nil,let state=body["state"] as? String {guard ["on","off","standby"].contains(state) else{throw DenonError.invalid("Use explicit on/off; toggle requires reading the current state")};body["enabled"]=state=="on"}
        body["value"]=body["value"] ?? body["level"];body["name"]=body["name"] ?? body["source"] ?? body["mode"]
        var operation=ReceiverOperation(id:id,expectedRevision:revision,kind:body["reset"] as? Bool==true ? "reset-channels":kind,zone:body["zone"] as? Int ?? 1,enabled:body["enabled"] as? Bool,value:body["value"] as? Double,name:body["name"] as? String,levels:body["levels"] as? [String:Int])
        guard let created=parseDate(body["createdAt"]),let expires=parseDate(body["expiresAt"]) else{throw DenonError.invalid("createdAt and expiresAt are required")}
        guard expires>Date(),expires.timeIntervalSince(created)<=10,created.timeIntervalSinceNow<=2 else{throw DenonError.invalid("Expired operation")}
        switch kind {
        case "read":return ["status":"succeeded","observation":try receiverJSON(await controller.read(body["method"] as? String ?? ""))]
        case "snapshot":let snapshot=try await controller.diagnosticSnapshot();return ["status":snapshot.complete ? "succeeded":"partial","snapshot":try receiverJSON(snapshot)]
        case "center-boost":return try receiverJSON(await controller.applyCenterBoost(id:id,expectedRevision:revision,deadline:expires))
        case "restore-preset":return try receiverJSON(await controller.restorePreset(id:id,expectedRevision:revision,resolveConflicts:body["resolveConflicts"] as? Bool ?? false,deadline:expires))
        case "import-preset":guard let saved=body["saved"] as? [String:Int] else{throw DenonError.invalid("Missing preset")};return try receiverJSON(await controller.importLegacyPreset(id:id,saved:saved,expectedRevision:revision))
        default:break
        }
        operation.createdAt=created;operation.expiresAt=expires
        return try receiverJSON(await controller.execute(operation))
    }
}
private final class ReceiverHTTPHandler:ChannelInboundHandler {
    typealias InboundIn=HTTPServerRequestPart
    typealias OutboundOut=HTTPServerResponsePart
    let api:ReceiverAPI
    var head:HTTPRequestHead?
    var bytes=Data()
    var finished=false
    var corsOrigin:String?
    init(api:ReceiverAPI){self.api=api}
    func channelRead(context:ChannelHandlerContext,data:NIOAny) {
        guard !finished else{return}
        switch unwrapInboundIn(data) {
        case .head(let head):
            guard head.headers["host"].count==1,["127.0.0.1:8765","localhost:8765"].contains(head.headers.first(name:"host") ?? "") else {respond(context,.forbidden,Data());return}
            if let origin=head.headers.first(name:"origin") {
                guard ["http://127.0.0.1:5173","http://localhost:5173","http://127.0.0.1:5187","http://localhost:5187"].contains(origin) else {respond(context,.forbidden,Data());return}
                corsOrigin=origin
            }
            if head.method == .OPTIONS {respond(context,.noContent,Data());return}
            guard api.authorized(head.headers.first(name:"authorization")) else {respond(context,.unauthorized,Data());return}
            self.head=head
        case .body(var buffer):
            guard bytes.count+buffer.readableBytes<=65536 else{respond(context,.payloadTooLarge,Data());return}
            if let data=buffer.readBytes(length:buffer.readableBytes){bytes.append(contentsOf:data)}
        case .end:
            guard let head else{return};finished=true;let body=bytes
            Task {
                let status:HTTPResponseStatus,result:Data
                do {
                    if head.uri=="/api/homekit/qr.svg" {let info=await api.homeKitInfo?();guard let svg=info?["svg"] as? String,!svg.isEmpty else{throw DenonError.invalid("ペアリング用QRは利用できません")};result=Data(svg.utf8)}
                    else {result=try jsonData(await api.route(method:head.method,uri:head.uri,data:body))};status = .ok
                }
                catch {result=(try? jsonData(["error":error.localizedDescription])) ?? Data();status = .conflict}
                context.eventLoop.execute{self.respond(context,status,result)}
            }
        }
    }
    func errorCaught(context:ChannelHandlerContext,error:Error){context.close(promise:nil)}
    private func respond(_ context:ChannelHandlerContext,_ status:HTTPResponseStatus,_ data:Data) {
        finished=true
        var headers=HTTPHeaders([("Content-Type",head?.uri=="/api/homekit/qr.svg" && status == .ok ? "image/svg+xml":"application/json"),("Content-Length",String(data.count)),("Cache-Control","no-store"),("Connection","close")])
        if let corsOrigin {headers.add(name:"Access-Control-Allow-Origin",value:corsOrigin);headers.add(name:"Vary",value:"Origin");headers.add(name:"Access-Control-Allow-Methods",value:"GET, POST, OPTIONS");headers.add(name:"Access-Control-Allow-Headers",value:"Authorization, Content-Type")}
        context.write(wrapOutboundOut(.head(HTTPResponseHead(version:.http1_1,status:status,headers:headers))),promise:nil)
        var buffer=context.channel.allocator.buffer(capacity:data.count);buffer.writeBytes(data)
        context.write(wrapOutboundOut(.body(.byteBuffer(buffer))),promise:nil)
        context.writeAndFlush(wrapOutboundOut(.end(nil))).whenComplete{_ in context.close(promise:nil)}
    }
}
