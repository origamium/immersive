import Foundation
public struct ResponsePoint: Codable, Sendable { public let hz: Double; public let db: Double; public var phase: Double? }
public struct DecayMetric: Codable, Sendable { public let hz: Double; public var edt: Double?; public var t20: Double?; public var t30: Double?; public var rSquared: Double?; public var reason: String? }
public struct IRPoint: Codable, Sendable {public let seconds: Double; public let value: Double}
public struct WaterfallSlice: Codable, Sendable {public let seconds: Double; public let response: [ResponsePoint]}
public struct DSPResult: Sendable {
    public var impulse: [Double]; public var response: [ResponsePoint]; public var decay: [DecayMetric]; public var waterfall: [WaterfallSlice]
    public var delaySeconds: Double?; public var driftPPM: Double?; public var snrDB: Double?; public var clippedSamples: Int; public var reasons: [String]; public var timeOriginSeconds: Double = 0
}
public enum Analyzer {
    public static let version="swift-dsp/1.0.0"
    public static func response(_ ir: [Double], sampleRate: Double, minHz: Double=20, maxHz: Double=20000) -> [ResponsePoint] {
        let fft=FFT.forward(ir); let n=fft.real.count
        var result=[ResponsePoint](), f=minHz
        while f<=min(maxHz,sampleRate*0.45) {
            let bin=f*Double(n)/sampleRate, lo=Int(bin), frac=bin-Double(lo)
            if lo+1<n/2 {let re=fft.real[lo]*(1-frac)+fft.real[lo+1]*frac, im=fft.imaginary[lo]*(1-frac)+fft.imaginary[lo+1]*frac
                let magnitude=hypot(fft.real[lo],fft.imaginary[lo])*(1-frac)+hypot(fft.real[lo+1],fft.imaginary[lo+1])*frac
                result.append(ResponsePoint(hz:f,db:20*log10(max(1e-15,magnitude)),phase:atan2(im,re)*180/Double.pi))}
            f *= pow(2,1.0/48)
        }
        return result
    }
    public static func decayFit(_ samples: [Double], sampleRate: Double, from: Double, to: Double) -> (Double,Double)? {
        guard samples.count>32 else{return nil}
        var energy=[Double](repeating:0,count:samples.count), sum=0.0
        for i in samples.indices.reversed(){sum += samples[i]*samples[i];energy[i]=sum}
        guard sum>1e-20 else{return nil}
        let noiseStart=max(0,samples.count-Int(sampleRate*0.2))
        let noise=samples[noiseStart...].reduce(0){$0+$1*$1}/Double(samples.count-noiseStart)
        // Reject fits below the measured stationary noise energy plus a 10 dB margin.
        var xs=[Double](),ys=[Double]()
        for i in energy.indices {let db=10*log10(max(1e-30,energy[i]/sum)); if db<=from && db>=to && energy[i]>noise*Double(samples.count-i)*10 {xs.append(Double(i)/sampleRate);ys.append(db)} }
        guard let last=ys.last, last<=to+0.5, xs.count>=20 else{return nil}
        let mx=xs.reduce(0,+)/Double(xs.count), my=ys.reduce(0,+)/Double(ys.count)
        var xx=0.0,xy=0.0,yy=0.0
        for i in xs.indices {xx += pow(xs[i]-mx,2);xy += (xs[i]-mx)*(ys[i]-my);yy += pow(ys[i]-my,2)}
        guard xx>0,yy>0,xy<0 else{return nil};let slope=xy/xx,r2=xy*xy/(xx*yy)
        guard r2>=0.95 else{return nil};return(-60/slope,r2)
    }
    private static func bandpass(_ samples:[Double], fs:Double, center:Double)->[Double] {
        let omega=2*Double.pi*center/fs, alpha=sin(omega)/(2*sqrt(2)), a0=1+alpha
        let b0=alpha/a0,b2 = -alpha/a0,a1 = -2*cos(omega)/a0,a2=(1-alpha)/a0
        var x1=0.0,x2=0.0,y1=0.0,y2=0.0
        return samples.map{x in let y=b0*x+b2*x2-a1*y1-a2*y2;x2=x1;x1=x;y2=y1;y1=y;return y}
    }
    public static func analyzeImpulse(_ ir:[Double], sampleRate:Double, timingVerified:Bool=false)->DSPResult {
        let peak=ir.indices.max(by:{abs(ir[$0])<abs(ir[$1])}) ?? 0
        let tail=Array(ir.dropFirst(peak)); var decay=[DecayMetric]()
        for f in [63.0,125,250,500,1000,2000,4000,8000] where f<sampleRate*0.4 {
            let band=bandpass(tail,fs:sampleRate,center:f)
            let e=decayFit(band,sampleRate:sampleRate,from:0,to:-10),t20=decayFit(band,sampleRate:sampleRate,from:-5,to:-25),t30=decayFit(band,sampleRate:sampleRate,from:-5,to:-35)
            decay.append(DecayMetric(hz:f,edt:e?.0,t20:t20?.0,t30:t30?.0,rSquared:t30?.1 ?? t20?.1 ?? e?.1,reason:t20 == nil ? "減衰幅・雑音余裕・直線性が不足" : (f<250 ? "小部屋低域: 拡散音場の残響時間ではなく帯域減衰の参考値" : nil)))
        }
        var slices=[WaterfallSlice]()
        for ms in stride(from:0,through:500,by:25) {
            let start=peak+Int(Double(ms)*sampleRate/1000); if start>=ir.count {break}
            var window=Array(ir[start..<min(ir.count,start+Int(sampleRate*0.5))]);let ramp=min(64,window.count)
            if ms>0 {for i in 0..<ramp {window[i] *= Double(i)/Double(ramp)}}
            slices.append(WaterfallSlice(seconds:Double(ms)/1000,response:response(window,sampleRate:sampleRate,maxHz:1000)))
        }
        return DSPResult(impulse:ir,response:response(ir,sampleRate:sampleRate),decay:decay,waterfall:slices,delaySeconds:timingVerified ? Double(peak)/sampleRate : nil,driftPPM:nil,snrDB:nil,clippedSamples:0,reasons:timingVerified ? [] : ["時間基準未検証: チャンネル間遅延・位相の提案は無効"])
    }
    public static func analyzeSweep(recording:[Double], config:SweepConfiguration) throws -> DSPResult {
        let stimulus=try Stimulus(config), fs=config.sampleRate
        guard recording.count>=stimulus.lastMarker else {throw AcousticError.invalid("Recording is too short for two timing references")}
        let clipped=recording.filter{abs($0)>=0.999}.count
        let correlation=FFT.convolve(recording,stimulus.marker.reversed())
        let expectedGap=stimulus.lastMarker-stimulus.firstMarker
        let searchEnd=max(1,min(correlation.count,recording.count-expectedGap+stimulus.marker.count))
        guard let p1=(0..<searchEnd).max(by:{abs(correlation[$0])<abs(correlation[$1])}) else {throw AcousticError.invalid("No timing marker")}
        let low=max(0,p1+expectedGap-Int(fs*0.15)), high=min(correlation.count,p1+expectedGap+Int(fs*0.15))
        guard low<high,let p2=(low..<high).max(by:{abs(correlation[$0])<abs(correlation[$1])}) else {throw AcousticError.invalid("No ending timing marker")}
        let markerEnergy=stimulus.marker.reduce(0){$0+$1*$1}
        guard abs(correlation[p1])>markerEnergy*0.001, abs(correlation[p2])>markerEnergy*0.001 else {throw AcousticError.invalid("Timing markers below detection threshold")}
        // Oversample the signed correlation with a band-limited interpolator. A three-point
        // parabola is biased for broadband chirps near Nyquist and corrupts drift estimates.
        func refined(_ p:Int)->Double {
            func value(_ position:Double)->Double {let center=Int(floor(position));var sum=0.0
                for k in (center-32)...(center+32) where k>=0 && k<correlation.count {let t=position-Double(k);if abs(t)<32 {let sinc=abs(t)<1e-12 ? 1:sin(Double.pi*t)/(Double.pi*t);sum += correlation[k]*sinc*0.5*(1+cos(Double.pi*t/32))}};return abs(sum)
            }
            var low=Double(p)-0.7,high=Double(p)+0.7
            for _ in 0..<32 {let a=low+(high-low)/3,b=high-(high-low)/3;if value(a)<value(b){low=a}else{high=b}}
            return (low+high)/2
        }
        let first=refined(p1)-Double(stimulus.marker.count-1), gap=refined(p2)-refined(p1), ratio=gap/Double(expectedGap), ppm=(ratio-1)*1e6
        guard abs(ppm)<1000 else {throw AcousticError.invalid("Clock drift exceeds 1000 ppm")}
        // Windowed-sinc interpolation preserves the upper audio band during clock correction.
        let preRoll=Int(fs*0.25)
        let start=first+Double(stimulus.sweepStart-stimulus.firstMarker-preRoll)*ratio
        let count=stimulus.sweep.count+Int(fs*2.5)+preRoll
        var aligned=[Double](repeating:0,count:count)
        for i in 0..<count {let pos=start+Double(i)*ratio, center=Int(floor(pos));var value=0.0,weight=0.0
            for k in (center-16)...(center+16) where k>=0 && k<recording.count {let t=pos-Double(k);if abs(t)<16 {let sinc=abs(t)<1e-9 ? 1 : sin(Double.pi*t)/(Double.pi*t);let w=sinc*0.5*(1+cos(Double.pi*t/16));value += recording[k]*w;weight += w}}
            aligned[i]=weight == 0 ? 0 : value/weight
        }
        let n=FFT.size(aligned.count+stimulus.sweep.count), x=FFT.forward(stimulus.sweep,count:n);var y=FFT.forward(aligned,count:n)
        let maxPower=zip(x.real,x.imaginary).map{$0*$0+$1*$1}.max() ?? 1
        for i in 0..<n {let power=x.real[i]*x.real[i]+x.imaginary[i]*x.imaginary[i];let denominator=power+maxPower*1e-10
            let re=(y.real[i]*x.real[i]+y.imaginary[i]*x.imaginary[i])/denominator
            y.imaginary[i]=(y.imaginary[i]*x.real[i]-y.real[i]*x.imaginary[i])/denominator;y.real[i]=re}
        let ir=Array(FFT.inverse(y).prefix(Int(fs*2.5)+preRoll))
        var result=analyzeImpulse(ir,sampleRate:fs,timingVerified:false)
        result.response=response(ir,sampleRate:fs,minHz:config.startHz*1.05,maxHz:config.endHz*0.95)
        result.driftPPM=ppm;result.clippedSamples=clipped
        let noiseCount=min(Int(fs*0.5),max(1,Int(first)-Int(fs*0.1))), noise=recording.prefix(noiseCount).reduce(0){$0+$1*$1}/Double(noiseCount)
        let signal=aligned.dropFirst(preRoll).prefix(stimulus.sweep.count).reduce(0){$0+$1*$1}/Double(stimulus.sweep.count)
        result.snrDB=10*log10(max(signal,1e-30)/max(noise,1e-30))
        if clipped>0 {result.reasons.append("クリッピングあり")}; if result.snrDB!<30 {result.reasons.append("SNR 30 dB未満")}
        // Acoustic timing is relative to the reference speaker, never absolute hardware latency.
        result.timeOriginSeconds = -Double(preRoll)/fs
        result.delaySeconds=Double((ir.indices.max(by:{abs(ir[$0])<abs(ir[$1])}) ?? 0)-preRoll)/fs
        result.response = result.response.map { p in var point=p; if let phase=p.phase {point.phase=(phase+360*p.hz*Double(preRoll)/fs).remainder(dividingBy:360)}; return point }
        result.reasons.removeAll{$0.hasPrefix("時間基準")}
        return result
    }
}
