import Foundation
import HAP
import DenonControl

/// Pairing secrets never enter Supabase, web assets, or diagnostic exports.
private final class PrivateHAPStorage: HAP.Storage {
    let file: URL
    init(_ file: URL) throws {
        self.file=file
        try FileManager.default.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        if FileManager.default.fileExists(atPath:file.path) {
            _ = try JSONSerialization.jsonObject(with:Data(contentsOf:file)) // Don't silently reset corrupt pairings.
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
        }
    }
    func read() throws -> Data {try Data(contentsOf:file)}
    func write(_ data: Data) throws {
        try data.write(to:file,options:.atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
    }
}
final class ReceiverHomeKit: HAP.DeviceDelegate, @unchecked Sendable {
    let controller: ReceiverController
    let device: HAP.Device
    private let television: Accessory.Television
    private let volume: Service.Lightbulb
    private let modes: [(String, Service.Switch)]
    private let sourceNames: [String]
    private var server: HAP.Server?
    private let report: @Sendable (String)->Void
    init(controller: ReceiverController, state: ReceiverState, directory: URL,
         modeNames: [String] = [], report: @escaping @Sendable (String)->Void) throws {
        self.controller=controller;self.report=report
        let storage=try PrivateHAPStorage(directory.appendingPathComponent("pairing.json"))
        let inputFile=directory.appendingPathComponent("inputs.json")
        // HAP input identifiers must remain stable across rename/hide/restarts.
        if FileManager.default.fileExists(atPath:inputFile.path) {
            let previous=try JSONDecoder().decode([String].self,from:Data(contentsOf:inputFile))
            let additions=state.sources.map(\.function).filter{!previous.contains($0)}.sorted()
            sourceNames=previous+additions
            if !additions.isEmpty {
                try JSONEncoder().encode(sourceNames).write(to:inputFile,options:.atomic)
                try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:inputFile.path)
            }
        } else {
            sourceNames=state.sources.map(\.function).sorted()
            guard !sourceNames.isEmpty else {throw DenonError.invalid("HomeKit開始前にAVR入力一覧を取得してください")}
            try JSONEncoder().encode(sourceNames).write(to:inputFile,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:inputFile.path)
        }
        volume=Service.Lightbulb(type:.monochrome,isDimmable:true)
        volume.name?.value="AVR Volume"
        modes=modeNames.sorted().map {name in let service=Service.Switch();service.name?.value=name;return (name,service)}
        television=Accessory.Television(info:Service.Info(name:state.friendlyName ?? "Immersive AVR",serialNumber:directory.lastPathComponent),
            inputs:sourceNames.map{($0,Enums.InputSourceType(rawValue:["TUNER":2,"NET":10,"BT":0,"PHONO":0,"CD":0][$0] ?? 3) ?? .hdmi)},additionalServices:[volume]+modes.map{$0.1})
        television.speaker.volumeControlType?.value=Enums.VolumeControlType(rawValue:1)
        device=HAP.Device(storage:storage,accessory:television)
        device.delegate=self
        update(state)
    }
    var setupSVG:String? {
        guard !paired else{return nil}
        let bitmap=device.setupQRCode.asBitmap, size=device.setupQRCode.asBitmap.count+8
        var rectangles=""
        for (y,row) in bitmap.enumerated() {for (x,dark) in row.enumerated() where dark {rectangles+="<rect x=\"\(x+4)\" y=\"\(y+4)\" width=\"1\" height=\"1\"/>"}}
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 \(size) \(size)\"><rect width=\"100%\" height=\"100%\" fill=\"white\"/><g fill=\"black\">\(rectangles)</g></svg>"
    }
    var paired: Bool {device.isPaired}
    var setupCode: String? {paired ? nil:device.setupCode}
    var setupURI: String? {paired ? nil:device.setupURI}
    func start(port: Int = 51826) throws {guard server==nil else{return};server=try HAP.Server(device:device,listenPort:port)}
    func stop() {try? server?.stop();server=nil}
    func update(_ state: ReceiverState) {
        guard let zone=state.zones["zone1"] else{return}
        if let power=zone.power {television.television.active.value=power=="ON" ? .active:.inactive;television.speaker.active?.value=power=="ON" ? .active:.inactive}
        if let muted=zone.muted {television.speaker.mute.value=muted;volume.powerState.value = !muted}
        if let value=zone.volume {volume.brightness?.value=Int(min(98,max(0,value)).rounded(.toNearestOrEven));television.speaker.volume?.value=Int(min(98,max(0,value)))}
        if let source=zone.source,let index=sourceNames.firstIndex(of:source) {television.television.activeIdentifier.value=UInt32(index)}
        for (index,source) in television.sources.enumerated() {
            let input=state.sources.first{$0.function==sourceNames[index]}
            source.configuredName.value=input?.displayName ?? input?.name ?? sourceNames[index]
            source.currentVisibilityState.value=Enums.CurrentVisibilityState(rawValue:input?.enabled == true ? 0:1)
            source.isConfigured.value=Enums.IsConfigured(rawValue:input?.enabled == true ? 1:0)
        }
        for (name,service) in modes {service.powerState.value=state.surround==name}
    }
    func characteristic<T>(_ characteristic: GenericCharacteristic<T>, ofService service: Service,
                           ofAccessory accessory: Accessory, didChangeValue newValue: T?) {
        var kind: String?, enabled: Bool?, value: Double?, name: String?
        if characteristic === television.television.active {kind="power";enabled=(newValue as? Enums.Active) == .active}
        else if characteristic === television.television.activeIdentifier,let index=newValue as? UInt32,Int(index)<sourceNames.count {kind="source";name=sourceNames[Int(index)]}
        else if characteristic === television.speaker.mute {kind="mute";enabled=newValue as? Bool}
        else if characteristic === television.speaker.volumeSelector {kind=(newValue as? Enums.VolumeSelector) == .increment ? "volume-up":"volume-down"}
        else if characteristic === volume.brightness,let level=newValue as? Int {kind="volume";value=Double(min(98,max(0,level)))}
        else if characteristic === volume.powerState,let on=newValue as? Bool {kind="mute";enabled = !on}
        else if let match=modes.first(where:{$0.1 === service}),newValue as? Bool==true {kind="surround";name=match.0}
        guard let kind else {report("このHomeKit操作は未対応です。RemoteKeyはAVRへ送信しません。");return}
        let actionKind=kind,actionEnabled=enabled,actionValue=value,actionName=name
        Task {
            do {
                let state=await controller.refresh()
                let result=try await controller.execute(ReceiverOperation(expectedRevision:state.revision,kind:actionKind,enabled:actionEnabled,value:actionValue,name:actionName))
                if let state=result.state {update(state)}
                report("HomeKit: \(result.status)")
            } catch {update(await controller.refresh());report(error.localizedDescription)}
        }
    }
}
