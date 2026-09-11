import Foundation
import CoreAudio
import AudioToolbox
import AcousticCore
import RealtimeState

func checkAudio(_ status:OSStatus,_ action:String) throws {if status != noErr {throw AcousticError.invalid("\(action): CoreAudio \(status)")}}
struct AudioDevice:Identifiable {
    let id:AudioDeviceID;let name:String;let uid:String;let outputChannels:Int;let inputChannels:Int;let rate:Double;let rates:[Double];let physicalBits:Int?
    static func scalar<T>(_ id:AudioObjectID,_ selector:AudioObjectPropertySelector,_ initial:T,scope:AudioObjectPropertyScope=kAudioObjectPropertyScopeGlobal)->T {
        var value=initial,addr=AudioObjectPropertyAddress(mSelector:selector,mScope:scope,mElement:kAudioObjectPropertyElementMain),size=UInt32(MemoryLayout<T>.size)
        _=AudioObjectGetPropertyData(id,&addr,0,nil,&size,&value);return value
    }
    static func channels(_ id:AudioDeviceID,_ scope:AudioObjectPropertyScope)->Int {
        var addr=AudioObjectPropertyAddress(mSelector:kAudioDevicePropertyStreamConfiguration,mScope:scope,mElement:kAudioObjectPropertyElementMain),size:UInt32=0
        guard AudioObjectGetPropertyDataSize(id,&addr,0,nil,&size)==noErr,size>0 else{return 0};let pointer=UnsafeMutableRawPointer.allocate(byteCount:Int(size),alignment:MemoryLayout<AudioBufferList>.alignment);defer{pointer.deallocate()}
        guard AudioObjectGetPropertyData(id,&addr,0,nil,&size,pointer)==noErr else{return 0};return UnsafeMutableAudioBufferListPointer(pointer.assumingMemoryBound(to:AudioBufferList.self)).reduce(0){$0+Int($1.mNumberChannels)}
    }
    static func all()->[AudioDevice] {
        var addr=AudioObjectPropertyAddress(mSelector:kAudioHardwarePropertyDevices,mScope:kAudioObjectPropertyScopeGlobal,mElement:kAudioObjectPropertyElementMain),size:UInt32=0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject),&addr,0,nil,&size)==noErr else{return []}
        var ids=[AudioDeviceID](repeating:0,count:Int(size)/4);_=AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),&addr,0,nil,&size,&ids)
        return ids.map {id in
            let name=scalar(id,kAudioObjectPropertyName,"Unknown" as CFString) as String,uid=scalar(id,kAudioDevicePropertyDeviceUID,"" as CFString) as String,rate=scalar(id,kAudioDevicePropertyNominalSampleRate,0.0)
            var property=AudioObjectPropertyAddress(mSelector:kAudioDevicePropertyAvailableNominalSampleRates,mScope:kAudioObjectPropertyScopeGlobal,mElement:kAudioObjectPropertyElementMain),bytes:UInt32=0
            _=AudioObjectGetPropertyDataSize(id,&property,0,nil,&bytes);var ranges=[AudioValueRange](repeating:AudioValueRange(),count:Int(bytes)/MemoryLayout<AudioValueRange>.size)
            _=AudioObjectGetPropertyData(id,&property,0,nil,&bytes,&ranges)
            let common=[44100.0,48000,88200,96000,176400,192000,352800,384000].filter{r in ranges.contains{r >= $0.mMinimum && r <= $0.mMaximum}}
            var streamProperty=AudioObjectPropertyAddress(mSelector:kAudioDevicePropertyStreams,mScope:kAudioDevicePropertyScopeOutput,mElement:kAudioObjectPropertyElementMain),streamBytes:UInt32=0
            _=AudioObjectGetPropertyDataSize(id,&streamProperty,0,nil,&streamBytes);var streams=[AudioStreamID](repeating:0,count:Int(streamBytes)/4);_=AudioObjectGetPropertyData(id,&streamProperty,0,nil,&streamBytes,&streams)
            let format=streams.first.map{scalar($0,kAudioStreamPropertyPhysicalFormat,AudioStreamBasicDescription())}
            return AudioDevice(id:id,name:name,uid:uid,outputChannels:channels(id,kAudioDevicePropertyScopeOutput),inputChannels:channels(id,kAudioDevicePropertyScopeInput),rate:rate,rates:common,physicalBits:format.map{Int($0.mBitsPerChannel)})
        }
    }
    var report:[String:Any] {["schemaVersion":1,"deviceId":uid,"name":name,"platform":"macOS","requestedRate":NSNull(),"actualRate":rate,"channels":outputChannels,"physicalBits":physicalBits as Any? ?? NSNull(),"supportedRates":rates,"verification":"api","notes":["CoreAudioで取得した現在値。接続先・チャンネル順・ビット完全性は実機で別途検証。"]]}
}
final class RenderState {
    let samples:UnsafeMutablePointer<Float>;let frames:Int;let channels:Int;let lease:OpaquePointer;var position=0;var expired=false
    init(interleaved:[Float],channels:Int) {frames=interleaved.count/channels;self.channels=channels;samples = .allocate(capacity:interleaved.count);samples.initialize(from:interleaved,count:interleaved.count);lease=acoustic_lease_create()!}
    deinit {samples.deallocate();acoustic_lease_destroy(lease)}
    func renew(seconds:Double) {acoustic_lease_set(lease,clock_gettime_nsec_np(CLOCK_UPTIME_RAW)+UInt64(max(0,seconds)*1e9))}
}
final class NativeOutput {
    private var unit:AudioUnit?;private var state:RenderState?;private var originalRate:Double?;private var selected:AudioDeviceID?
    private(set) var actualRate=0.0
    func prepare(device:AudioDevice,config:SweepConfiguration,sweepChannel:Int,referenceChannel:Int) throws {
        stop()
        guard sweepChannel>=0,sweepChannel<device.outputChannels,referenceChannel>=0,referenceChannel<device.outputChannels,device.outputChannels<=64 else {throw AcousticError.invalid("Selected channel is not available on the physical device")}
        let stimulus=try Stimulus(config);originalRate=device.rate;selected=device.id
        do {
            var addr=AudioObjectPropertyAddress(mSelector:kAudioDevicePropertyNominalSampleRate,mScope:kAudioObjectPropertyScopeGlobal,mElement:kAudioObjectPropertyElementMain),rate=config.sampleRate
            try checkAudio(AudioObjectSetPropertyData(device.id,&addr,0,nil,UInt32(MemoryLayout<Double>.size),&rate),"Set nominal sample rate")
            actualRate=AudioDevice.scalar(device.id,kAudioDevicePropertyNominalSampleRate,0.0)
            guard abs(actualRate-config.sampleRate)<0.1 else {throw AcousticError.invalid("Actual hardware rate \(actualRate) differs from requested \(config.sampleRate)")}
            var desc=AudioComponentDescription(componentType:kAudioUnitType_Output,componentSubType:kAudioUnitSubType_HALOutput,componentManufacturer:kAudioUnitManufacturer_Apple,componentFlags:0,componentFlagsMask:0)
            guard let component=AudioComponentFindNext(nil,&desc) else {throw AcousticError.invalid("AUHAL unavailable")};var created:AudioUnit?;try checkAudio(AudioComponentInstanceNew(component,&created),"Create AUHAL");unit=created;guard let unit else {throw AcousticError.invalid("AUHAL creation failed")}
            var id=device.id;try checkAudio(AudioUnitSetProperty(unit,kAudioOutputUnitProperty_CurrentDevice,kAudioUnitScope_Global,0,&id,4),"Select output")
            var format=AudioStreamBasicDescription(mSampleRate:actualRate,mFormatID:kAudioFormatLinearPCM,mFormatFlags:kAudioFormatFlagIsFloat|kAudioFormatFlagIsPacked|kAudioFormatFlagIsNonInterleaved,mBytesPerPacket:4,mFramesPerPacket:1,mBytesPerFrame:4,mChannelsPerFrame:UInt32(device.outputChannels),mBitsPerChannel:32,mReserved:0)
            try checkAudio(AudioUnitSetProperty(unit,kAudioUnitProperty_StreamFormat,kAudioUnitScope_Input,0,&format,UInt32(MemoryLayout.size(ofValue:format))),"Set rendering format")
            var data=[Float](repeating:0,count:stimulus.samples.count*device.outputChannels)
            for i in stimulus.sweep.indices {data[(stimulus.sweepStart+i)*device.outputChannels+sweepChannel]=Float(stimulus.sweep[i])}
            for i in stimulus.marker.indices {data[(stimulus.firstMarker+i)*device.outputChannels+referenceChannel]=Float(stimulus.marker[i]);data[(stimulus.lastMarker+i)*device.outputChannels+referenceChannel]=Float(stimulus.marker[i])}
            let render=RenderState(interleaved:data,channels:device.outputChannels);state=render
            var callback=AURenderCallbackStruct(inputProc:{ ref,flags,_,_,count,buffers in
                let s=Unmanaged<RenderState>.fromOpaque(ref).takeUnretainedValue()
                guard let buffers else{return noErr};let list=UnsafeMutableAudioBufferListPointer(buffers)
                let alive = !s.expired && clock_gettime_nsec_np(CLOCK_UPTIME_RAW)<acoustic_lease_get(s.lease)
                if !alive {s.expired=true}
                for (channel,buffer) in list.enumerated() {guard let ptr=buffer.mData?.assumingMemoryBound(to:Float.self) else{continue};for frame in 0..<Int(count) {let p=s.position+frame;ptr[frame] = alive && channel<s.channels && p<s.frames ? s.samples[p*s.channels+channel]:0}}
                if alive {s.position += Int(count)} else {flags.pointee.insert(.unitRenderAction_OutputIsSilence)}
                return noErr
            },inputProcRefCon:Unmanaged.passUnretained(render).toOpaque())
            try checkAudio(AudioUnitSetProperty(unit,kAudioUnitProperty_SetRenderCallback,kAudioUnitScope_Input,0,&callback,UInt32(MemoryLayout.size(ofValue:callback))),"Install render callback")
            try checkAudio(AudioUnitInitialize(unit),"Initialize output")
        } catch {stop();throw error}
    }
    func start(leaseSeconds:Double) throws {guard let unit,let state else{throw AcousticError.invalid("Output has not been prepared")};state.renew(seconds:leaseSeconds);try checkAudio(AudioOutputUnitStart(unit),"Start output")}
    func renew(seconds:Double) {state?.renew(seconds:seconds)}
    func stop() {if let unit {_=AudioOutputUnitStop(unit);_=AudioUnitUninitialize(unit);_=AudioComponentInstanceDispose(unit)};unit=nil;state=nil;if let id=selected,var rate=originalRate {var a=AudioObjectPropertyAddress(mSelector:kAudioDevicePropertyNominalSampleRate,mScope:kAudioObjectPropertyScopeGlobal,mElement:kAudioObjectPropertyElementMain);_=AudioObjectSetPropertyData(id,&a,0,nil,8,&rate)};selected=nil;originalRate=nil}
    deinit {stop()}
}
