import Foundation
import CryptoKit

public struct ReceiverZone:Codable,Sendable {
    // volume and limit use the absolute 0–98 command scale; raw dB remains in details.
    public var power:String?;public var volume:Double?;public var limit:Double?;public var muted:Bool?;public var source:String?;public var name:String?;public var displayType:String?;public var displayValue:String?
}
public struct ReceiverChannel:Codable,Sendable {public let name:String;public let active:Bool;public let value:Int?;public let speakerType:Int?;public var level:String?}
public struct ReceiverSource:Codable,Sendable {public let name:String;public let function:String;public let enabled:Bool;public var displayName:String?}
public struct ReceiverMode:Codable,Sendable {public let name:String;public let selected:Bool;public var number:Int?}
public struct ReceiverIndicator:Codable,Sendable {public let name:String;public let control:Int?}
public struct ReceiverState:Codable,Sendable {
    public var schemaVersion=1
    public var simulated=false
    public var observedAt=Date()
    public var unknownConditions=["アンプ割当て・距離・クロスオーバー・スピーカー構成（HTTPS setupの別途確認が必要）", "AVR内部の実際の信号経路・実出音（測定で確認）"]
    public var zones:[String:ReceiverZone]=[:]
    public var channels:[ReceiverChannel]=[]
    public var sources:[ReceiverSource]=[]
    public var modes:[ReceiverMode]=[]
    public var genre:String?
    public var surround:String?
    public var friendlyName:String?
    public var inputSignal:[ReceiverIndicator]=[]
    public var activeSpeakers:[ReceiverIndicator]=[]
    public var details:[String:[String:DenonParameter]]=[:]
    public var errors:[String:String]=[:]
    public var revision:String {
        var copy=self;copy.observedAt=Date(timeIntervalSince1970:0)
        let e=JSONEncoder();e.outputFormatting=[.sortedKeys]
        return (try? e.encode(copy)).map{SHA256.hash(data:$0).map{String(format:"%02x",$0)}.joined()} ?? "invalid"
    }
    public var measurementRevision:String {
        let e=JSONEncoder();e.outputFormatting=[.sortedKeys]
        struct Settings:Encodable {let zones:[String:ReceiverZone];let channels:[ReceiverChannel];let surround:String?;let details:[String:[String:DenonParameter]];let errors:[String:String]}
        let s=Settings(zones:zones,channels:channels,surround:surround,details:details.filter{["get_audyssey","get_surround_parameter","get_audio_delay","get_bass_sync","get_tone_control"].contains($0.key)},errors:errors)
        return (try? e.encode(s)).map{SHA256.hash(data:$0).map{String(format:"%02x",$0)}.joined()} ?? "invalid"
    }
    public mutating func apply(_ method:String,_ root:XMLNode) {
        let cmd=root.nodes("cmd").first ?? root
        switch method {
        case "get_all_zone_power","get_all_zone_source","get_all_zone_volume","get_all_zone_mute","get_zone_name":
            for z in 1...3 {
                let key="zone\(z)";var zone=zones[key] ?? ReceiverZone()
                let v=cmd.string(key)
                switch method {
                case "get_all_zone_power":zone.power=v.isEmpty ? nil:(v=="OFF" ? "STANDBY":v)
                case "get_all_zone_source":let s=cmd.string(key+"/source");zone.source=s.isEmpty ? nil:s
                case "get_all_zone_mute":zone.muted=v.isEmpty ? nil:v.lowercased()=="on"
                case "get_zone_name":zone.name=v.isEmpty ? nil:v
                default:zone.volume=Double(cmd.string(key+"/volume")).map{$0+80};zone.limit=Double(cmd.string(key+"/limit")).map{$0+80};zone.displayType=cmd.string(key+"/disptype");zone.displayValue=cmd.string(key+"/dispvalue")
                };zones[key]=zone
            }
        case "get_channel_levels":channels=cmd.nodes("chlists/ch").map{ReceiverChannel(name:$0.string("name"),active:$0.string("status")=="1",value:Int($0.string("value")),speakerType:Int($0.string("sptype")),level:$0.string("level"))}
        case "get_deleted_sources":sources=cmd.nodes("functiondelete/list").map{ReceiverSource(name:$0.string("name"),function:$0.string("FuncName"),enabled:$0.string("use")=="1")}
        case "get_rename_source":
            let rename=Dictionary(cmd.nodes("functionrename/list").map{($0.string("name"),$0.string("rename"))},uniquingKeysWith:{$1})
            sources=sources.map {var source=$0;source.displayName=rename[source.name];return source}
        case "get_sound_mode_list":genre=root.descendants("param").first{$0.attributes["name"]=="genrelist"}?.value;modes=root.nodes("cmd/list/list/value").map{ReceiverMode(name:$0.string("dispname"),selected:$0.string("selected")=="1",number:Int($0.string("listno")))}
        case "get_surround_mode":surround=cmd.string("surround")
        case "get_friendly_name":friendlyName=cmd.string("friendlyname")
        case "get_input_signal","get_active_speaker":
            let a=root.descendants("param").filter{!$0.value.isEmpty}.map{ReceiverIndicator(name:$0.value,control:$0.attributes["control"].flatMap(Int.init))}
            if method=="get_input_signal"{inputSignal=a}else{activeSpeakers=a}
        default:break
        }
    }
}
extension DenonClient {
    public static let statusMethods=["get_all_zone_power","get_all_zone_volume","get_all_zone_mute","get_all_zone_source","get_surround_mode","get_channel_levels","get_audio_info","get_video_info","get_input_signal","get_active_speaker","get_friendly_name","get_zone_name","get_deleted_sources","get_rename_source","get_sound_mode_list","get_audyssey","get_surround_parameter","get_audio_delay","get_bass_sync","get_tone_control"]
    public func state() async -> ReceiverState {
        var state=ReceiverState();state.simulated=http.simulated
        for method in Self.statusMethods {
            do {let (root,observation)=try await read(method);state.apply(method,root);state.details[method]=observation.parameters}
            catch {state.errors[method]=error.localizedDescription}
        }
        state.observedAt=Date();return state
    }
}
