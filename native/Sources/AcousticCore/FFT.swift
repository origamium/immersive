import Foundation
import Accelerate

public struct Spectrum: Sendable { public var real: [Double]; public var imaginary: [Double] }
public enum FFT {
    public static func size(_ minimum: Int) -> Int { var n=1; while n<minimum {n <<= 1}; return n }
    public static func forward(_ samples: [Double], count: Int? = nil) -> Spectrum {
        let n=size(max(samples.count,count ?? 0)); var real=Array(samples.prefix(n)); real += Array(repeating:0,count:n-real.count)
        var imaginary=[Double](repeating:0,count:n)
        transform(&real,&imaginary,inverse:false); return Spectrum(real:real,imaginary:imaginary)
    }
    public static func inverse(_ spectrum: Spectrum) -> [Double] { var real=spectrum.real, imaginary=spectrum.imaginary; transform(&real,&imaginary,inverse:true); return real }
    private static func transform(_ real: inout [Double], _ imaginary: inout [Double], inverse: Bool) {
        let logn=vDSP_Length(log2(Double(real.count))), n=real.count
        guard let setup=vDSP_create_fftsetupD(logn,FFTRadix(kFFTRadix2)) else { return }
        defer {vDSP_destroy_fftsetupD(setup)}
        real.withUnsafeMutableBufferPointer { r in imaginary.withUnsafeMutableBufferPointer { i in
            var complex=DSPDoubleSplitComplex(realp:r.baseAddress!,imagp:i.baseAddress!)
            vDSP_fft_zipD(setup,&complex,1,logn,inverse ? FFTDirection(FFT_INVERSE) : FFTDirection(FFT_FORWARD))
        }}
        if inverse { for i in 0..<n {real[i] /= Double(n); imaginary[i] /= Double(n)} }
    }
    public static func convolve(_ a: [Double], _ b: [Double]) -> [Double] {
        let n=size(a.count+b.count-1); var x=forward(a,count:n); let y=forward(b,count:n)
        for i in 0..<n { let re=x.real[i]*y.real[i]-x.imaginary[i]*y.imaginary[i]; x.imaginary[i]=x.real[i]*y.imaginary[i]+x.imaginary[i]*y.real[i]; x.real[i]=re }
        return Array(inverse(x).prefix(a.count+b.count-1))
    }
}
