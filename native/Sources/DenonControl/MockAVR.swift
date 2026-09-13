import Foundation

/// Explicit offline simulator. Its observations cannot be used as measured AVR evidence.
public actor MockAVR:DenonHTTP {
    public nonisolated var simulated:Bool {true}
    private var volumes=[1:40.0,2:30,3:30],powers=[1:true,2:false,3:false],mutes=[1:false,2:false,3:false]
    private var sources=[1:"CD",2:"CD",3:"CD"],surround="STEREO"
    private var channels=Dictionary(uniqueKeysWithValues:["FL","FR","C","SL","SR","SBL","SBR","FHL","FHR","TML","TMR","RHL","RHR","SW"].map{($0,24)})
    public init() {}
    public func request(port:Int,path:String,body:Data?) async throws -> Data {
        guard port==8080 else {throw DenonError.invalid("Simulator has no setup/telnet/UPnP/HEOS")}
        if path.contains("formiPhoneAppDirect.xml?") {
            let command=String(path.split(separator:"?",maxSplits:1)[1]).removingPercentEncoding ?? ""
            let zone=command.hasPrefix("Z2") ? 2:command.hasPrefix("Z3") ? 3:1
            let value=zone==1 ? command:String(command.dropFirst(2))
            if command=="PWON" || (zone>1 && value=="ON") {powers[zone]=true}
            else if command=="PWSTANDBY" || (zone>1 && value=="OFF") {powers[zone]=false}
            else if value=="MUON" {mutes[zone]=true}
            else if value=="MUOFF" {mutes[zone]=false}
            else if command=="CVZRL" {channels=channels.mapValues{_ in 24}}
            else if command.hasPrefix("CV") {let parts=command.dropFirst(2).split(separator:" ");guard parts.count==2,let wire=Int(parts[1]) else{throw DenonError.invalid("Invalid mock trim")};channels[String(parts[0])]=parts[1].count==3 ? (wire/10)*2+1-76:wire*2-76}
            else if command.hasPrefix("MS") {surround=String(command.dropFirst(2))}
            else if command.hasPrefix("SI") {sources[1]=String(command.dropFirst(2))}
            else {
                let volumeText=zone==1 ? String(value.dropFirst(2)):value
                if volumeText=="UP" {volumes[zone]=min(98,(volumes[zone] ?? 40)+0.5)}
                else if volumeText=="DOWN" {volumes[zone]=max(0,(volumes[zone] ?? 40)-0.5)}
                else if let n=Int(volumeText) {volumes[zone]=volumeText.count==3 ? Double(n/10)+0.5:Double(n)}
                else if zone>1 {sources[zone]=value}
            }
            return Data()
        }
        if path.contains("Deviceinfo") {return Data("<Device_Info><ModelName>SIMULATOR</ModelName><FriendlyName>Simulator — no hardware</FriendlyName></Device_Info>".utf8)}
        let query=String(decoding:body ?? Data(),as:UTF8.self)
        let content:String
        if query.contains("GetAllZonePowerStatus") {content=(1...3).map{"<zone\($0)>\(powers[$0]==true ? "ON":"STANDBY")</zone\($0)>"}.joined()}
        else if query.contains("GetAllZoneVolume") {content=(1...3).map{"<zone\($0)><volume>\((volumes[$0] ?? 0)-80)</volume><limit>18</limit><disptype>ABSOLUTE</disptype><dispvalue>\(volumes[$0] ?? 0)</dispvalue></zone\($0)>"}.joined()}
        else if query.contains("GetAllZoneMuteStatus") {content=(1...3).map{"<zone\($0)>\(mutes[$0]==true ? "on":"off")</zone\($0)>"}.joined()}
        else if query.contains("GetAllZoneSource") {content=(1...3).map{"<zone\($0)><source>\(sources[$0] ?? "CD")</source></zone\($0)>"}.joined()}
        else if query.contains("GetZoneName") {content=(1...3).map{"<zone\($0)>Simulator Zone \($0)</zone\($0)>"}.joined()}
        else if query.contains("GetFriendlyName") {content="<friendlyname>Simulator — no hardware</friendlyname>"}
        else if query.contains("GetChLevel") {content="<chlists>"+channels.sorted{$0.key<$1.key}.map{"<ch><name>\($0.key)</name><status>1</status><sptype>0</sptype><value>\($0.value)</value><level>\(Double($0.value-24)/2)</level></ch>"}.joined()+"</chlists>"}
        else if query.contains("GetDeletedSource") {content="<functiondelete>"+["CD","MPLAY","NET"].map{"<list><name>\($0)</name><FuncName>\($0)</FuncName><use>1</use></list>"}.joined()+"</functiondelete>"}
        else if query.contains("GetRenameSource") {content="<functionrename><list><name>CD</name><rename>Simulator CD</rename></list></functionrename>"}
        else if query.contains("GetSurroundModeStatus") {content="<surround>\(surround)</surround>"}
        else if query.contains("GetSoundModeList") {content="<list><param name=\"genrelist\">movie</param><list>"+["STEREO","DOLBY SURROUND"].enumerated().map{"<value><listno>\($0.offset)</listno><dispname>\($0.element)</dispname><selected>\($0.element==surround ? 1:0)</selected></value>"}.joined()+"</list></list>"}
        else {content="<list><param name=\"simulated\" control=\"0\">NOT MEASURED</param></list>"}
        return Data("<rx><cmd>\(content)</cmd></rx>".utf8)
    }
}
