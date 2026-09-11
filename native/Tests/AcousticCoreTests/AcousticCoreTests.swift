import XCTest
@testable import AcousticCore
final class AcousticCoreTests: XCTestCase {
    func testFFTAndConvolution() {
        let input=(0..<1024).map{sin(Double($0)*0.17)}
        let actual=FFT.inverse(FFT.forward(input))
        XCTAssertLessThan(zip(input,actual).map{abs($0-$1)}.max()!,1e-10)
        let c=FFT.convolve([1,2,3],[1,0,0.5]);for (a,b) in zip(c,[1.0,2,3.5,1,1.5]){XCTAssertEqual(a,b,accuracy:1e-10)}
    }
    func testImpulseGainAndDelay() {
        var ir=[Double](repeating:0,count:48000);ir[480]=0.5
        let result=Analyzer.analyzeImpulse(ir,sampleRate:48000,timingVerified:true)
        XCTAssertEqual(result.delaySeconds!,0.01,accuracy:1/48000)
        for p in result.response {XCTAssertEqual(p.db,-6.0206,accuracy:0.1)}
        XCTAssertNil(Analyzer.analyzeImpulse(ir,sampleRate:48000).delaySeconds)
    }
    func testDecayFitAndInsufficientNoiseMargin() {
        let fs=8000.0,t60=0.6
        let samples=(0..<16000).map{exp(-log(1000)*Double($0)/fs/t60)}
        let fit=Analyzer.decayFit(samples,sampleRate:fs,from:-5,to:-35)
        XCTAssertNotNil(fit);XCTAssertEqual(fit!.0,t60,accuracy:t60*0.05)
        XCTAssertNil(Analyzer.decayFit(Array(repeating:1,count:16000),sampleRate:fs,from:-5,to:-35))
    }
    func testWaveRoundTripAndTruncation() throws {
        let original=Wave(sampleRate:48000,samples:[0,-0.1,0.5,-1,1])
        let restored=try Wave.read(original.encoded());XCTAssertEqual(restored.sampleRate,48000)
        for (a,b) in zip(original.samples,restored.samples){XCTAssertEqual(a,b,accuracy:1e-7)}
        XCTAssertThrowsError(try Wave.read(original.encoded().dropLast()))
    }
    func testSweepReconstruction() throws {
        let config=SweepConfiguration(sampleRate:8000,sweepSeconds:2,startHz:40,endHz:3000,amplitudeDBFS:-30)
        let signal=try Stimulus(config)
        let recording=Array(repeating:0.0,count:300)+signal.samples.map{$0*0.4}+Array(repeating:0,count:1000)
        let result=try Analyzer.analyzeSweep(recording:recording,config:config)
        XCTAssertEqual(result.driftPPM!,0,accuracy:1)
        for point in result.response where point.hz>100 && point.hz<2000 {XCTAssertEqual(point.db,20*log10(0.4),accuracy:0.1)}
    }
    func testInvalidSignalSettings() {
        XCTAssertThrowsError(try Stimulus(SweepConfiguration(amplitudeDBFS:0)))
        XCTAssertThrowsError(try Stimulus(SweepConfiguration(sampleRate:48000,endHz:48000)))
    }
    func testClockDriftAndMissingMarkers() throws {
        let config=SweepConfiguration(sampleRate:8000,sweepSeconds:2,startHz:40,endHz:3000,amplitudeDBFS:-30)
        let signal=try Stimulus(config)
        for ppm in [-100.0,100.0] {
            let ratio=1+ppm/1e6
            let samples=(0..<Int(Double(signal.samples.count)*ratio)).map {i -> Double in
                let pos=Double(i)/ratio,center=Int(pos);var sum=0.0,weight=0.0
                for k in (center-24)...(center+24) where k>=0 && k<signal.samples.count {
                    let t=pos-Double(k);if abs(t)<24 {let sinc=abs(t)<1e-12 ? 1 : sin(Double.pi*t)/(Double.pi*t),w=sinc*0.5*(1+cos(Double.pi*t/24));sum+=signal.samples[k]*w;weight+=w}
                }
                return weight==0 ? 0:sum/weight*0.4
            }
            let result=try Analyzer.analyzeSweep(recording:Array(repeating:0.0,count:400)+samples+Array(repeating:0,count:1000),config:config)
            XCTAssertEqual(result.driftPPM!,ppm,accuracy:5)
            let errors=result.response.filter{$0.hz>100 && $0.hz<2000}.map{abs($0.db-20*log10(0.4))}
            XCTAssertLessThan(errors.max()!,0.15)
        }
        XCTAssertThrowsError(try Analyzer.analyzeSweep(recording:Array(repeating:0,count:signal.samples.count),config:config))
        var missing=signal.samples;missing.replaceSubrange(signal.lastMarker..<signal.lastMarker+signal.marker.count,with:repeatElement(0,count:signal.marker.count))
        XCTAssertThrowsError(try Analyzer.analyzeSweep(recording:missing,config:config))
    }
}
