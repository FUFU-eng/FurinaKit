import ttsNotice from "@/lib/vendor/tts-NOTICE.txt?raw";
import sherpaLicense from "@/lib/vendor/sherpa-onnx-LICENSE.txt?raw";
import openccLicense from "@/lib/vendor/opencc-js-LICENSE.txt?raw";
import openccThirdParty from "@/lib/vendor/opencc-js-THIRD-PARTY.txt?raw";
import openccApache from "@/lib/vendor/opencc-js-Apache-2.0.txt?raw";
import pinyinLicense from "@/lib/vendor/pinyin-pro-LICENSE.txt?raw";
import { tr, useLanguage } from "@/lib/language";

const licenses = [
  { name: "Offline TTS · sherpa-onnx Apache-2.0 / Model notices", text: [ttsNotice, sherpaLicense].join("\n\n") },
  { name: "opencc-js 1.4.2 · MIT AND Apache-2.0", text: [openccLicense, openccThirdParty, openccApache].join("\n\n") },
  { name: "pinyin-pro 3.29.4 · MIT", text: pinyinLicense },
];

export function OpenSourceLicenses() {
  useLanguage();
  return (
    <details className="rounded-2xl border border-border bg-card p-5">
      <summary className="cursor-pointer text-sm font-semibold">
        {tr("开源许可与第三方署名", "Open-source licenses & attribution")}
      </summary>
      <div className="mt-4 space-y-3">
        {licenses.map(({ name, text }) => (
          <details key={name} className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer break-words text-xs font-medium">{name}</summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{text}</pre>
          </details>
        ))}
      </div>
    </details>
  );
}
