import { describe, expect, it } from "vitest";
import source from "../../public/pcm-recorder.js?raw";

interface TestProcessor {
  port: { onmessage: (event: { data: string }) => void };
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
}
function processor(inputChannel: number) {
  const messages: {
    type: string;
    samples?: Float32Array;
    startFrame?: number;
  }[] = [];
  let Constructor: (new (options: unknown) => TestProcessor) | undefined;
  // Evaluate the repository's worklet with the three browser-provided globals.
  const register = new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    "sampleRate",
    source
  );
  register(
    class {
      port = {
        onmessage: undefined,
        postMessage: (message: (typeof messages)[number]) =>
          messages.push(message),
      };
    },
    (_name: string, value: typeof Constructor) => {
      Constructor = value;
    },
    48000
  );
  if (!Constructor) throw new Error("Processor was not registered");
  return {
    node: new Constructor({ processorOptions: { inputChannel } }),
    messages,
  };
}

describe("PCM worklet channel isolation", () => {
  it("never downmixes stereo and keeps every output sample silent", () => {
    const { node, messages } = processor(2);
    const left = new Float32Array([0.1, 0.2, 0.3]);
    const right = new Float32Array([0.4, 0.5, 0.6]);
    const output = new Float32Array(3).fill(1);
    node.process([[left, right]], [[output]]);
    expect(messages.map((m) => m.type)).toEqual(["ready"]);
    node.port.onmessage({ data: "record" });
    node.process([[left, right]], [[output]]);
    node.port.onmessage({ data: "stop" });
    expect(messages.find((m) => m.type === "pcm")?.samples).toEqual(right);
    expect([...output]).toEqual([0, 0, 0]);
    expect(node.process([[left, right]], [[output]])).toBe(false);
  });

  it("reports unavailable channels instead of silently using channel 1", () => {
    const { node, messages } = processor(2);
    node.port.onmessage({ data: "record" });
    node.process([[new Float32Array([0.2])]], [[new Float32Array(1)]]);
    node.port.onmessage({ data: "stop" });
    expect(messages.some((m) => m.type === "unavailable-channel")).toBe(true);
    expect(messages.some((m) => m.type === "pcm")).toBe(false);
  });

  it("detects even a single missing input block once audio has begun", () => {
    const { node, messages } = processor(1);
    node.process([[new Float32Array(128)]], [[new Float32Array(128)]]);
    node.port.onmessage({ data: "record" });
    node.process([[]], [[new Float32Array(128)]]);
    expect(messages.some((m) => m.type === "missing-input")).toBe(true);
  });
});
