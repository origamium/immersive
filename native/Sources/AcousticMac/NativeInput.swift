import AVFoundation
import AudioToolbox
import AcousticCore
final class NativeInput {
    private let engine=AVAudioEngine();private var file:ExtAudioFileRef?;private var expected:AVAudioFramePosition?;private(set) var error:String?;private(set) var rate=0.0;private(set) var frames:Int64=0
    func start(deviceID:AudioDeviceID,url:URL) async throws {
        guard await AVCaptureDevice.requestAccess(for:.audio) else{throw AcousticError.invalid("Microphone permission was denied")}
        let node=engine.inputNode
        guard let unit=node.audioUnit else{throw AcousticError.invalid("Input unit unavailable")};var id=deviceID
        try checkAudio(AudioUnitSetProperty(unit,kAudioOutputUnitProperty_CurrentDevice,kAudioUnitScope_Global,0,&id,4),"Select microphone")
        let format=node.outputFormat(forBus:0);guard format.channelCount>0 else {throw AcousticError.invalid("Input has no channels")};rate=format.sampleRate
        var disk=AudioStreamBasicDescription(mSampleRate:rate,mFormatID:kAudioFormatLinearPCM,mFormatFlags:kAudioFormatFlagIsFloat|kAudioFormatFlagIsPacked,mBytesPerPacket:4*format.channelCount,mFramesPerPacket:1,mBytesPerFrame:4*format.channelCount,mChannelsPerFrame:format.channelCount,mBitsPerChannel:32,mReserved:0)
        try checkAudio(ExtAudioFileCreateWithURL(url as CFURL,kAudioFileWAVEType,&disk,nil,AudioFileFlags.eraseFile.rawValue,&file),"Create recording")
        guard let file else{throw AcousticError.invalid("Recording file unavailable")};var client=format.streamDescription.pointee
        try checkAudio(ExtAudioFileSetProperty(file,kExtAudioFileProperty_ClientDataFormat,UInt32(MemoryLayout.size(ofValue:client)),&client),"Set input PCM format")
        try checkAudio(ExtAudioFileWriteAsync(file,0,nil),"Prime asynchronous recording writer")
        node.installTap(onBus:0,bufferSize:4096,format:format){ [weak self] buffer,time in
            guard let self else{return}
            if time.isSampleTimeValid {if let previous=self.expected,previous != time.sampleTime {self.error="Input sample timeline contains a gap"};self.expected=time.sampleTime+Int64(buffer.frameLength)} else {self.error="Input sample timeline is unavailable"}
            if let channels=buffer.floatChannelData {for i in 0..<Int(buffer.frameLength) where abs(channels[0][i])>=0.999 {self.error="Input clipping detected";break}}
            let status=ExtAudioFileWriteAsync(file,buffer.frameLength,buffer.audioBufferList);if status != noErr {self.error="PCM write failed: \(status)"};self.frames += Int64(buffer.frameLength)
        }
        do {try engine.start()} catch {stop();throw error}
    }
    func stop() {engine.stop();engine.inputNode.removeTap(onBus:0);if let file {_=ExtAudioFileDispose(file)};file=nil}
    deinit {if file != nil {stop()}}
}
