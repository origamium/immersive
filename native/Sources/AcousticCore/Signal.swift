import Foundation
public struct SweepConfiguration: Codable, Sendable {
    public var sampleRate: Double = 48000
    public var sweepSeconds: Double = 10
    public var startHz: Double = 20
    public var endHz: Double = 20000
    public var amplitudeDBFS: Double = -30
    public init(sampleRate: Double = 48000, sweepSeconds: Double = 10, startHz: Double = 20, endHz: Double = 20000, amplitudeDBFS: Double = -30) {
        self.sampleRate=sampleRate; self.sweepSeconds=sweepSeconds; self.startHz=startHz; self.endHz=endHz; self.amplitudeDBFS=amplitudeDBFS
    }
    public func validate() throws {
        guard sampleRate>=8000, sampleRate<=384000, sweepSeconds>=1, sweepSeconds<=30,
              startHz>=10, endHz>startHz, endHz<sampleRate*0.49, amplitudeDBFS<=(-12), amplitudeDBFS>=(-80),
              [sampleRate,sweepSeconds,startHz,endHz,amplitudeDBFS].allSatisfy({$0.isFinite}) else { throw AcousticError.invalid("Unsupported sweep settings") }
    }
}
public enum AcousticError: Error, LocalizedError { case invalid(String)
    public var errorDescription: String? { if case .invalid(let message)=self {return message}; return nil }
}
public struct Stimulus: Sendable {
    public let samples: [Double]
    public let sweep: [Double]
    public let marker: [Double]
    public let sweepStart: Int
    public let firstMarker: Int
    public let lastMarker: Int
    public init(_ config: SweepConfiguration) throws {
        try config.validate()
        let fs=config.sampleRate, n=Int(fs*config.sweepSeconds), level=pow(10,config.amplitudeDBFS/20)
        let logRatio=log(config.endHz/config.startHz), fade=Int(fs*0.02)
        sweep=(0..<n).map { i in
            let t=Double(i)/fs
            let phase=2*Double.pi*config.startHz*config.sweepSeconds/logRatio*(exp(t*logRatio/config.sweepSeconds)-1)
            let edge=min(1,Double(min(i,n-1-i))/Double(fade))
            return level*sin(phase)*0.5*(1-cos(Double.pi*edge))
        }
        let mn=Int(fs*0.08), f1=min(2000,fs*0.1), f2=min(8000,fs*0.4)
        marker=(0..<mn).map { i in let t=Double(i)/fs; return level*sin(2*Double.pi*(f1*t+(f2-f1)*t*t/0.16))*pow(sin(Double.pi*Double(i)/Double(mn-1)),2) }
        firstMarker=Int(fs); sweepStart=firstMarker+mn+Int(fs*0.5); lastMarker=sweepStart+n+Int(fs*3)
        var signal=[Double](repeating:0,count:lastMarker+mn+Int(fs*0.5))
        signal.replaceSubrange(firstMarker..<firstMarker+mn,with:marker)
        signal.replaceSubrange(sweepStart..<sweepStart+n,with:sweep)
        signal.replaceSubrange(lastMarker..<lastMarker+mn,with:marker)
        samples=signal
    }
}
