import Foundation
public struct Wave: Sendable {
    public let sampleRate: Double
    public let samples: [Double]
    public init(sampleRate: Double, samples: [Double]) {self.sampleRate=sampleRate; self.samples=samples}
    public static func read(_ data: Data, channel: Int = 0) throws -> Wave {
        guard data.count>=44, String(data:data[0..<4],encoding:.ascii)=="RIFF", String(data:data[8..<12],encoding:.ascii)=="WAVE" else {throw AcousticError.invalid("Expected a RIFF WAVE file")}
        func u16(_ p: Int)->Int {Int(data[p]) | Int(data[p+1])<<8}
        func u32(_ p: Int)->Int {u16(p) | u16(p+2)<<16}
        var pos=12, format=0, channels=0, fs=0, bits=0, alignment=0, payload: Range<Int>?
        while pos+8<=data.count {
            let size=u32(pos+4), start=pos+8; guard size>=0, start+size<=data.count else {throw AcousticError.invalid("Truncated WAVE chunk")}
            let tag=String(data:data[pos..<pos+4],encoding:.ascii)
            if tag=="fmt " {
                guard size>=16 else {throw AcousticError.invalid("Invalid WAVE format")}
                format=u16(start); channels=u16(start+2); fs=u32(start+4); alignment=u16(start+12); bits=u16(start+14)
                if format==65534, size>=40 {format=u16(start+24)}
            }
            if tag=="data" {payload=start..<start+size}
            pos=start+size+(size%2)
        }
        guard let range=payload, channels>channel, channel>=0, fs>=8000, fs<=384000, [16,24,32,64].contains(bits), alignment==channels*bits/8, (format==1 && bits<=32)||(format==3 && [32,64].contains(bits)), range.count%alignment==0 else {throw AcousticError.invalid("Unsupported WAVE encoding")}
        var samples=[Double](); samples.reserveCapacity(range.count/alignment)
        for offset in stride(from:range.lowerBound+channel*bits/8,to:range.upperBound,by:alignment) {
            let value: Double
            if format==3 {
                if bits==32 {value=Double(Float(bitPattern:UInt32(u32(offset))))} else {let lo=UInt64(u32(offset)), hi=UInt64(u32(offset+4)); value=Double(bitPattern:lo | hi<<32)}
            } else if bits==16 {value=Double(Int16(bitPattern:UInt16(u16(offset))))/32768}
            else if bits==24 {let raw=Int32(data[offset]) | Int32(data[offset+1])<<8 | Int32(data[offset+2])<<16; value=Double((raw<<8)>>8)/8388608}
            else {value=Double(Int32(bitPattern:UInt32(u32(offset))))/2147483648}
            guard value.isFinite else {throw AcousticError.invalid("Non-finite audio sample")}; samples.append(value)
        }
        return Wave(sampleRate:Double(fs),samples:samples)
    }
    public func encoded() -> Data {
        var data=Data(); func str(_ s:String){data.append(contentsOf:s.utf8)}
        func u16(_ x:UInt16){data.append(UInt8(x&255));data.append(UInt8(x>>8))}
        func u32(_ x:UInt32){data.append(UInt8(x&255));data.append(UInt8((x>>8)&255));data.append(UInt8((x>>16)&255));data.append(UInt8(x>>24))}
        str("RIFF");u32(UInt32(36+samples.count*4));str("WAVEfmt ");u32(16);u16(3);u16(1);u32(UInt32(sampleRate));u32(UInt32(sampleRate)*4);u16(4);u16(32);str("data");u32(UInt32(samples.count*4));for x in samples {u32(Float(x).bitPattern)};return data
    }
}
