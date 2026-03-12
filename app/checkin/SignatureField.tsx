"use client";

import { useEffect, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";

type SignatureFieldProps = {
  inputName?: string;
};

export default function SignatureField({
  inputName = "signature_data",
}: SignatureFieldProps) {
  const sigRef = useRef<SignatureCanvas | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [canvasSize, setCanvasSize] = useState({
    width: 500,
    height: 180,
  });

  function syncSignature() {
    const sig = sigRef.current;
    const hidden = hiddenInputRef.current;

    if (!sig || !hidden) return;

    if (sig.isEmpty()) {
      hidden.value = "";
      return;
    }

    hidden.value = sig.getTrimmedCanvas().toDataURL("image/png");
  }

  function clearSignature() {
    sigRef.current?.clear();
    if (hiddenInputRef.current) hiddenInputRef.current.value = "";
  }

  useEffect(() => {
    function updateCanvasSize() {
      const container = containerRef.current;
      if (!container) return;

      const width = Math.floor(container.offsetWidth);

      if (!width) return;

      setCanvasSize({
        width,
        height: 180,
      });

      // clearing avoids bad coordinate carryover after resize
      setTimeout(() => {
        clearSignature();
      }, 0);
    }

    updateCanvasSize();

    window.addEventListener("resize", updateCanvasSize);
    window.addEventListener("orientationchange", updateCanvasSize);

    const resetHandler = () => clearSignature();
    window.addEventListener("reset-signature", resetHandler);

    return () => {
      window.removeEventListener("resize", updateCanvasSize);
      window.removeEventListener("orientationchange", updateCanvasSize);
      window.removeEventListener("reset-signature", resetHandler);
    };
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        className="mt-1 overflow-hidden rounded-lg border border-gray-300 bg-white"
      >
        <SignatureCanvas
          key={`${canvasSize.width}-${canvasSize.height}`}
          ref={sigRef}
          penColor="black"
          canvasProps={{
            width: canvasSize.width,
            height: canvasSize.height,
            className: "block w-full h-[180px]",
          }}
          onEnd={syncSignature}
        />
      </div>

      <input ref={hiddenInputRef} type="hidden" name={inputName} />

      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={clearSignature}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          Clear Signature
        </button>
      </div>
    </div>
  );
}