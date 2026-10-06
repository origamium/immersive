import { isSM58 } from "./microphones";
import type { MeasurementContext } from "./types";

export function MicrophoneNotice({ context }: { context: MeasurementContext }) {
  if (!isSM58(context)) return null;
  return (
    <aside className="note microphone-note" aria-label="SM58の測定範囲">
      <strong>SHURE SM58 · 参考測定</strong>
      <p>
        単一指向性・ボーカル向けの特性です。向きとゲインを固定して変化を比較してください。50
        Hz未満／15 kHz超は仕様範囲外、帯域内も平坦ではありません。
      </p>
      <p>
        UR12のMIC入力1へ接続。48Vは不要です。Direct
        Monitorと、設定可能なLoopbackはOFFにします。精密な測定には個体別校正のある無指向性マイクを使用してください。
      </p>
      <a
        href="https://pubs.shure.com/view/guide/SM58/en-US.pdf"
        target="_blank"
        rel="noreferrer"
      >
        Shure公式仕様
      </a>
      {" · "}
      <a
        href="https://download.steinberg.net/downloads_hardware/UR12/UR12_documentation/Manual/ur12_en_om_a0.pdf"
        target="_blank"
        rel="noreferrer"
      >
        UR12接続ガイド
      </a>
    </aside>
  );
}
