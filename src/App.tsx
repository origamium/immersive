import { lazy, Suspense } from "react";

const AcousticLab = lazy(() =>
  import("./acoustics/AcousticLab").then((module) => ({
    default: module.AcousticLab,
  }))
);
const SpeakerLayoutApp = lazy(() =>
  import("./visualizer/SpeakerLayoutApp").then((module) => ({
    default: module.SpeakerLayoutApp,
  }))
);

const layoutView =
  window.location.pathname.replace(/\/$/, "") === "/visualizer";

export function App() {
  return (
    <>
      <nav className="product-navigation" aria-label="アプリ画面">
        <a href="/" aria-current={!layoutView ? "page" : undefined}>
          音響測定・AVR
        </a>
        <a href="/visualizer" aria-current={layoutView ? "page" : undefined}>
          スピーカー配置
        </a>
      </nav>
      <Suspense
        fallback={<div className="app-loading">アプリを準備しています…</div>}
      >
        {layoutView ? <SpeakerLayoutApp /> : <AcousticLab />}
      </Suspense>
    </>
  );
}
