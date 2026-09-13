import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

public enum DenonError: Error, LocalizedError {
    case invalid(String), transport(String), busy(String), stale(String), unknown
    public var errorDescription: String? {
        switch self {
        case .invalid(let s), .transport(let s), .busy(let s), .stale(let s): return s
        case .unknown: return "送信後の結果を確認できません。再取得してください"
        }
    }
}
public final class XMLNode: @unchecked Sendable {
    public let name: String
    public let attributes: [String:String]
    public var text = ""
    public var children: [XMLNode] = []
    init(_ name:String, _ attributes:[String:String] = [:]) { self.name=name; self.attributes=attributes }
    public var value:String { text.trimmingCharacters(in:.whitespacesAndNewlines) }
    public func nodes(_ path:String)->[XMLNode] {
        let parts=path.split(separator:"/").map(String.init)
        return parts.reduce([self]) { nodes, part in nodes.flatMap { $0.children.filter { $0.name==part } } }
    }
    public func descendants(_ name:String)->[XMLNode] { children.flatMap { ($0.name==name ? [$0]:[]) + $0.descendants(name) } }
    public func string(_ path:String)->String { nodes(path).first?.value ?? "" }
    public var json: [String:Any] { ["name":name,"attributes":attributes,"value":value,"children":children.map(\.json)] }
    public static func parse(_ data:Data) throws -> XMLNode {
        guard data.count <= 4*1024*1024 else { throw DenonError.invalid("XML exceeds 4 MiB") }
        let s=String(decoding:data,as:UTF8.self)
        guard !s.uppercased().contains("<!DOCTYPE"),!s.uppercased().contains("<!ENTITY") else {throw DenonError.invalid("XML external declarations are not accepted")}
        let delegate=TreeParser();let parser=XMLParser(data:data);parser.shouldResolveExternalEntities=false;parser.delegate=delegate
        guard parser.parse(),let root=delegate.root else {throw DenonError.invalid("不正なXML / CMD ERR: \(parser.parserError?.localizedDescription ?? "empty")")}
        if root.name.lowercased()=="error" {throw DenonError.transport("AVR API error: \(root.value)")}
        if let error=root.descendants("error").first {throw DenonError.transport("AVR API error: \(error.value)")}
        if root.name=="rx" && root.children.isEmpty {throw DenonError.transport("AVR returned empty rx")}
        return root
    }
}
private final class TreeParser:NSObject,XMLParserDelegate {
    var root:XMLNode?;var stack:[XMLNode]=[]
    func parser(_ parser:XMLParser,didStartElement name:String,namespaceURI:String?,qualifiedName:String?,attributes:[String:String]) {
        guard stack.count<64 else {parser.abortParsing();return}
        let node=XMLNode(name,attributes);if let parent=stack.last {parent.children.append(node)}else{root=node};stack.append(node)
    }
    func parser(_ parser:XMLParser,foundCharacters s:String) {stack.last?.text += s}
    func parser(_ parser:XMLParser,didEndElement:String,namespaceURI:String?,qualifiedName:String?) {_ = stack.popLast()}
}
public struct DenonQuery:Codable,Sendable {public let method:String;public let command:String;public let extended:Bool;public let parameters:[String]}
public struct DenonCatalog:Codable,Sendable {
    public let commands:[DenonQuery];public let setupTypes:[String:[String:String]];public let queries:[String]
    public static let shared:DenonCatalog = {
        guard let u=Bundle.main.url(forResource:"catalog",withExtension:"json",subdirectory:"DenonControl") ?? Bundle.module.url(forResource:"catalog",withExtension:"json"),let d=try? Data(contentsOf:u),let c=try? JSONDecoder().decode(DenonCatalog.self,from:d) else {fatalError("Missing validated Denon catalog")};return c
    }()
    public func query(_ method:String) throws -> DenonQuery {guard let q=commands.first(where:{$0.method==method}) else {throw DenonError.invalid("Unknown getter: \(method)")};return q}
}
public func xmlEscape(_ s:String)->String {s.replacingOccurrences(of:"&",with:"&amp;").replacingOccurrences(of:"<",with:"&lt;").replacingOccurrences(of:">",with:"&gt;").replacingOccurrences(of:"\"",with:"&quot;").replacingOccurrences(of:"'",with:"&apos;")}
public func queryBody(_ q:DenonQuery)->String {
    let head="<?xml version=\"1.0\" encoding=\"utf-8\" ?>\n<tx>\n"
    if !q.extended {return head+"<cmd id=\"1\">\(xmlEscape(q.command))</cmd>\n</tx>"}
    return head+"<cmd id=\"3\">\n<name>\(xmlEscape(q.command))</name>\n<list>\n"+q.parameters.map{"<param name=\"\(xmlEscape($0))\" />"}.joined(separator:"\n")+"\n</list>\n</cmd>\n</tx>"
}
